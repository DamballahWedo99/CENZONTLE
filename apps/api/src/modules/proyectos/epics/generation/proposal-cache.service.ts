import {
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../redis/redis.service';
import type { EpicGenerationEvent, ProposedEpic, CachedGenerationSession } from '@cenzontle/shared';
import { scrubSecrets } from '../../../../common/utils/scrub-secrets.util';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * TTL de la sesión mientras está en modo streaming. Redis SET sin flag EX
 * elimina el TTL existente de la key, por lo que todas las escrituras
 * incrementales (appendEvent, appendProposal) deben pasar por SETEX con
 * este TTL para no dejar huérfana la key si el stream se interrumpe.
 */
const STREAMING_TTL_SECONDS = 3600;

@Injectable()
export class ProposalCacheService {
  private readonly defaultTtl: number;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    @InjectPinoLogger(ProposalCacheService.name) private readonly logger: PinoLogger,
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

  /**
   * Escribe el state COMPLETO del controller al cache. NO hace read-modify-write
   * — el controller ya tiene el snapshot autoritativo en memoria
   * (`collectedEvents` + `collectedProposals`), así que escribimos directo.
   *
   * Reemplaza al patrón legacy `appendEvent`/`appendProposal` que sufría
   * race conditions: cuando llegaban N eventos en paralelo (burst de
   * proposal_ready × 4 + done + run_finished al final del run), los reads
   * concurrentes leían snapshots stale y la última escritura ganaba con el
   * snapshot más viejo, perdiendo proposals.
   *
   * Fire-and-forget por design — el controller llama esto sin await tras cada
   * event. Si Redis está abajo, el run sigue (in-memory state es source of
   * truth) y el saveFullSession final escribe todo.
   */
  async writeSession(
    initiativeId: string,
    events: EpicGenerationEvent[],
    proposals: ProposedEpic[],
  ): Promise<void> {
    const session: CachedGenerationSession = {
      initiativeId,
      status: 'streaming',
      proposals,
      events,
      createdAt: new Date().toISOString(),
      ttlSeconds: STREAMING_TTL_SECONDS,
    };
    await this.redis.setex(
      this.key(initiativeId),
      STREAMING_TTL_SECONDS,
      scrubSecrets(JSON.stringify(session)),
    );
  }

  async completeSession(initiativeId: string): Promise<void> {
    const session = await this.getSession(initiativeId);
    if (!session) return;
    session.status = 'staging';
    session.completedAt = new Date().toISOString();
    await this.redis.setex(this.key(initiativeId), this.defaultTtl, scrubSecrets(JSON.stringify(session)));
    this.logger.info({ initiativeId, defaultTtl: this.defaultTtl }, `Session completed for ${initiativeId}, TTL=${this.defaultTtl}s`);
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
      this.logger.info({ initiativeId }, `All proposals consumed, cache deleted for ${initiativeId}`);
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
    this.logger.info({ initiativeId, length: proposals.length, events_length: events.length, defaultTtl: this.defaultTtl }, `Full session saved for ${initiativeId}: ${proposals.length} proposals, ${events.length} events, TTL=${this.defaultTtl}s`);
  }

  async invalidateSession(initiativeId: string): Promise<void> {
    await this.redis.del(this.key(initiativeId));
    this.logger.info({ initiativeId }, `Cache invalidated for ${initiativeId}`);
  }
}
