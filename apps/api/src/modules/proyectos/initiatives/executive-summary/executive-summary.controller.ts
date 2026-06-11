import {
  Controller,
  Get,
  Delete,
  Param,
  Req,
  Res,
  ParseUUIDPipe,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Permission, UserRole } from '@cenzontle/shared';
import type { AuthenticatedUser, ExecutiveSummary } from '@cenzontle/shared';
import { Permissions, CurrentUser } from '../../../auth/decorators';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExecutiveSummaryService } from './executive-summary.service';
import { setupSseHeartbeat } from '../../../../common/utils/sse-heartbeat.util';
import { AgentRunRegistryService } from '../../../../common/services/agent-run-registry.service';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@ApiTags('Iniciativas — Resumen Ejecutivo IA')
@Controller('proyectos/executive-summary')
export class ExecutiveSummaryController {
  constructor(
    private readonly summaries: ExecutiveSummaryService,
    private readonly prisma: PrismaService,
    private readonly registry: AgentRunRegistryService,
    @InjectPinoLogger(ExecutiveSummaryController.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Key del AgentRunRegistry prefijada por tipo de agente. El registry indexa
   * por string arbitrario — sin el prefijo, un run de executive-summary
   * colisionaría (ConflictException espuria) con un run de epic-generation
   * de la MISMA iniciativa, que registra con el initiativeId pelado.
   */
  private registryKey(initiativeId: string): string {
    return `exec-summary:${initiativeId}`;
  }

  /**
   * CWE-639 / OWASP A01: autorizacion a nivel objeto para la iniciativa.
   *
   * `@Permissions(Permission.EDIT_INITIATIVE)` solo valida el permiso global
   * del JWT. Sin este check, cualquier usuario con EDIT_INITIATIVE podria
   * generar (y leer) resumenes ejecutivos de cualquier initiativeId — leaking
   * contenido via SSE (metricas completas, extractos de epicas, narrativa) o
   * cancelar runs de terceros.
   *
   * Regla de acceso (basada en epic-generation, con una diferencia deliberada):
   *   - `AltaGerencia` tiene acceso global (bypass).
   *   - Los podIds de la iniciativa se derivan de la UNION de EpicPod y
   *     Story.podId — no solo de EpicPod. Las metricas que este feature
   *     expone (computeMetrics) se agregan a nivel historia via story.podId,
   *     que en el schema es una relacion independiente de EpicPod. Derivar la
   *     autz solo de EpicPod dejaria pasar a cualquier usuario cuando las
   *     epicas no tienen filas EpicPod pero sus historias SI tienen pod.
   *   - Si la union queda vacia (iniciativa sin pods en ninguna fuente),
   *     permitir acceso a cualquier usuario con EDIT_INITIATIVE (@Permissions
   *     ya valido). El leak es minimo: sin historias ni pods casi no hay
   *     metricas que exponer.
   *   - Con pods asignados, el usuario debe tener interseccion de podIds.
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

    // Iniciativa sin pods en ninguna fuente → permitir
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

  // ── Rutas específicas (must be defined BEFORE the :initiativeId SSE route) ──

  @Get(':initiativeId/cached')
  @Permissions(Permission.EDIT_INITIATIVE)
  @ApiOperation({ summary: 'Último resumen ejecutivo persistido en la iniciativa (o null)' })
  async getCached(
    @Param('initiativeId', ParseUUIDPipe) initiativeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ summary: ExecutiveSummary | null }> {
    await this.assertUserCanAccessInitiative(user, initiativeId);
    const initiative = await this.prisma.initiative.findUnique({
      where: { id: initiativeId },
      select: { executiveSummary: true },
    });
    if (!initiative) throw new NotFoundException('Iniciativa no encontrada');
    // El Json de Prisma viene sin tipo — el service es el único writer y
    // siempre persiste un ExecutiveSummary completo, así que el cast es seguro.
    return { summary: (initiative.executiveSummary as unknown as ExecutiveSummary | null) ?? null };
  }

  @Delete(':initiativeId/active')
  @Permissions(Permission.EDIT_INITIATIVE)
  @ApiOperation({
    summary:
      'Cancelar el run de resumen ejecutivo activo (aborta el agente backend). Solo el usuario que inició el run o AltaGerencia pueden cancelarlo.',
  })
  async cancelActiveRun(
    @Param('initiativeId', ParseUUIDPipe) initiativeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertUserCanAccessInitiative(user, initiativeId);
    const key = this.registryKey(initiativeId);
    const controller = this.registry.getController(key);
    if (controller) {
      // Ownership: solo el usuario que arrancó el run puede cancelarlo.
      // AltaGerencia mantiene override admin.
      if (user.role !== UserRole.AltaGerencia && !this.registry.isOwner(key, user.sub)) {
        throw new ForbiddenException('Solo el usuario que inició la generación puede cancelarla.');
      }
      this.logger.info({ initiativeId }, `[cancel] aborting active exec-summary run for ${initiativeId}`);
      this.registry.markCancelled(controller);
      controller.abort();
    }
    // A diferencia de epic-generation, aquí NO hay cache Redis que invalidar:
    // el resultado vive en initiative.executiveSummary y solo se sobreescribe
    // cuando un run completa con summary_ready. Cancelar deja el último
    // resumen válido intacto. Idempotente sin run activo.
    return { ok: true, hadActiveRun: !!controller };
  }

  // ── SSE streaming (must be LAST — :initiativeId is a catch-all param) ──

  /**
   * Throttle: 5 SSE generate-requests por minuto por IP. Cap por user
   * (3 simultáneos cross-tipo) lo gestiona el registry.
   */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Get(':initiativeId')
  @Permissions(Permission.EDIT_INITIATIVE)
  @ApiOperation({ summary: 'Generar resumen ejecutivo con IA via SSE' })
  async generate(
    @Param('initiativeId', ParseUUIDPipe) initiativeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Check de autorizacion ANTES de flushHeaders — asi NestJS puede devolver
    // 403 como JSON plano en vez de mitad-SSE mitad-error.
    await this.assertUserCanAccessInitiative(user, initiativeId);

    this.logger.info({ initiativeId }, `[generate] executive summary for initiative=${initiativeId}`);

    // Registramos el run ANTES de flushHeaders. ConflictException se propaga
    // como 409 JSON real si el user excede el cap o ya hay run activo. El
    // registry instala su hard timeout de 10min y se limpia en
    // complete/error vía unregister().
    const abortController = new AbortController();
    const key = this.registryKey(initiativeId);
    this.registry.register(user.sub, key, abortController);

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
      // corriendo en background y al completar persiste el resumen en la BD,
      // recuperable vía GET :initiativeId/cached. El registry tiene su propio
      // hard-timeout (10min) como red de seguridad.
      if (clientDisconnected) return;
      stopHeartbeat();
      this.logger.info(`[generate] Client disconnected — exec-summary agent continues in background`);
      clientDisconnected = true;
    });

    /** Wrapper defensivo: tras `req.close`, escribir al socket cerrado tira
     *  ERR_STREAM_WRITE_AFTER_END. Capturamos para que el subject no se
     *  rompa y el agente siga hasta persistir en BD. */
    const safeWrite = (payload: string): void => {
      if (clientDisconnected || res.writableEnded) return;
      try {
        res.write(payload);
      } catch (e) {
        this.logger.debug(
          { message: (e as Error)?.message },
          `[generate] write failed (client gone): ${(e as Error)?.message}`,
        );
      }
    };

    const subject = this.summaries.generate(initiativeId, user, abortController.signal);

    subject.subscribe({
      next: (event) => {
        safeWrite(`data: ${JSON.stringify(event.data)}\n\n`);
      },
      complete: () => {
        streamCompleted = true;
        stopHeartbeat();
        this.registry.unregister(user.sub, key, abortController);
        this.logger.info(
          { initiativeId, clientDisconnected },
          `[generate] exec-summary SSE finalized for ${initiativeId} (clientDisconnected=${clientDisconnected})`,
        );
        // Sin cache Redis que persistir: el service ya guardó el resumen en
        // initiative.executiveSummary antes de completar.
        if (!res.writableEnded) res.end();
      },
      error: (err: Error) => {
        streamCompleted = true;
        stopHeartbeat();
        this.registry.unregister(user.sub, key, abortController);
        this.logger.error({ message: err?.message }, `[generate] exec-summary SSE error: ${err?.message}`);
        safeWrite(`data: ${JSON.stringify({ type: 'error', message: 'Error interno' })}\n\n`);
        if (!res.writableEnded) res.end();
      },
    });
  }
}
