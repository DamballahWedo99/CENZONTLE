import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../redis/redis.service';
import type { StoryGenerationEvent, ProposedStory, CachedStoryGenerationSession } from '@cenzontle/shared';
import { scrubSecrets } from '../../../../common/utils/scrub-secrets.util';

const STREAMING_TTL_SECONDS = 3600;

// 5 días = 5 * 24 * 60 * 60 = 432_000s. Aplica a propuestas YA GENERADAS
// (status='staging') que esperan ser aceptadas por el usuario. El TTL previo
// de 1800s (30 min) era insuficiente: si el usuario terminaba un run y no
// volvía hasta el día siguiente, las propuestas se perdían y debía
// regenerarlas (otros 25-30 min de tokens). 5 días es ventana razonable
// para flujo de revisión humana sin acumular cache indefinidamente.
// Override via env var `STORY_PROPOSAL_CACHE_TTL` si se necesita ajustar
// por entorno (ej. dev local con TTL más corto para forzar regeneración).
const DEFAULT_STAGING_TTL_SECONDS = 5 * 24 * 60 * 60;

@Injectable()
export class StoryProposalCacheService {
  private readonly logger = new Logger(StoryProposalCacheService.name);
  private readonly defaultTtl: number;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.defaultTtl = this.config.get<number>(
      'STORY_PROPOSAL_CACHE_TTL',
      DEFAULT_STAGING_TTL_SECONDS,
    );
  }

  private key(epicId: string): string {
    return `story-gen:${epicId}:session`;
  }

  async initSession(epicId: string): Promise<void> {
    const session: CachedStoryGenerationSession = {
      epicId,
      status: 'streaming',
      proposals: [],
      events: [],
      createdAt: new Date().toISOString(),
      ttlSeconds: this.defaultTtl,
    };
    await this.redis.setex(this.key(epicId), STREAMING_TTL_SECONDS, JSON.stringify(session));
  }

  /**
   * Escribe el state COMPLETO del controller al cache. NO hace read-modify-write
   * — el controller mantiene el snapshot autoritativo en memoria. Reemplaza
   * `appendEvent`/`appendProposal` legacy que tenían race conditions con
   * `saveFullSession`. Ver doc en epics/proposal-cache.service.ts.
   */
  async writeSession(
    epicId: string,
    events: StoryGenerationEvent[],
    proposals: ProposedStory[],
  ): Promise<void> {
    const session: CachedStoryGenerationSession = {
      epicId,
      status: 'streaming',
      proposals,
      events,
      createdAt: new Date().toISOString(),
      ttlSeconds: STREAMING_TTL_SECONDS,
    };
    await this.redis.setex(
      this.key(epicId),
      STREAMING_TTL_SECONDS,
      scrubSecrets(JSON.stringify(session)),
    );
  }

  async completeSession(epicId: string): Promise<void> {
    const session = await this.getSession(epicId);
    if (!session) return;
    session.status = 'staging';
    session.completedAt = new Date().toISOString();
    await this.redis.setex(this.key(epicId), this.defaultTtl, scrubSecrets(JSON.stringify(session)));
    this.logger.log(`Session completed for epic=${epicId}, TTL=${this.defaultTtl}s`);
  }

  async getSession(epicId: string): Promise<CachedStoryGenerationSession | null> {
    const raw = await this.redis.get(this.key(epicId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedStoryGenerationSession;
    } catch {
      return null;
    }
  }

  async getRemainingTtl(epicId: string): Promise<number> {
    return this.redis.ttl(this.key(epicId));
  }

  async removeProposal(epicId: string, clientId: string): Promise<void> {
    const session = await this.getSession(epicId);
    if (!session) return;
    session.proposals = session.proposals.filter((p) => p.clientId !== clientId);
    if (session.proposals.length === 0) {
      await this.redis.del(this.key(epicId));
      this.logger.log(`All proposals consumed, cache deleted for epic=${epicId}`);
    } else {
      const payload = scrubSecrets(JSON.stringify(session));
      const ttl = await this.redis.ttl(this.key(epicId));
      const effectiveTtl = ttl > 0 ? ttl : STREAMING_TTL_SECONDS;
      await this.redis.setex(this.key(epicId), effectiveTtl, payload);
    }
  }

  async saveFullSession(
    epicId: string,
    events: StoryGenerationEvent[],
    proposals: ProposedStory[],
  ): Promise<void> {
    const session: CachedStoryGenerationSession = {
      epicId,
      status: 'staging',
      proposals,
      events,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ttlSeconds: this.defaultTtl,
    };
    const payload = scrubSecrets(JSON.stringify(session));
    await this.redis.setex(this.key(epicId), this.defaultTtl, payload);
    this.logger.log(`Full session saved for epic=${epicId}: ${proposals.length} proposals, ${events.length} events, TTL=${this.defaultTtl}s`);
  }

  async invalidateSession(epicId: string): Promise<void> {
    await this.redis.del(this.key(epicId));
    this.logger.log(`Cache invalidated for epic=${epicId}`);
  }
}
