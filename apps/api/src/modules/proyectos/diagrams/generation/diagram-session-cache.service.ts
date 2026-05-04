import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import type { DiagramGenerationEvent, DiagramGenerationType } from '@cenzontle/shared';
import { scrubSecrets } from '../../../../common/utils/scrub-secrets.util';

/**
 * Cachea la SESIÓN SSE en curso de la generación de un diagrama (events
 * acumulados, status). Permite que un cliente que cierre la pestaña y vuelva
 * vea la cadena de pensamiento hasta donde había llegado el agente, igual
 * que el patrón ya implementado para épicas y stories.
 *
 * Distinto del `DiagramCacheService` (que cachea el DIAGRAMA TERMINADO con
 * TTL de 5 días). Este cache es de la sesión EN PROGRESO, TTL de 1 hora.
 *
 * Una épica tiene 2 sesiones simultáneas posibles (business/technical), así
 * que la key incluye ambos ejes.
 */

const STREAMING_TTL_SECONDS = 3600; // 1h — suficiente para runs largos + recovery

export interface CachedDiagramSession {
  epicId: string;
  type: DiagramGenerationType;
  status: 'streaming' | 'staging';
  events: DiagramGenerationEvent[];
  createdAt: string;
  completedAt?: string;
}

@Injectable()
export class DiagramSessionCacheService {
  private readonly logger = new Logger(DiagramSessionCacheService.name);

  constructor(private readonly redis: RedisService) {}

  private key(epicId: string, type: DiagramGenerationType): string {
    return `diagram-gen:${epicId}:${type}:session`;
  }

  /**
   * Reescribe el state COMPLETO desde el snapshot autoritativo del controller.
   * NO read-modify-write — evita race conditions del patrón append* legacy.
   */
  async writeSession(
    epicId: string,
    type: DiagramGenerationType,
    events: DiagramGenerationEvent[],
    status: 'streaming' | 'staging' = 'streaming',
  ): Promise<void> {
    const session: CachedDiagramSession = {
      epicId,
      type,
      status,
      events,
      createdAt: new Date().toISOString(),
      ...(status === 'staging' ? { completedAt: new Date().toISOString() } : {}),
    };
    await this.redis.setex(
      this.key(epicId, type),
      STREAMING_TTL_SECONDS,
      scrubSecrets(JSON.stringify(session)),
    );
  }

  async getSession(
    epicId: string,
    type: DiagramGenerationType,
  ): Promise<CachedDiagramSession | null> {
    const raw = await this.redis.get(this.key(epicId, type));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedDiagramSession;
    } catch {
      return null;
    }
  }

  async invalidateSession(epicId: string, type: DiagramGenerationType): Promise<void> {
    await this.redis.del(this.key(epicId, type));
    this.logger.log(`Session cache invalidated for epic=${epicId} type=${type}`);
  }
}
