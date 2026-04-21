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
import type { EpicGenerationEvent, ProposedEpic, AuthenticatedUser } from '@cenzontle/shared';
import { Permissions, CurrentUser } from '../../../auth/decorators';
import { PrismaService } from '../../../prisma/prisma.service';
import { EpicGenerationService } from './epic-generation.service';
import { ProposalCacheService } from './proposal-cache.service';
import { GenerateEpicsQueryDto } from './dto/generate-epics.dto';
import { scrubSecrets } from '../../../../common/utils/scrub-secrets.util';
import { sanitizeForLog } from '../../../../common/utils/sanitize-llm-input.util';
import type { Request, Response } from 'express';

@ApiTags('Épicas — Generación IA')
@Controller('proyectos/epic-generation')
export class EpicGenerationController {
  private readonly logger = new Logger(EpicGenerationController.name);

  constructor(
    private readonly generation: EpicGenerationService,
    private readonly cache: ProposalCacheService,
    private readonly prisma: PrismaService,
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
   *   - Si la iniciativa no tiene epicas, permitir acceso a cualquier usuario con
   *     CREATE_EPIC (@Permissions ya valido). Este caso es LEGITIMO: generar las
   *     primeras epicas de una iniciativa recien creada. El leak es minimo porque
   *     no hay <existing_epics> que exponer.
   *   - Si la iniciativa ya tiene epicas con pods asignados, el usuario debe tener
   *     al menos un podId en comun con alguna de esas epicas.
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
          },
        },
      },
    });
    if (!initiative) throw new NotFoundException('Iniciativa no encontrada');

    // Coleccion de todos los podIds de todas las epicas de la iniciativa
    const initiativePodIds = new Set<string>();
    for (const epic of initiative.epics) {
      for (const ep of epic.pods) {
        initiativePodIds.add(ep.podId);
      }
    }

    // Iniciativa sin epicas o sin pods asignados → permitir (caso de "primera epica")
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
    this.logger.log(`[generate] initiative=${initiativeId} prompt="${promptForLog}" count=${query.count ?? 5} webSearch=${webSearchEnabled}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const abortController = new AbortController();
    let clientAborted = false;

    req.on('close', () => {
      this.logger.log(`[generate] Client disconnected, aborting agent`);
      clientAborted = true;
      abortController.abort();
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

    this.cache.initSession(initiativeId).catch(() => {});

    subject.subscribe({
      next: (event) => {
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);

        const data = event.data as EpicGenerationEvent;
        collectedEvents.push(data);

        if (data.type === 'proposal_ready') {
          collectedProposals.push((data as EpicGenerationEvent & { type: 'proposal_ready' }).epic);
        }
      },
      complete: () => {
        this.logger.log(`[generate] SSE stream finalized for ${initiativeId}`);
        res.end();

        // Si el cliente cerro la pestana, NO persistimos la sesion parcial.
        // Invalidamos el cache inicializado por initSession para no dejar datos
        // abortados que confundan el cache recovery del proximo mount.
        if (clientAborted) {
          this.cache.invalidateSession(initiativeId).catch(() => {});
          return;
        }

        this.cache.saveFullSession(initiativeId, collectedEvents, collectedProposals)
          .then(() => this.logger.debug(`[cache] session saved: ${collectedProposals.length} proposals, ${collectedEvents.length} events`))
          .catch((e) => this.logger.warn(`[cache] saveFullSession failed: ${e.message}`));
      },
      error: (err) => {
        this.logger.error(`[generate] SSE stream error: ${err?.message}`);
        if (!clientAborted) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: 'Error interno' })}\n\n`);
        }
        res.end();

        if (clientAborted) {
          this.cache.invalidateSession(initiativeId).catch(() => {});
          return;
        }

        this.cache.saveFullSession(initiativeId, collectedEvents, collectedProposals)
          .catch(() => {});
      },
    });
  }
}
