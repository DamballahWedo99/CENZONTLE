import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Req,
  Res,
  ParseUUIDPipe,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Permission, UserRole } from '@cenzontle/shared';
import type { EpicGenerationEvent, ProposedEpic, AuthenticatedUser } from '@cenzontle/shared';
import { Permissions, CurrentUser } from '../../../auth/decorators';
import { PrismaService } from '../../../prisma/prisma.service';
import { EpicGenerationService } from './epic-generation.service';
import { ProposalCacheService } from './proposal-cache.service';
import { GenerateEpicsQueryDto } from './dto/generate-epics.dto';
import { scrubSecrets } from '../../../../common/utils/scrub-secrets.util';
import { sanitizeForLog } from '../../../../common/utils/sanitize-llm-input.util';
import { setupSseHeartbeat } from '../../../../common/utils/sse-heartbeat.util';
import { AgentRunRegistryService } from '../../../../common/services/agent-run-registry.service';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@ApiTags('Épicas — Generación IA')
@Controller('proyectos/epic-generation')
export class EpicGenerationController {
  constructor(
    private readonly generation: EpicGenerationService,
    private readonly cache: ProposalCacheService,
    private readonly prisma: PrismaService,
    private readonly registry: AgentRunRegistryService,
    @InjectPinoLogger(EpicGenerationController.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * CWE-639 / OWASP A01: autorizacion a nivel objeto para la iniciativa.
   *
   * `@Permissions(Permission.CREATE_EPIC)` solo valida el permiso global del JWT.
   * Sin este check, cualquier usuario con CREATE_EPIC podria generar epicas en
   * cualquier iniciativaId — leaking contenido via SSE (descripcion, documentos,
   * pods, epicas existentes) o borrar cache de terceros.
   *
   * Regla de acceso:
   *   - `AltaGerencia` tiene acceso global (bypass).
   *   - Los podIds de la iniciativa se derivan de la UNION de EpicPod y
   *     Story.podId — no solo de EpicPod. `Story.podId` es una relacion
   *     independiente en el schema: epicas sin filas EpicPod pero con
   *     historias asignadas a pods caian en la rama "sin pods → permitir",
   *     exponiendo contenido via SSE a cualquier usuario con CREATE_EPIC.
   *   - Si la union queda vacia, permitir acceso a cualquier usuario con
   *     CREATE_EPIC (@Permissions ya valido). Este caso es LEGITIMO: generar
   *     las primeras epicas de una iniciativa recien creada. El leak es
   *     minimo porque no hay <existing_epics> que exponer.
   *   - Con pods asignados, el usuario debe tener al menos un podId en comun.
   */
  private async assertUserCanAccessInitiative(
    user: AuthenticatedUser,
    initiativeId: string,
  ): Promise<void> {
    if (user.role === UserRole.AltaGerencia) return;

    const initiative = await this.prisma.initiative.findUnique({
      where: { id: initiativeId },
      select: {
        id: true,
        epics: {
          select: {
            pods: { select: { podId: true } },
            stories: { select: { podId: true } },
          },
        },
      },
    });
    if (!initiative) throw new NotFoundException('Iniciativa no encontrada');

    // Union de podIds: filas EpicPod + podId directo de cada historia
    const initiativePodIds = new Set<string>();
    for (const epic of initiative.epics) {
      for (const ep of epic.pods) {
        initiativePodIds.add(ep.podId);
      }
      for (const story of epic.stories) {
        if (story.podId) initiativePodIds.add(story.podId);
      }
    }

    // Iniciativa sin pods en ninguna fuente → permitir (caso de "primera epica")
    if (initiativePodIds.size === 0) return;

    // Caso con contenido → exigir interseccion
    const userPodIds = new Set(user.podIds);
    let hasIntersection = false;
    for (const pid of initiativePodIds) {
      if (userPodIds.has(pid)) {
        hasIntersection = true;
        break;
      }
    }
    if (!hasIntersection) throw new ForbiddenException('Sin acceso a esta iniciativa');
  }

  // ── Cache endpoints (must be defined BEFORE the :initiativeId SSE route) ──

  @Get(':initiativeId/cache')
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({ summary: 'Recuperar sesión de generación cacheada' })
  async getCache(
    @Param('initiativeId', ParseUUIDPipe) initiativeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessInitiative(user, initiativeId);
    const session = await this.cache.getSession(initiativeId);
    if (!session) return { session: null };
    const remainingSeconds = await this.cache.getRemainingTtl(initiativeId);
    return { session, remainingSeconds };
  }

  @Get(':initiativeId/cache/ttl')
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({ summary: 'TTL restante del cache' })
  async getCacheTtl(
    @Param('initiativeId', ParseUUIDPipe) initiativeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessInitiative(user, initiativeId);
    const remainingSeconds = await this.cache.getRemainingTtl(initiativeId);
    return { remainingSeconds };
  }

  @Delete(':initiativeId/cache')
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({ summary: 'Invalidar cache de generación' })
  async invalidateCache(
    @Param('initiativeId', ParseUUIDPipe) initiativeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessInitiative(user, initiativeId);
    await this.cache.invalidateSession(initiativeId);
    return { ok: true };
  }

  @Delete(':initiativeId/active')
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({
    summary:
      'Cancelar el run de generación activo (aborta el agente backend e invalida el cache). Solo el usuario que inició el run o AltaGerencia pueden cancelarlo.',
  })
  async cancelActiveRun(
    @Param('initiativeId', ParseUUIDPipe) initiativeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessInitiative(user, initiativeId);
    const controller = this.registry.getController(initiativeId);
    if (controller) {
      // Ownership: solo el usuario que arrancó el run puede cancelarlo.
      // AltaGerencia mantiene override admin.
      if (user.role !== UserRole.AltaGerencia && !this.registry.isOwner(initiativeId, user.sub)) {
        throw new ForbiddenException('Solo el usuario que inició la generación puede cancelarla.');
      }
      this.logger.info({ initiativeId }, `[cancel] aborting active run for ${initiativeId}`);
      this.registry.markCancelled(controller);
      controller.abort();
    }
    // Aunque no haya run activo (timeout ya disparó, server reinició, etc.),
    // limpiamos el cache. Idempotente.
    await this.cache.invalidateSession(initiativeId);
    return { ok: true, hadActiveRun: !!controller };
  }

  @Delete(':initiativeId/cache/proposals/:clientId')
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({ summary: 'Remover propuesta del cache' })
  async removeProposal(
    @Param('initiativeId', ParseUUIDPipe) initiativeId: string,
    @Param('clientId') clientId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessInitiative(user, initiativeId);
    // Validacion defensiva de formato del clientId — evita inyeccion de caracteres
    // especiales en la key de Redis o en logs aguas abajo.
    if (!/^ai-[a-f0-9-]{8,}$/i.test(clientId)) {
      throw new ForbiddenException('Formato de clientId inválido');
    }
    await this.cache.removeProposal(initiativeId, clientId);
    return { ok: true };
  }

  // ── SSE streaming (must be LAST — :initiativeId is a catch-all param) ──

  /**
   * Throttle: 5 SSE generate-requests por minuto por IP. Cap por user
   * (3 simultáneos cross-tipo) lo gestiona el registry.
   */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Get(':initiativeId')
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({ summary: 'Generar épicas con IA via SSE' })
  async generate(
    @Param('initiativeId', ParseUUIDPipe) initiativeId: string,
    @Query() query: GenerateEpicsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Check de autorizacion ANTES de flushHeaders — asi NestJS puede devolver 403
    // como JSON plano en vez de mitad-SSE mitad-error.
    await this.assertUserCanAccessInitiative(user, initiativeId);

    const webSearchEnabled = query.webSearch === true;
    // CWE-117 (log injection) + CWE-532 (secrets in logs): doble defensa —
    // scrubSecrets redacta PATs/tokens, sanitizeForLog strip control chars + trunca.
    const promptForLog = query.prompt ? sanitizeForLog(scrubSecrets(query.prompt)) : '';
    this.logger.info({ initiativeId, promptForLog, webSearchEnabled }, `[generate] initiative=${initiativeId} prompt="${promptForLog}" count=${query.count ?? 5} webSearch=${webSearchEnabled}`);

    // Registramos el run ANTES de flushHeaders. ConflictException se
    // propaga como 409 JSON real si user excede cap o ya hay run activo.
    // El registry instala su propio hard timeout de 10min y se limpia
    // automáticamente en complete/error vía unregister().
    const abortController = new AbortController();
    this.registry.register(user.sub, initiativeId, abortController);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Heartbeat SSE — previene UND_ERR_BODY_TIMEOUT en corridas largas.
    const stopHeartbeat = setupSseHeartbeat(res);

    let clientDisconnected = false;
    let streamCompleted = false;

    req.on('close', () => {
      // Cuando el server llama `res.end()` en complete/error, Node emite
      // `close` también — el guard `streamCompleted` evita loguear "Client
      // disconnected" como falso positivo en terminaciones normales.
      if (streamCompleted) return;
      // El user cerró/cambió tab. NO abortamos al instante — el agente sigue
      // corriendo en background y los eventos se siguen acumulando en Redis.
      // El registry tiene su propio hard-timeout (10min) que dispara como
      // red de seguridad si nadie regresa.
      if (clientDisconnected) return;
      stopHeartbeat();
      this.logger.info(`[generate] Client disconnected — agent continues in background`);
      clientDisconnected = true;
    });

    const subject = this.generation.generate(
      initiativeId,
      query.prompt,
      query.count ?? 5,
      abortController.signal,
      webSearchEnabled,
    );

    const collectedEvents: EpicGenerationEvent[] = [];
    const collectedProposals: ProposedEpic[] = [];

    await this.cache.initSession(initiativeId).catch((e) => {
      this.logger.warn({ message: e?.message }, `[cache] initSession failed: ${e?.message}`);
    });

    /** Wrapper defensivo: tras `req.close`, escribir al socket cerrado tira
     *  ERR_STREAM_WRITE_AFTER_END. Capturamos para que el subject no se
     *  rompa y el agente siga procesando hacia el cache de fondo. */
    const safeWrite = (payload: string): void => {
      if (clientDisconnected || res.writableEnded) return;
      try {
        res.write(payload);
      } catch (e) {
        this.logger.debug({ message: (e as Error)?.message }, `[generate] write failed (client gone): ${(e as Error)?.message}`);
      }
    };

    subject.subscribe({
      next: (event) => {
        const data = event.data as EpicGenerationEvent;
        safeWrite(`data: ${JSON.stringify(event.data)}\n\n`);

        collectedEvents.push(data);
        if (data.type === 'proposal_ready') {
          const proposal = (data as EpicGenerationEvent & { type: 'proposal_ready' }).epic;
          collectedProposals.push(proposal);
        }

        // Persistencia incremental sin race: writeSession reescribe el state
        // COMPLETO desde memoria local. Sin read-modify-write → sin lost
        // updates entre eventos consecutivos del burst final.
        this.cache.writeSession(initiativeId, collectedEvents, collectedProposals).catch(() => {});
      },
      complete: () => {
        streamCompleted = true;
        stopHeartbeat();
        this.registry.unregister(user.sub, initiativeId, abortController);
        this.logger.info({ initiativeId, clientDisconnected }, `[generate] SSE stream finalized for ${initiativeId} (clientDisconnected=${clientDisconnected})`);
        if (!res.writableEnded) res.end();

        if (this.registry.wasCancelled(abortController)) {
          this.cache.invalidateSession(initiativeId).catch(() => {});
          return;
        }

        // Persistimos el resultado completo SIEMPRE — incluso si el cliente
        // se desconectó. El cache contiene los eventos + proposals al regresar.
        this.cache.saveFullSession(initiativeId, collectedEvents, collectedProposals)
          .then(() => this.logger.debug({ length: collectedProposals.length, collectedEvents_length: collectedEvents.length }, `[cache] session saved: ${collectedProposals.length} proposals, ${collectedEvents.length} events`))
          .catch((e) => this.logger.warn({ message: e.message }, `[cache] saveFullSession failed: ${e.message}`));
      },
      error: (err) => {
        streamCompleted = true;
        stopHeartbeat();
        this.registry.unregister(user.sub, initiativeId, abortController);
        this.logger.error({ message: err?.message }, `[generate] SSE stream error: ${err?.message}`);
        safeWrite(`data: ${JSON.stringify({ type: 'error', message: 'Error interno' })}\n\n`);
        if (!res.writableEnded) res.end();

        if (this.registry.wasCancelled(abortController)) {
          this.cache.invalidateSession(initiativeId).catch(() => {});
          return;
        }

        // Aún en error: persistimos lo que hayamos acumulado. Defensa frente a
        // un user que regresa y al menos puede ver hasta dónde llegó el agente.
        this.cache.saveFullSession(initiativeId, collectedEvents, collectedProposals)
          .catch(() => {});
      },
    });
  }
}
