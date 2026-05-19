import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
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
import type { AuthenticatedUser, DiagramGenerationEvent, DiagramGenerationType, EpicDiagram } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../../../auth/decorators';
import { PrismaService } from '../../../prisma/prisma.service';
import { DiagramGenerationService } from './diagram-generation.service';
import { DiagramSessionCacheService } from './diagram-session-cache.service';
import { GenerateDiagramQueryDto } from './dto/generate-diagram.dto';
import { SaveCachedDiagramDto } from './dto/save-cached-diagram.dto';
import { DiagramTypeQueryDto } from './dto/diagram-type.dto';
import { sanitizeForLog } from '../../../../common/utils/sanitize-llm-input.util';
import { setupSseHeartbeat } from '../../../../common/utils/sse-heartbeat.util';
import { AgentRunRegistryService } from '../../../../common/services/agent-run-registry.service';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@ApiTags('Diagramas — Generación IA')
@Controller('proyectos/diagram-generation')
export class DiagramGenerationController {
  constructor(
    private readonly generation: DiagramGenerationService,
    private readonly sessionCache: DiagramSessionCacheService,
    private readonly registry: AgentRunRegistryService,
    private readonly prisma: PrismaService,
    @InjectPinoLogger(DiagramGenerationController.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * CWE-639 / OWASP A01: autorización a nivel objeto (BOLA).
   *
   * Sin este check, cualquier usuario con `CREATE_DIAGRAM`/`EDIT_DIAGRAM`
   * podía:
   *  - Cancelar runs activos de épicas de otros pods (DELETE /session/active).
   *  - Leer events SSE en curso de otros pods (GET /session) — leak de
   *    cadena de pensamiento del agente con datos sensibles.
   *  - Leer/sobrescribir/resetear el cache del diagrama de otros pods.
   *
   * Espejo del patrón en story/epic generation. AltaGerencia bypass; resto
   * requiere intersección no-vacía de podIds.
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

  private runKey(epicId: string, type: DiagramGenerationType): string {
    return `${epicId}:${type}`;
  }

  /**
   * Lectura del cache Redis (TTL 5 días). Se registra ANTES de `@Get(':epicId')`
   * por claridad de lectura — NestJS resuelve rutas por especificidad así que
   * `/cached` gana automáticamente, pero mantener el orden en el archivo ayuda.
   */
  @Get(':epicId/cached')
  @Permissions(Permission.CREATE_DIAGRAM)
  @ApiOperation({ summary: 'Obtener diagrama cacheado de la épica (si existe)' })
  async getCached(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Query() query: DiagramTypeQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ diagram: EpicDiagram | null }> {
    await this.assertUserCanAccessEpic(user, epicId);
    const type = query.type ?? 'business';
    const diagram = await this.generation.getCached(epicId, type);
    return { diagram };
  }

  /**
   * Persiste un diagrama editado manualmente. El frontend llama aquí tras
   * cambios del editor (drag de nodos, edición de labels, etc.). El service
   * marca `generatedBy: 'manual'` y refresca `generatedAt`. TTL 5 días al
   * igual que el flujo de generación IA.
   */
  @Put(':epicId/cached')
  @Permissions(Permission.EDIT_DIAGRAM)
  @ApiOperation({ summary: 'Persiste un diagrama editado al cache Redis (TTL 5d)' })
  async saveCached(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Body() dto: SaveCachedDiagramDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ diagram: EpicDiagram }> {
    await this.assertUserCanAccessEpic(user, epicId);
    this.logger.info({ epicId, type: dto.type }, `[saveCached] epic=${epicId} type=${dto.type}`);
    const diagram = await this.generation.saveCached(
      epicId,
      dto.type,
      dto.diagram,
      user,
    );
    return { diagram };
  }

  /**
   * Resetea el layout manual del diagrama cacheado. Pone `hasManualLayout=false`
   * y elimina `manualPositions`, forzando que el siguiente render recalcule
   * las posiciones con el layout engine actual.
   *
   * Útil tras mejoras al engine — los diagramas con layout manual previo no
   * aprovechaban los cambios. El user dispara este reset explícitamente desde
   * la UI; es irreversible en términos de positions (las posiciones manuales
   * se pierden), pero el contenido semántico (nodos/edges/labels) se preserva.
   */
  @Patch(':epicId/reset-layout')
  @Permissions(Permission.EDIT_DIAGRAM)
  @ApiOperation({ summary: 'Recalcula el layout del diagrama (descarta posiciones manuales)' })
  async resetLayout(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Query() query: DiagramTypeQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ diagram: EpicDiagram | null }> {
    await this.assertUserCanAccessEpic(user, epicId);
    const type = query.type ?? 'business';
    this.logger.info({ epicId, type }, `[resetLayout] epic=${epicId} type=${type}`);
    const diagram = await this.generation.resetLayout(epicId, type, user);
    return { diagram };
  }

  /**
   * Backfill: genera el documento de flujo de integración + `steps` sobre
   * un diagrama YA cacheado. El backend NO regenera el diagrama — solo
   * enriquece el diagrama existente con metadatos nuevos y escribe el
   * documento al vault. Útil para diagramas legacy (pre-fase 3) que no
   * tienen `steps` ni `integrationFlowDocPath`.
   *
   * Registrado ANTES de `@Get(':epicId')` porque es más específico: sin
   * este orden NestJS resolvería esta ruta con el handler genérico `generate`,
   * tratando "generate-integration-doc" como un epicId (que fallaría el
   * ParseUUIDPipe, aunque silenciosamente en otro endpoint de misma forma).
   * Mantener el orden explícito previene futuras regresiones de routing.
   */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Get(':epicId/generate-integration-doc')
  @Permissions(Permission.CREATE_DIAGRAM)
  @ApiOperation({ summary: 'Backfill: genera documento de flujo sobre un diagrama existente' })
  async generateIntegrationDoc(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Query() query: DiagramTypeQueryDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessEpic(user, epicId);
    const type = query.type ?? 'business';
    this.logger.info({ epicId, type }, `[generateIntegrationDoc] epic=${epicId} type=${type}`);

    // Namespace separado para que el cap del registry NO confunda este
    // backfill con el run principal de generación de diagrama (que usa
    // key=`${epicId}:${type}`). Ambos pueden coexistir, pero ambos cuentan
    // contra el cap de 3 simultáneos del usuario.
    //
    // Hard timeout 20min: el backfill genera el integrationFlowMarkdown
    // sobre un diagrama existente — típicamente más rápido que el flujo
    // completo, pero igual puede tardar varios minutos con extended
    // thinking. Alineado con el timeout del flujo principal de diagrams.
    const INTEGRATION_DOC_HARD_TIMEOUT_MS = 20 * 60 * 1000;
    const runKey = `integration-doc:${epicId}:${type}`;
    const abortController = new AbortController();
    this.registry.register(user.sub, runKey, abortController, INTEGRATION_DOC_HARD_TIMEOUT_MS);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const stopHeartbeat = setupSseHeartbeat(res);

    // Backfill abort-on-close: a diferencia del flujo principal que
    // continúa en background, este backfill es corto y no merece el
    // overhead de session cache + polling. Si el user cierra, abortamos.
    req.on('close', () => {
      stopHeartbeat();
      this.logger.info(`[generateIntegrationDoc] Client disconnected, aborting agent`);
      abortController.abort();
    });

    const subject = this.generation.generateIntegrationDoc(
      epicId,
      type,
      user,
      abortController.signal,
    );

    subject.subscribe({
      next: (event) => {
        try {
          res.write(`data: ${JSON.stringify(event.data)}\n\n`);
        } catch { /* socket cerrado */ }
      },
      complete: () => {
        stopHeartbeat();
        this.registry.unregister(user.sub, runKey, abortController);
        this.logger.info({ epicId }, `[generateIntegrationDoc] SSE stream finalized for epic=${epicId}`);
        if (!res.writableEnded) res.end();
      },
      error: (err) => {
        stopHeartbeat();
        this.registry.unregister(user.sub, runKey, abortController);
        this.logger.error({ message: err?.message }, `[generateIntegrationDoc] SSE stream error: ${err?.message}`);
        try {
          res.write(`data: ${JSON.stringify({ type: 'error', message: 'Error interno' })}\n\n`);
          res.end();
        } catch { /* socket cerrado */ }
      },
    });
  }

  /**
   * Recupera la sesión SSE en curso (events acumulados). Permite que un
   * cliente que cierre la pestaña y vuelva vea la cadena de pensamiento
   * hasta donde había llegado el agente.
   */
  @Get(':epicId/session')
  @Permissions(Permission.CREATE_DIAGRAM)
  @ApiOperation({ summary: 'Recuperar sesión SSE cacheada (events del agente en curso/terminado)' })
  async getSession(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Query() query: DiagramTypeQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessEpic(user, epicId);
    const type = query.type ?? 'business';
    const session = await this.sessionCache.getSession(epicId, type);
    return { session };
  }

  /**
   * Cancela el run activo (aborta agente backend + invalida cache).
   * Idempotente: limpia el cache aunque no haya run activo.
   */
  @Delete(':epicId/session/active')
  @Permissions(Permission.CREATE_DIAGRAM)
  @ApiOperation({ summary: 'Cancelar el run activo de generación de diagrama. Solo el usuario que inició el run o AltaGerencia pueden cancelarlo.' })
  async cancelActiveRun(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Query() query: DiagramTypeQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessEpic(user, epicId);
    const type = query.type ?? 'business';
    const key = this.runKey(epicId, type);
    const controller = this.registry.getController(key);
    if (controller) {
      // Ownership: solo el usuario que arrancó el run puede cancelarlo.
      // AltaGerencia mantiene override admin. Si no hay controller activo,
      // saltamos este check — la limpieza de cache es idempotente.
      if (user.role !== UserRole.AltaGerencia && !this.registry.isOwner(key, user.sub)) {
        throw new ForbiddenException('Solo el usuario que inició la generación puede cancelarla.');
      }
      this.logger.info({ key }, `[cancel] aborting active run for ${key}`);
      this.registry.markCancelled(controller);
      controller.abort();
    }
    await this.sessionCache.invalidateSession(epicId, type);
    // Re-invalidar tras 500ms para barrer cualquier writeSession tardío.
    // Solo invalidamos si NO hay nuevo run activo bajo la misma key.
    setTimeout(() => {
      if (!this.registry.isActive(key)) {
        this.sessionCache.invalidateSession(epicId, type).catch(() => {});
      }
    }, 500);
    return { ok: true, hadActiveRun: !!controller };
  }

  /**
   * Throttle: 5 SSE generate-requests por minuto por IP. Cap por user
   * (3 simultáneos cross-tipo) lo gestiona el registry.
   */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Get(':epicId')
  @Permissions(Permission.CREATE_DIAGRAM)
  @ApiOperation({ summary: 'Generar un diagrama de la épica con IA via SSE' })
  async generate(
    @Param('epicId', ParseUUIDPipe) epicId: string,
    @Query() query: GenerateDiagramQueryDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessEpic(user, epicId);
    const type = query.type ?? 'business';
    const safePromptForLog = query.prompt ? sanitizeForLog(query.prompt) : '';
    this.logger.info({ epicId, type, safePromptForLog }, `[generate] epic=${epicId} type=${type} prompt="${safePromptForLog}"`);

    const runKey = this.runKey(epicId, type);
    // Registramos el run ANTES de flushHeaders. ConflictException se
    // propaga como 409 JSON real si user excede cap o ya hay run activo.
    //
    // Hard timeout 20min (override del default 10min): el flujo de diagrams
    // tiene un agente principal que genera el JSON visual (nodes + edges +
    // labels + steps) PLUS un `integrationFlowMarkdown` HIPER detallado
    // (vimos casos de 23KB+). Cuando combinas extended thinking + tool_use
    // grande con `submit_diagram` que serializa todo eso, 10min ya no es
    // suficiente — observado: agentes que abortaban a los 10min exactos en
    // iter7-8 mientras estaban estructurando la entrega final.
    const DIAGRAMS_HARD_TIMEOUT_MS = 20 * 60 * 1000;
    const abortController = new AbortController();
    this.registry.register(user.sub, runKey, abortController, DIAGRAMS_HARD_TIMEOUT_MS);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const stopHeartbeat = setupSseHeartbeat(res);

    let clientDisconnected = false;
    let streamCompleted = false;

    req.on('close', () => {
      // Cuando el server llama `res.end()` en complete/error, Node emite
      // `close` también — el guard `streamCompleted` evita loguear "Client
      // disconnected" como falso positivo en terminaciones normales.
      if (streamCompleted) return;
      // El user cerró/cambió tab. NO abortamos al instante — el agente
      // sigue corriendo en background y eventos se acumulan en cache vía
      // writeSession. El registry tiene su propio hard-timeout (10min)
      // que dispara como red de seguridad si nadie regresa.
      if (clientDisconnected) return;
      stopHeartbeat();
      this.logger.info(`[generate] Client disconnected — agent continues in background`);
      clientDisconnected = true;
    });

    const subject = this.generation.generate(
      epicId,
      type,
      query.prompt,
      abortController.signal,
      user,
    );

    /** Wrapper defensivo: tras `req.close`, escribir al socket cerrado tira
     *  ERR_STREAM_WRITE_AFTER_END. Capturamos para que el subject siga vivo
     *  y el agente complete hacia el cache de fondo. */
    const safeWrite = (payload: string): void => {
      if (clientDisconnected || res.writableEnded) return;
      try {
        res.write(payload);
      } catch (e) {
        this.logger.debug({ message: (e as Error)?.message }, `[generate] write failed (client gone): ${(e as Error)?.message}`);
      }
    };

    const collectedEvents: DiagramGenerationEvent[] = [];
    const subscribeStart = Date.now();
    let emitCount = 0;

    subject.subscribe({
      next: (event) => {
        emitCount++;
        const data = event.data as DiagramGenerationEvent;
        safeWrite(`data: ${JSON.stringify(event.data)}\n\n`);
        collectedEvents.push(data);

        // Identidad por AbortController — si fue cancelado vía DELETE,
        // saltamos writeSession para no recrear cache que cancelActiveRun
        // ya invalidó. Otro run con misma key tras restart NO está marcado.
        if (this.registry.wasCancelled(abortController)) return;

        // Persistencia incremental sin race: writeSession reescribe el state
        // COMPLETO desde memoria local (sin read-modify-write).
        this.sessionCache.writeSession(epicId, type, collectedEvents, 'streaming').catch(() => {});
      },
      complete: () => {
        streamCompleted = true;
        stopHeartbeat();
        this.registry.unregister(user.sub, runKey, abortController);
        this.logger.info({ epicId, type, clientDisconnected, aborted: abortController.signal.aborted }, `[generate] SSE stream finalized for epic=${epicId} type=${type} (clientDisconnected=${clientDisconnected}, aborted=${abortController.signal.aborted})`);
        if (!res.writableEnded) res.end();

        if (this.registry.wasCancelled(abortController)) return;

        // Marcar la sesión como completada — el cliente lo detecta vía status='staging'.
        this.sessionCache.writeSession(epicId, type, collectedEvents, 'staging').catch(() => {});
      },
      error: (err) => {
        streamCompleted = true;
        stopHeartbeat();
        this.registry.unregister(user.sub, runKey, abortController);
        this.logger.error({ message: err?.message }, `[generate] SSE stream error: ${err?.message}`);
        safeWrite(`data: ${JSON.stringify({ type: 'error', message: 'Error interno' })}\n\n`);
        if (!res.writableEnded) res.end();

        if (this.registry.wasCancelled(abortController)) return;

        // Aún en error real: persistir lo que hayamos acumulado.
        this.sessionCache.writeSession(epicId, type, collectedEvents, 'staging').catch(() => {});
      },
    });
  }
}
