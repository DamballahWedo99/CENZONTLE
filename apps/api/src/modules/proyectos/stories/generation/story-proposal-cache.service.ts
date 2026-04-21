import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../redis/redis.service';
import type { StoryGenerationEvent, ProposedStory, CachedStoryGenerationSession } from '@cenzontle/shared';
import { scrubSecrets } from '../../../../common/utils/scrub-secrets.util';

const STREAMING_TTL_SECONDS = 3600;

@Injectable()
export class StoryProposalCacheService {
  private readonly logger = new Logger(StoryProposalCacheService.name);
  private readonly defaultTtl: number;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.defaultTtl = this.config.get<number>('STORY_PROPOSAL_CACHE_TTL', 1800);
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

  async appendEvent(epicId: string, event: StoryGenerationEvent): Promise<void> {
    const session = await this.getSession(epicId);
    if (!session) return;
    session.events.push(event);
    const remaining = await this.redis.ttl(this.key(epicId));
    const ttl = remaining > 0 ? remaining : STREAMING_TTL_SECONDS;
    await this.redis.setex(this.key(epicId), ttl, scrubSecrets(JSON.stringify(session)));
  }

  async appendProposal(epicId: string, proposal: ProposedStory): Promise<void> {
    const session = await this.getSession(epicId);
    if (!session) return;
    session.proposals.push(proposal);
    const remaining = await this.redis.ttl(this.key(epicId));
    const ttl = remaining > 0 ? remaining : STREAMING_TTL_SECONDS;
    await this.redis.setex(this.key(epicId), ttl, scrubSecrets(JSON.stringify(session)));
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
