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
import { Permission, UserRole } from '@cenzontle/shared';
import type { StoryGenerationEvent, ProposedStory, AuthenticatedUser } from '@cenzontle/shared';
import { Permissions, CurrentUser } from '../../../auth/decorators';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoryGenerationService } from './story-generation.service';
import { StoryProposalCacheService } from './story-proposal-cache.service';
import { GenerateStoriesQueryDto } from './dto/generate-stories.dto';
import { scrubSecrets } from '../../../../common/utils/scrub-secrets.util';
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
      `[SSE:story-gen] ═══ CONNECT user=${user.sub} role=${user.role} epic=${epicId} prompt="${promptForLog}" count=${query.count ?? 5} webSearch=${webSearchEnabled}`,
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const abortController = new AbortController();
    let clientAborted = false;
    // Flag que distingue "cliente cierra mid-stream" (real abort) vs "cliente
    // cierra tras recibir done" (cierre normal del SSE). Sin esto, req.on('close')
    // siempre dispara el WARN aunque haya sido un cierre limpio.
    let streamCompleted = false;

    req.on('close', () => {
      if (streamCompleted) {
        // Cierre normal post-done: nada que hacer.
        return;
      }
      this.logger.warn(`[SSE:story-gen] ✗ client disconnected mid-stream, aborting agent epic=${epicId}`);
      clientAborted = true;
      abortController.abort();
    });

    const subject = this.generation.generate(
      epicId,
      query.prompt,
      query.count ?? 5,
      abortController.signal,
      webSearchEnabled,
    );

    const collectedEvents: StoryGenerationEvent[] = [];
    const collectedProposals: ProposedStory[] = [];

    this.cache.initSession(epicId).catch(() => {});

    subject.subscribe({
      next: (event) => {
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);

        const data = event.data as StoryGenerationEvent;
        collectedEvents.push(data);

        if (data.type === 'proposal_ready') {
          collectedProposals.push((data as StoryGenerationEvent & { type: 'proposal_ready' }).story);
        }
      },
      complete: () => {
        this.logger.log(
          `[SSE:story-gen] ═══ DISCONNECT epic=${epicId} events=${collectedEvents.length} proposals=${collectedProposals.length} clientAborted=${clientAborted}`,
        );
        // Marcar antes de res.end() — el cierre del socket dispara req.on('close')
        // sincronicamente despues, y queremos que detecte cierre normal y skipee el WARN.
        streamCompleted = true;
        res.end();

        if (clientAborted) {
          this.logger.warn(`[SSE:story-gen] skipping cache save due to client abort — invalidating partial session`);
          this.cache.invalidateSession(epicId).catch(() => {});
          return;
        }

        this.cache.saveFullSession(epicId, collectedEvents, collectedProposals)
          .then(() => this.logger.log(`[SSE:story-gen] cache saved (${collectedProposals.length} proposals)`))
          .catch((e) => this.logger.warn(`[SSE:story-gen] saveFullSession failed: ${e.message}`));
      },
      error: (err) => {
        this.logger.error(`[SSE:story-gen] ✗ stream error: ${err?.message}`);
        if (!clientAborted) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: 'Error interno' })}\n\n`);
        }
        streamCompleted = true;
        res.end();

        if (clientAborted) {
          this.cache.invalidateSession(epicId).catch(() => {});
          return;
        }

        this.cache.saveFullSession(epicId, collectedEvents, collectedProposals)
          .catch(() => {});
      },
    });
  }
}
