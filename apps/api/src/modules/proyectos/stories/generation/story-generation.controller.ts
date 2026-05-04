import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Req,
  Res,
  Logger,
  ParseUUIDPipe,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Permission, UserRole } from '@cenzontle/shared';
import type { StoryGenerationEvent, ProposedStory, AuthenticatedUser } from '@cenzontle/shared';
import { Permissions, CurrentUser } from '../../../auth/decorators';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoryGenerationService } from './story-generation.service';
import { StoryProposalCacheService } from './story-proposal-cache.service';
import { GenerateStoriesQueryDto } from './dto/generate-stories.dto';
import { scrubSecrets } from '../../../../common/utils/scrub-secrets.util';
import { setupSseHeartbeat } from '../../../../common/utils/sse-heartbeat.util';
import { AgentRunRegistryService } from '../../../../common/services/agent-run-registry.service';
import type { Request, Response } from 'express';

/**
 * Sanitiza una cadena para uso en logs: redacta patrones tipo PAT/token, elimina
 * caracteres de control (CR/LF) para prevenir CWE-117 (log injection), y trunca.
 */
function sanitizeForLog(s: string, maxLen = 200): string {
  // Control chars intencionalmente removidos para prevenir CWE-117 (log injection).
  // eslint-disable-next-line no-control-regex
  return scrubSecrets(s).replace(/[\r\n\x00-\x1f]+/g, ' ').slice(0, maxLen);
}

@ApiTags('Historias — Generación IA')
@Controller('proyectos/story-generation')
export class StoryGenerationController {
  private readonly logger = new Logger(StoryGenerationController.name);

  constructor(
    private readonly generation: StoryGenerationService,
    private readonly cache: StoryProposalCacheService,
    private readonly prisma: PrismaService,
    private readonly registry: AgentRunRegistryService,
  ) {}

  /**
   * CWE-639 / OWASP A01: autorizacion a nivel objeto.
   *
   * `@Permissions(Permission.CREATE_STORY)` solo valida el permiso global del JWT.
   * Sin este check, cualquier usuario con CREATE_STORY podria generar historias en
   * cualquier epicaId — leaking contenido via SSE (descripcion, definicion markdown,
   * pods, historias existentes) o borrar cache de terceros.
   *
   * Regla de acceso:
   *   - `AltaGerencia` tiene acceso global (no se requiere interseccion).
   *   - El resto de roles debe tener al menos un `podId` en comun con los pods de la epica.
   *   - Una epica sin pods asignados solo es accesible para AltaGerencia.
   */
  private async assertUserCanAccessEpic(
    user: AuthenticatedUser,
    epicId: string,
  ): Promise<void> {
    if (user.role === UserRole.AltaGerencia) return;

    const epic = await this.prisma.epic.findUnique({
      where: { id: epicId },
      select: { id: true, pods: { select: { podId: true } } },
    });
    if (!epic) throw new NotFoundException('Épica no encontrada');

    if (epic.pods.length === 0) {
      throw new ForbiddenException('Sin acceso a esta épica');
    }

    const userPodIds = new Set(user.podIds);
    const hasAccess = epic.pods.some((ep) => userPodIds.has(ep.podId));
    if (!hasAccess) throw new ForbiddenException('Sin acceso a esta épica');
  }

  // ── Cache endpoints (deben registrarse ANTES del catch-all :epicId) ──

  @Get(':epicId/cache')
  @Permissions(Permission.CREATE_STORY)
  @ApiOperation({ summary: 'Recuperar sesión de generación de historias cacheada' })
  async getCache(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessEpic(user, epicId);
    const session = await this.cache.getSession(epicId);
    if (!session) return { session: null };
    const remainingSeconds = await this.cache.getRemainingTtl(epicId);
    return { session, remainingSeconds };
  }

  @Get(':epicId/cache/ttl')
  @Permissions(Permission.CREATE_STORY)
  @ApiOperation({ summary: 'TTL restante del cache de historias' })
  async getCacheTtl(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessEpic(user, epicId);
    const remainingSeconds = await this.cache.getRemainingTtl(epicId);
    return { remainingSeconds };
  }

  @Delete(':epicId/cache')
  @Permissions(Permission.CREATE_STORY)
  @ApiOperation({ summary: 'Invalidar cache de generación de historias' })
  async invalidateCache(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessEpic(user, epicId);
    await this.cache.invalidateSession(epicId);
    return { ok: true };
  }

  @Delete(':epicId/cache/proposals/:clientId')
  @Permissions(Permission.CREATE_STORY)
  @ApiOperation({ summary: 'Remover propuesta de historia del cache' })
  async removeProposal(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Param('clientId') clientId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessEpic(user, epicId);
    // Validacion defensiva de formato del clientId — evita inyeccion de caracteres
    // especiales en la key de Redis o en logs aguas abajo.
    if (!/^ai-story-[a-f0-9-]{8,}$/i.test(clientId)) {
      throw new ForbiddenException('Formato de clientId inválido');
    }
    await this.cache.removeProposal(epicId, clientId);
    return { ok: true };
  }

  // ── SSE streaming (LAST — :epicId es catch-all) ──

  /**
   * Throttle estricto: 5 SSE generate-requests por minuto por IP.
   * Es independiente del cap por usuario que hace el registry. Esto
   * protege contra script kiddies con un solo token reusando IP, mientras
   * que el cap de registry protege contra users autorizados intentando
   * fan-out cross-epic.
   */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Get(':epicId')
  @Permissions(Permission.CREATE_STORY)
  @ApiOperation({ summary: 'Generar historias con IA via SSE (agentes PO + TL + QA)' })
  async generate(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Query() query: GenerateStoriesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Check de autorizacion ANTES de flushHeaders — asi NestJS puede devolver 403
    // como JSON plano en vez de mitad-SSE mitad-error.
    await this.assertUserCanAccessEpic(user, epicId);
    const webSearchEnabled = query.webSearch === true;
    // CWE-117: sanitizar el prompt del usuario antes de log. Evita log injection y
    // evita que credenciales pegadas accidentalmente en el prompt lleguen a logs externos.
    const promptForLog = query.prompt ? sanitizeForLog(query.prompt) : '';
    this.logger.log(
      `[SSE:story-gen] ═══ CONNECT user=${user.sub} role=${user.role} epic=${epicId} prompt="${promptForLog}" count=${query.count ?? 'auto'} webSearch=${webSearchEnabled}`,
    );

    // Registramos el run ANTES de flushHeaders. Si ya hay run activo o el
    // user excede su cap, ConflictException sale como 409 JSON real (no
    // SSE-as-200). El registry valida ambas condiciones atómicamente.
    //
    // Hard timeout 30min (override del default 10min): el flujo de stories
    // ejecuta 3 sub-agentes secuenciales (PO + TL + QA), cada uno con
    // exploración de vault y razonamiento extendido. Cabezas de ~10min ya
    // no son suficientes — el TL o QA terminaba el thinking y, justo
    // cuando estaba estructurando la entrega, el timer disparaba con
    // proposals=0 (todo el trabajo desperdiciado).
    // Hard timeout: 45 min. El flujo completo (PO + TL + QA secuenciales)
    // puede acercarse a este rango cuando QA o TL se topan con
    // `stop_reason='max_tokens'` y el sistema fuerza retries — observamos
    // abortos con `events=1699 proposals=0` cuando el cap era 30 min, el
    // agente nunca convergía. Subir a 45 min da margen para 3-4 iteraciones
    // sin ser excesivo. Mantener alineado con el `timeout` del cliente
    // Anthropic en story-generation.service.ts.
    const STORIES_HARD_TIMEOUT_MS = 45 * 60 * 1000;
    const abortController = new AbortController();
    this.registry.register(user.sub, epicId, abortController, STORIES_HARD_TIMEOUT_MS);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // X-Accel-Buffering: no — desactiva el buffering de proxies tipo nginx
    // para que cada heartbeat/event se entregue al cliente inmediatamente.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Heartbeat SSE: previene `UND_ERR_BODY_TIMEOUT` (undici default 5min)
    // cuando los agentes IA tardan mucho entre eventos significativos
    // (ej. deep research con webSearch puede tener gaps de >5min). Sin
    // esto, corridas largas se cortan aunque el agente siga trabajando.
    const stopHeartbeat = setupSseHeartbeat(res);

    let clientDisconnected = false;
    let streamCompleted = false;

    // CRÍTICO: el cierre del cliente NO aborta al agente. El agente sigue
    // corriendo en background, escribiendo al cache. El user puede:
    //   - Recargar la página → la hidratación lee del cache + polling le da
    //     los events nuevos.
    //   - Cancelar explícitamente → DELETE /:epicId/session/active aborta
    //     el AbortController.
    // Esto es lo que arregla el comportamiento donde refrescar mataba al
    // agente. Solo seteamos un flag para dejar de escribir al socket muerto.
    req.on('close', () => {
      if (streamCompleted) {
        return;
      }
      clientDisconnected = true;
      // Detener heartbeat al socket muerto — el agente sigue en background
      // pero no necesitamos seguir intentando pings al cliente desconectado.
      stopHeartbeat();
      this.logger.log(`[SSE:story-gen] client disconnected — agent continues in background epic=${epicId}`);
    });

    const subject = this.generation.generate(
      epicId,
      query.prompt,
      query.count, // undefined si no se envio — el agente PO decide el numero de historias
      abortController.signal,
      webSearchEnabled,
    );

    const collectedEvents: StoryGenerationEvent[] = [];
    const collectedProposals: ProposedStory[] = [];

    this.cache.initSession(epicId).catch(() => {});

    subject.subscribe({
      next: (event) => {
        // Si el cliente ya cerró, no escribimos al socket pero SÍ seguimos
        // acumulando al cache para que el cliente que vuelva pueda leer.
        if (!clientDisconnected) {
          try {
            res.write(`data: ${JSON.stringify(event.data)}\n\n`);
          } catch {
            clientDisconnected = true;
          }
        }

        const data = event.data as StoryGenerationEvent;
        collectedEvents.push(data);

        if (data.type === 'proposal_ready') {
          collectedProposals.push((data as StoryGenerationEvent & { type: 'proposal_ready' }).story);
        }

        // Persistencia incremental sin race condition: writeSession reescribe
        // el state COMPLETO desde memoria local (sin read-modify-write como el
        // patrón legacy `appendEvent`/`appendProposal`).
        this.cache.writeSession(epicId, collectedEvents, collectedProposals).catch(() => {});
      },
      complete: () => {
        this.logger.log(
          `[SSE:story-gen] ═══ DISCONNECT epic=${epicId} events=${collectedEvents.length} proposals=${collectedProposals.length} clientDisconnected=${clientDisconnected}`,
        );
        streamCompleted = true;
        stopHeartbeat();
        // unregister hace compare-and-swap por identidad: solo libera el
        // slot si el activeRun sigue siendo el nuestro. Idempotente.
        this.registry.unregister(user.sub, epicId, abortController);

        if (!clientDisconnected) {
          try { res.end(); } catch { /* socket ya cerrado */ }
        }

        // Identidad por AbortController — un cancel sobre otro controller
        // del mismo epic no afecta este persist.
        if (this.registry.wasCancelled(abortController)) {
          this.logger.log(`[SSE:story-gen] skipping cache save — run was explicitly cancelled`);
          return;
        }

        // Si terminó sin proposals, invalidamos la sesión en lugar de
        // persistir un staging vacío que confunde la hidratación futura.
        if (collectedProposals.length === 0) {
          this.cache.invalidateSession(epicId).catch(() => {});
          this.logger.log(`[SSE:story-gen] no proposals — invalidating session`);
          return;
        }

        this.cache.saveFullSession(epicId, collectedEvents, collectedProposals)
          .then(() => this.logger.log(`[SSE:story-gen] cache saved (${collectedProposals.length} proposals)`))
          .catch((e) => this.logger.warn(`[SSE:story-gen] saveFullSession failed: ${e.message}`));
      },
      error: (err) => {
        this.logger.error(`[SSE:story-gen] ✗ stream error: ${err?.message}`);
        streamCompleted = true;
        stopHeartbeat();
        this.registry.unregister(user.sub, epicId, abortController);

        if (!clientDisconnected) {
          try {
            res.write(`data: ${JSON.stringify({ type: 'error', message: 'Error interno' })}\n\n`);
            res.end();
          } catch { /* socket ya cerrado */ }
        }

        if (this.registry.wasCancelled(abortController)) {
          this.cache.invalidateSession(epicId).catch(() => {});
          return;
        }

        // Errores no-cancelados con 0 propuestas: invalidar en lugar
        // de persistir un staging huérfano.
        if (collectedProposals.length === 0) {
          this.cache.invalidateSession(epicId).catch(() => {});
          return;
        }

        this.cache.saveFullSession(epicId, collectedEvents, collectedProposals)
          .catch(() => {});
      },
    });
  }

  // ── Session endpoints (para hidratación + cancel explícito) ──

  @Get(':epicId/session')
  @Permissions(Permission.CREATE_STORY)
  @ApiOperation({ summary: 'Recuperar sesión actual (incluye streaming activo)' })
  async getSession(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessEpic(user, epicId);
    const session = await this.cache.getSession(epicId);
    if (!session) return { session: null, isActive: false };
    return {
      session,
      isActive: this.registry.isActive(epicId),
    };
  }

  @Delete(':epicId/session/active')
  @Permissions(Permission.CREATE_STORY)
  @ApiOperation({ summary: 'Cancelar el agente activo (abort + invalidar cache). Solo el usuario que inició el run o AltaGerencia pueden cancelarlo.' })
  async cancelActiveRun(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessEpic(user, epicId);
    const run = this.registry.getController(epicId);
    if (!run) {
      // No hay run activo: aún así limpiamos cualquier cache de sesión que
      // pueda haber quedado de un run anterior. Idempotente. No requiere
      // ownership check — no hay run que ownear.
      await this.cache.invalidateSession(epicId).catch(() => {});
      return { cancelled: false, reason: 'no-active-run' };
    }
    // Ownership: solo el usuario que arrancó el run puede cancelarlo.
    // AltaGerencia mantiene override admin.
    if (user.role !== UserRole.AltaGerencia && !this.registry.isOwner(epicId, user.sub)) {
      throw new ForbiddenException('Solo el usuario que inició la generación puede cancelarla.');
    }
    // Marca el AbortController específico como cancelado por identidad.
    // El subject.complete del run verifica esto antes de regrabar al cache.
    // Cleanup completo (mapas + timeout) lo hace el complete callback al
    // recibir la señal de abort.
    this.registry.markCancelled(run);
    run.abort();
    await this.cache.invalidateSession(epicId).catch(() => {});
    // Belt-and-suspenders: por si alguna escritura al cache estaba in-flight
    // entre el abort y la invalidación, re-invalida 500ms después. NO borra
    // cache de un nuevo run iniciado tras el cancel.
    setTimeout(() => {
      if (!this.registry.isActive(epicId)) {
        this.cache.invalidateSession(epicId).catch(() => {});
      }
    }, 500);
    this.logger.log(`[SSE:story-gen] ✗ run cancelled by user=${user.sub} epic=${epicId}`);
    return { cancelled: true };
  }
}
