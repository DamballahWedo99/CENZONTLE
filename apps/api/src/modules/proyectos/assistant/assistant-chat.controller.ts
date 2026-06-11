import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  Permission,
  ROLE_PERMISSIONS,
  UserRole,
} from '@cenzontle/shared';
import type {
  AssistantChatEvent,
  AssistantEntityType,
  AuthenticatedUser,
} from '@cenzontle/shared';
import { CurrentUser } from '../../auth/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentRunRegistryService } from '../../../common/services/agent-run-registry.service';
import { setupSseHeartbeat } from '../../../common/utils/sse-heartbeat.util';
import {
  assertUserCanAccessEpicPods,
  assertUserCanAccessStoryByEpic,
} from '../epics/epic-access.util';
import { AssistantChatService } from './assistant-chat.service';
import { AssistantSessionService } from './assistant-session.service';
import { AssistantChatBodyDto, ProposalFeedbackBodyDto } from './dto/assistant-chat.dto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

const ENTITY_TYPES: AssistantEntityType[] = ['initiative', 'epic', 'story'];

/**
 * Permiso global requerido por tipo de entidad. El chat propone ediciones
 * sobre la entidad — exige el mismo permiso que el PATCH correspondiente.
 * El apply real va por los endpoints PATCH existentes con sus propios guards;
 * esto solo evita que un rol sin permiso de edición consuma el agente.
 */
const REQUIRED_PERMISSION: Record<AssistantEntityType, Permission> = {
  initiative: Permission.EDIT_INITIATIVE,
  epic: Permission.EDIT_EPIC,
  story: Permission.EDIT_STORY,
};

@ApiTags('Asistente — Chat de edición IA')
@Controller('proyectos/assistant-chat')
export class AssistantChatController {
  constructor(
    private readonly chat: AssistantChatService,
    private readonly sessions: AssistantSessionService,
    private readonly prisma: PrismaService,
    private readonly registry: AgentRunRegistryService,
    @InjectPinoLogger(AssistantChatController.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Permiso global (rol) — check manual porque el permiso depende del
   * entityType del path; el decorator @Permissions es estático por ruta.
   * Misma fuente (ROLE_PERMISSIONS) que PermissionsGuard.
   */
  private assertPermission(user: AuthenticatedUser, entityType: AssistantEntityType): void {
    const required = REQUIRED_PERMISSION[entityType];
    const userPermissions = ROLE_PERMISSIONS[user.role] || [];
    if (!userPermissions.includes(required)) {
      throw new ForbiddenException('Permisos insuficientes para editar esta entidad');
    }
  }

  /**
   * CWE-639 / OWASP A01 — autorización a nivel objeto, mismo modelo que los
   * endpoints de generación:
   *  - initiative: pods de sus épicas (sin épicas/pods → permitir; el leak es
   *    mínimo y es el caso legítimo de "iniciativa recién creada").
   *  - epic: pod-intersection fail-closed (assertUserCanAccessEpicPods).
   *  - story: unión pods de la épica + podId propio (assertUserCanAccessStoryByEpic).
   */
  private async assertObjectAccess(
    user: AuthenticatedUser,
    entityType: AssistantEntityType,
    entityId: string,
  ): Promise<void> {
    if (user.role === UserRole.AltaGerencia) return;

    if (entityType === 'initiative') {
      const initiative = await this.prisma.initiative.findUnique({
        where: { id: entityId },
        select: { id: true, epics: { select: { pods: { select: { podId: true } } } } },
      });
      if (!initiative) throw new NotFoundException('Iniciativa no encontrada');
      const podIds = new Set<string>();
      for (const epic of initiative.epics) {
        for (const ep of epic.pods) podIds.add(ep.podId);
      }
      if (podIds.size === 0) return;
      const userPodIds = new Set(user.podIds ?? []);
      if (![...podIds].some((pid) => userPodIds.has(pid))) {
        throw new ForbiddenException('Sin acceso a esta iniciativa');
      }
      return;
    }

    if (entityType === 'epic') {
      const epic = await this.prisma.epic.findUnique({
        where: { id: entityId },
        select: { pods: { select: { podId: true } } },
      });
      if (!epic) throw new NotFoundException('Épica no encontrada');
      assertUserCanAccessEpicPods(user, epic.pods.map((p) => p.podId));
      return;
    }

    const story = await this.prisma.story.findUnique({
      where: { id: entityId },
      select: {
        podId: true,
        epic: { select: { pods: { select: { podId: true } } } },
      },
    });
    if (!story) throw new NotFoundException('Historia no encontrada');
    assertUserCanAccessStoryByEpic(user, {
      epicPodIds: story.epic?.pods?.map((p) => p.podId) ?? [],
      storyPodId: story.podId ?? null,
    });
  }

  @Delete('session/:sessionId')
  @ApiOperation({ summary: 'Destruir una sesión de chat (limpiar conversación)' })
  async destroySession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const destroyed = await this.sessions.destroy(sessionId, user.sub);
    return { ok: true, destroyed };
  }

  /**
   * Registra el resultado de propuestas (aplicada/descartada) apenas el
   * usuario actúa. Sobrevive recargas de página y alimenta el contexto del
   * próximo turno server-side. Ownership de la sesión validado en el service.
   */
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('session/:sessionId/proposal-feedback')
  @ApiOperation({ summary: 'Registrar feedback de propuestas (aplicada/descartada)' })
  async recordProposalFeedback(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: ProposalFeedbackBodyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.sessions.recordProposalFeedback(sessionId, user.sub, body.feedback);
    return { ok: true };
  }

  /**
   * Snapshot de la sesión activa del usuario para esta entidad — la UI lo
   * usa para rehidratar la conversación tras recargar la página. Mismos
   * checks de permiso global + objeto que el turno de chat: la transcript
   * contiene contenido narrativo de la entidad (propuestas con oldContent).
   */
  @Get(':entityType/:entityId/session')
  @ApiOperation({ summary: 'Sesión activa del asistente para rehidratar la UI' })
  async getActiveSession(
    @Param('entityType') entityTypeRaw: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const entityType = entityTypeRaw as AssistantEntityType;
    if (!ENTITY_TYPES.includes(entityType)) {
      throw new BadRequestException(
        `entityType inválido. Válidos: ${ENTITY_TYPES.join(', ')}`,
      );
    }
    this.assertPermission(user, entityType);
    await this.assertObjectAccess(user, entityType, entityId);
    const session = await this.sessions.findActiveSnapshot(user.sub, entityType, entityId);
    return { session };
  }

  /**
   * Un turno de chat con el asistente editorial, streaming SSE.
   *
   * POST (no GET como los endpoints de generación) porque el mensaje del
   * usuario viaja en el body: puede ser largo y no debe quedar en access
   * logs como query string. El proxy BFF ya pipea cualquier respuesta
   * text/event-stream sin buffering, independiente del método.
   */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(':entityType/:entityId')
  @ApiOperation({ summary: 'Turno de chat del asistente de edición (SSE)' })
  async chatTurn(
    @Param('entityType') entityTypeRaw: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() body: AssistantChatBodyDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const entityType = entityTypeRaw as AssistantEntityType;
    if (!ENTITY_TYPES.includes(entityType)) {
      throw new BadRequestException(
        `entityType inválido. Válidos: ${ENTITY_TYPES.join(', ')}`,
      );
    }

    // Todos los checks ANTES de flushHeaders — NestJS devuelve 4xx JSON plano.
    this.assertPermission(user, entityType);
    await this.assertObjectAccess(user, entityType, entityId);

    // Cap global de agentes (3/usuario, compartido con generación) + lock
    // por entidad: dos turnos concurrentes sobre la misma entidad → 409.
    const runKey = `assistant:${entityType}:${entityId}`;
    const abortController = new AbortController();
    this.registry.register(user.sub, runKey, abortController);

    this.logger.info(
      { entityType, entityId, sessionId: body.sessionId ?? null },
      `[assistant-chat] turn start ${entityType}/${entityId}`,
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const stopHeartbeat = setupSseHeartbeat(res);
    let streamCompleted = false;

    req.on('close', () => {
      if (streamCompleted) return;
      // Chat interactivo: sin cliente no hay a quién mostrarle la respuesta
      // ni cache de fondo que rehidratar — abortamos el stream de Anthropic
      // para no quemar tokens (a diferencia de epic-gen, que persiste a Redis).
      stopHeartbeat();
      this.logger.info(`[assistant-chat] client disconnected — aborting turn ${runKey}`);
      abortController.abort();
    });

    const safeWrite = (payload: string): void => {
      if (res.writableEnded) return;
      try {
        res.write(payload);
      } catch {
        // Socket muerto; el close handler ya abortó.
      }
    };

    const subject = this.chat.chat({
      user,
      entityType,
      entityId,
      message: body.message,
      sessionId: body.sessionId,
      proposalFeedback: body.proposalFeedback,
      signal: abortController.signal,
    });

    subject.subscribe({
      next: (event: { data: AssistantChatEvent }) => {
        safeWrite(`data: ${JSON.stringify(event.data)}\n\n`);
      },
      complete: () => {
        streamCompleted = true;
        stopHeartbeat();
        this.registry.unregister(user.sub, runKey, abortController);
        if (!res.writableEnded) res.end();
      },
      error: (err: Error) => {
        streamCompleted = true;
        stopHeartbeat();
        this.registry.unregister(user.sub, runKey, abortController);
        this.logger.error({ message: err?.message }, `[assistant-chat] stream error`);
        safeWrite(`data: ${JSON.stringify({ type: 'error', message: 'Error interno' })}\n\n`);
        if (!res.writableEnded) res.end();
      },
    });
  }
}
