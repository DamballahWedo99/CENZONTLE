import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../redis/redis.service';
import type { EpicGenerationEvent, ProposedEpic, CachedGenerationSession } from '@cenzontle/shared';
import { scrubSecrets } from '../../../../common/utils/scrub-secrets.util';

/**
 * TTL de la sesión mientras está en modo streaming. Redis SET sin flag EX
 * elimina el TTL existente de la key, por lo que todas las escrituras
 * incrementales (appendEvent, appendProposal) deben pasar por SETEX con
 * este TTL para no dejar huérfana la key si el stream se interrumpe.
 */
const STREAMING_TTL_SECONDS = 3600;

@Injectable()
export class ProposalCacheService {
  private readonly logger = new Logger(ProposalCacheService.name);
  private readonly defaultTtl: number;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.defaultTtl = this.config.get<number>('PROPOSAL_CACHE_TTL', 1800);
  }

  private key(initiativeId: string): string {
    return `epic-gen:${initiativeId}:session`;
  }

  async initSession(initiativeId: string): Promise<void> {
    const session: CachedGenerationSession = {
      initiativeId,
      status: 'streaming',
      proposals: [],
      events: [],
      createdAt: new Date().toISOString(),
      ttlSeconds: this.defaultTtl,
    };
    // Safety TTL of 1 hour during streaming
    await this.redis.setex(this.key(initiativeId), STREAMING_TTL_SECONDS, JSON.stringify(session));
  }

  async appendEvent(initiativeId: string, event: EpicGenerationEvent): Promise<void> {
    const session = await this.getSession(initiativeId);
    if (!session) return;
    session.events.push(event);
    // SETEX en vez de SET para no eliminar el TTL de la key. Si el stream se
    // interrumpe (cliente cierra, proceso crashea) la key caduca sola y no
    // fuga en Redis. Preservamos el TTL original si queda tiempo, si no
    // volvemos al default de streaming.
    const remaining = await this.redis.ttl(this.key(initiativeId));
    const ttl = remaining > 0 ? remaining : STREAMING_TTL_SECONDS;
    await this.redis.setex(this.key(initiativeId), ttl, scrubSecrets(JSON.stringify(session)));
  }

  async appendProposal(initiativeId: string, proposal: ProposedEpic): Promise<void> {
    const session = await this.getSession(initiativeId);
    if (!session) return;
    session.proposals.push(proposal);
    // Ver comentario en appendEvent — aplicamos la misma estrategia de
    // preservar TTL para evitar fugas de sesiones huérfanas en Redis.
    const remaining = await this.redis.ttl(this.key(initiativeId));
    const ttl = remaining > 0 ? remaining : STREAMING_TTL_SECONDS;
    await this.redis.setex(this.key(initiativeId), ttl, scrubSecrets(JSON.stringify(session)));
  }

  async completeSession(initiativeId: string): Promise<void> {
    const session = await this.getSession(initiativeId);
    if (!session) return;
    session.status = 'staging';
    session.completedAt = new Date().toISOString();
    await this.redis.setex(this.key(initiativeId), this.defaultTtl, scrubSecrets(JSON.stringify(session)));
    this.logger.log(`Session completed for ${initiativeId}, TTL=${this.defaultTtl}s`);
  }

  async getSession(initiativeId: string): Promise<CachedGenerationSession | null> {
    const raw = await this.redis.get(this.key(initiativeId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedGenerationSession;
    } catch {
      return null;
    }
  }

  async getRemainingTtl(initiativeId: string): Promise<number> {
    return this.redis.ttl(this.key(initiativeId));
  }

  async removeProposal(initiativeId: string, clientId: string): Promise<void> {
    const session = await this.getSession(initiativeId);
    if (!session) return;
    session.proposals = session.proposals.filter((p) => p.clientId !== clientId);
    if (session.proposals.length === 0) {
      await this.redis.del(this.key(initiativeId));
      this.logger.log(`All proposals consumed, cache deleted for ${initiativeId}`);
    } else {
      // Preserve remaining TTL
      const payload = scrubSecrets(JSON.stringify(session));
      const ttl = await this.redis.ttl(this.key(initiativeId));
      const effectiveTtl = ttl > 0 ? ttl : STREAMING_TTL_SECONDS;
      await this.redis.setex(this.key(initiativeId), effectiveTtl, payload);
    }
  }

  /**
   * Atomic write of the full session — called once when the SSE stream completes.
   * Replaces any partial session data with the complete state.
   *
   * Defense in depth: aplicamos scrubSecrets al JSON serializado antes de
   * persistir en Redis. Aunque el servicio de generación ya redacta tokens en
   * los eventos emitidos por SSE, este scrub final garantiza que ningún PAT /
   * URL con credenciales llegue al cache si en el futuro se agrega un nuevo
   * campo textual que escape la redacción upstream. La operación es idempotente
   * y segura en JSON: `<REDACTED>` no contiene caracteres especiales.
   */
  async saveFullSession(
    initiativeId: string,
    events: EpicGenerationEvent[],
    proposals: ProposedEpic[],
  ): Promise<void> {
    const session: CachedGenerationSession = {
      initiativeId,
      status: 'staging',
      proposals,
      events,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ttlSeconds: this.defaultTtl,
    };
    const payload = scrubSecrets(JSON.stringify(session));
    await this.redis.setex(this.key(initiativeId), this.defaultTtl, payload);
    this.logger.log(`Full session saved for ${initiativeId}: ${proposals.length} proposals, ${events.length} events, TTL=${this.defaultTtl}s`);
  }

  async invalidateSession(initiativeId: string): Promise<void> {
    await this.redis.del(this.key(initiativeId));
    this.logger.log(`Cache invalidated for ${initiativeId}`);
  }
}
