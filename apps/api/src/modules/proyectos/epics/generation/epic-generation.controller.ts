import { Controller, Get, Delete, Param, Query, Req, Res, Logger, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permission } from '@cenzontle/shared';
import type { EpicGenerationEvent, ProposedEpic } from '@cenzontle/shared';
import { Permissions } from '../../../auth/decorators';
import { EpicGenerationService } from './epic-generation.service';
import { ProposalCacheService } from './proposal-cache.service';
import { GenerateEpicsQueryDto } from './dto/generate-epics.dto';
import type { Request, Response } from 'express';

@ApiTags('Épicas — Generación IA')
@Controller('proyectos/epic-generation')
export class EpicGenerationController {
  private readonly logger = new Logger(EpicGenerationController.name);

  constructor(
    private readonly generation: EpicGenerationService,
    private readonly cache: ProposalCacheService,
  ) {}

  // ── Cache endpoints (must be defined BEFORE the :initiativeId SSE route) ──

  @Get(':initiativeId/cache')
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({ summary: 'Recuperar sesión de generación cacheada' })
  async getCache(@Param('initiativeId', ParseUUIDPipe) initiativeId: string) {
    const session = await this.cache.getSession(initiativeId);
    if (!session) return { session: null };
    const remainingSeconds = await this.cache.getRemainingTtl(initiativeId);
    return { session, remainingSeconds };
  }

  @Get(':initiativeId/cache/ttl')
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({ summary: 'TTL restante del cache' })
  async getCacheTtl(@Param('initiativeId', ParseUUIDPipe) initiativeId: string) {
    const remainingSeconds = await this.cache.getRemainingTtl(initiativeId);
    return { remainingSeconds };
  }

  @Delete(':initiativeId/cache')
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({ summary: 'Invalidar cache de generación' })
  async invalidateCache(@Param('initiativeId', ParseUUIDPipe) initiativeId: string) {
    await this.cache.invalidateSession(initiativeId);
    return { ok: true };
  }

  @Delete(':initiativeId/cache/proposals/:clientId')
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({ summary: 'Remover propuesta del cache' })
  async removeProposal(
    @Param('initiativeId', ParseUUIDPipe) initiativeId: string,
    @Param('clientId') clientId: string,
  ) {
    await this.cache.removeProposal(initiativeId, clientId);
    return { ok: true };
  }

  // ── SSE streaming (must be LAST — :initiativeId is a catch-all param) ──

  @Get(':initiativeId')
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({ summary: 'Generar épicas con IA via SSE' })
  generate(
    @Param('initiativeId', ParseUUIDPipe) initiativeId: string,
    @Query() query: GenerateEpicsQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const webSearchEnabled = query.webSearch === true;
    this.logger.log(`[generate] initiative=${initiativeId} prompt="${query.prompt ?? ''}" count=${query.count ?? 5} webSearch=${webSearchEnabled}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const abortController = new AbortController();

    req.on('close', () => {
      this.logger.log(`[generate] Client disconnected, aborting agent`);
      abortController.abort();
    });

    const subject = this.generation.generate(
      initiativeId,
      query.prompt,
      query.count ?? 5,
      abortController.signal,
      webSearchEnabled,
    );

    // Accumulate events + proposals in memory, flush to Redis atomically at the end
    const collectedEvents: EpicGenerationEvent[] = [];
    const collectedProposals: ProposedEpic[] = [];

    // Init cache at the start so partial data is available if stream interrupts
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

        // Single atomic write to Redis with all events + proposals
        this.cache.saveFullSession(initiativeId, collectedEvents, collectedProposals)
          .then(() => this.logger.debug(`[cache] session saved: ${collectedProposals.length} proposals, ${collectedEvents.length} events`))
          .catch((e) => this.logger.warn(`[cache] saveFullSession failed: ${e.message}`));
      },
      error: (err) => {
        this.logger.error(`[generate] SSE stream error: ${err?.message}`);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Error interno' })}\n\n`);
        res.end();

        this.cache.saveFullSession(initiativeId, collectedEvents, collectedProposals)
          .catch(() => {});
      },
    });
  }
}
