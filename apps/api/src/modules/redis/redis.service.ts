import {
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly conn: Redis;

  /**
   * El cliente ioredis crudo, sin los guards de `isConnected` que envuelven al
   * resto de los métodos de este service.
   *
   * @internal Solo para infraestructura que necesita comandos no soportados por
   * los helpers de arriba — hoy: el storage del rate-limiter
   * (`@nest-lab/throttler-storage-redis`), que corre su propio script Lua
   * atómico. Reusar esta única conexión evita abrir una segunda contra el mismo
   * Redis. NO usar para acceso a datos de la app: usá get/set/setex/etc., que
   * degradan limpio si Redis está caído.
   */
  get rawClient(): Redis {
    return this.conn;
  }

  constructor(private readonly config: ConfigService,
    @InjectPinoLogger(RedisService.name) private readonly logger: PinoLogger,
  ) {
    const host = config.get<string>('REDIS_HOST', 'localhost');
    const port = config.get<number>('REDIS_PORT', 6379);

    this.conn = new Redis({ host, port, maxRetriesPerRequest: 3 });

    this.conn.on('connect', () => this.logger.info({ host, port }, `Redis connected at ${host}:${port}`));
    this.conn.on('error', (err) => this.logger.warn({ message: err.message }, `Redis error: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.conn.quit().catch(() => {});
  }

  get isConnected(): boolean {
    return this.conn.status === 'ready';
  }

  async get(key: string): Promise<string | null> {
    if (!this.isConnected) return null;
    return this.conn.get(key);
  }

  /**
   * SET sin expiración. La key persiste hasta que alguien la borre
   * explícitamente con `del`, o hasta que Redis sea purgado.
   *
   * Preferir `setex` para cualquier state efímero (sesiones, throttler,
   * locks, idempotency keys): un consumer que olvide el TTL acumula keys
   * indefinidamente y puede saturar el Redis compartido. Reservar este
   * método solo para state que SÍ debe ser durable (config bootstrapping,
   * feature flags, etc.) — y aún así, considerar `setex` con TTL holgado
   * (días/semanas) como red de seguridad.
   */
  async set(key: string, value: string): Promise<void> {
    if (!this.isConnected) return;
    await this.conn.set(key, value);
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    if (!this.isConnected) return;
    await this.conn.setex(key, ttlSeconds, value);
  }

  async del(key: string): Promise<void> {
    if (!this.isConnected) return;
    await this.conn.del(key);
  }

  async ttl(key: string): Promise<number> {
    if (!this.isConnected) return -2;
    return this.conn.ttl(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    if (!this.isConnected) return;
    await this.conn.expire(key, ttlSeconds);
  }
}
