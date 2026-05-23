import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';

/**
 * El registro que `ThrottlerStorage.increment` devuelve. Lo derivamos del
 * propio tipo de `@nestjs/throttler` en vez de importar el nombre
 * `ThrottlerStorageRecord` — ese tipo no está garantizado en el export raíz
 * del paquete, así el wrapper no depende de un import profundo frágil.
 */
type ThrottlerRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** Sink mínimo de logs — permite inyectar un mock en tests sin DI de NestJS. */
interface WarnLogger {
  warn(message: string): void;
}

/**
 * Cada cuánto (ms) re-logueamos el estado fail-open. Sin esto sería un log por
 * request durante una caída de Redis; con esto, una línea cada 30s — señal
 * suficiente para alertar sin spamear.
 */
const DEGRADED_LOG_INTERVAL_MS = 30_000;

/**
 * Storage del rate-limiter resiliente: envuelve un `ThrottlerStorage` real
 * (el respaldado por Redis) con semántica **fail-open**.
 *
 * Por qué: el storage por defecto de `@nestjs/throttler` es in-memory y por
 * proceso — bajo escalado horizontal cada réplica de la API cuenta aparte y el
 * cap real se vuelve `límite × N réplicas` (p. ej. el cap de 5/min del retry
 * de stories pasa a 5·N/min). La solución es un storage en Redis (contadores
 * compartidos entre réplicas). Pero eso convertiría a Redis en un SPOF: si el
 * `increment` contra Redis lanza, el `ThrottlerGuard` respondería 500 a CADA
 * request.
 *
 * Este wrapper preserva el invariante del codebase — Redis es best-effort,
 * nunca un SPOF (ver `RedisService`, que chequea `isConnected` en cada método
 * y degrada en vez de romper). Si Redis no está sano, o el `increment` falla,
 * devuelve un registro "fail-open" (`totalHits: 0`, `isBlocked: false`): el
 * guard NUNCA lo cuenta como violación, el request pasa, y el rate-limiting
 * queda desactivado mientras Redis esté caído — en vez de tumbar la API.
 *
 * Tradeoff de seguridad (deliberado): con fail-open, una caída de Redis
 * desactiva TODOS los caps a la vez — incluido el anti-brute-force del login.
 * Se elige disponibilidad sobre el cap; para el login el control autoritativo
 * es el propio anti-brute-force de Auth0 (a quien ese endpoint reenvía la
 * password), no este throttle. El estado fail-open se loguea (ver
 * `noteDegraded`) para que la degradación sea observable y alertable.
 */
export class ResilientThrottlerStorage implements ThrottlerStorage {
  private lastDegradedLogAt = 0;

  constructor(
    /** Storage real (respaldado por Redis) al que se delega cuando Redis está sano. */
    private readonly delegate: ThrottlerStorage,
    /** Predicado de salud de Redis — `RedisService.isConnected` en producción. */
    private readonly isRedisHealthy: () => boolean,
    /** Logger para avisar de la degradación a fail-open. Default: Logger de Nest. */
    private readonly logger: WarnLogger = new Logger(
      ResilientThrottlerStorage.name,
    ),
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    // Fast-path: si Redis no está listo, ni intentamos el comando — evita el
    // offline-queue/hang de ioredis. Mismo chequeo previo que RedisService.
    if (!this.isRedisHealthy()) {
      return this.failOpen(ttl);
    }
    try {
      return await this.delegate.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    } catch {
      // Redis cayó entre el chequeo y el comando, o el script Lua falló.
      // Degradar, no romper.
      return this.failOpen(ttl);
    }
  }

  /**
   * Registro fail-open: `totalHits: 0` + `isBlocked: false` garantizan que el
   * `ThrottlerGuard` nunca lo trate como violación, sea cual sea el `limit`.
   * Resultado: el request pasa.
   */
  private failOpen(ttl: number): ThrottlerRecord {
    this.noteDegraded();
    return {
      totalHits: 0,
      // Contrato de @nestjs/throttler: `increment` recibe `ttl` en MS pero
      // devuelve `timeToExpire` en SEGUNDOS — ver `ThrottlerStorageService`
      // (in-memory), cuyo `getExpirationTime` hace `Math.ceil(.../1000)`; el
      // adapter de Redis hace lo mismo. El guard pone ese valor tal cual en el
      // header `X-RateLimit-Reset`. Devolver `ttl` crudo daría 1000x (un
      // `ttl=60_000` se leería como 60 000 s ≈ 16,6 h).
      timeToExpire: Math.ceil(ttl / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }

  /**
   * Warn rate-limitado (1 cada {@link DEGRADED_LOG_INTERVAL_MS}): el
   * rate-limiter se degradó a fail-open. Hace la degradación del control de
   * seguridad observable/alertable sin emitir un log por request.
   */
  private noteDegraded(): void {
    const now = Date.now();
    if (now - this.lastDegradedLogAt < DEGRADED_LOG_INTERVAL_MS) return;
    this.lastDegradedLogAt = now;
    this.logger.warn(
      'Redis no disponible — rate limiting en modo FAIL-OPEN: los caps están ' +
        'temporalmente desactivados (los requests pasan sin throttle).',
    );
  }
}
