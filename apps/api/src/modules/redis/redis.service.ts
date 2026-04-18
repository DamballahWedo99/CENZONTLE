import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly config: ConfigService) {
    const host = config.get<string>('REDIS_HOST', 'localhost');
    const port = config.get<number>('REDIS_PORT', 6379);

    this.client = new Redis({ host, port, maxRetriesPerRequest: 3 });

    this.client.on('connect', () => this.logger.log(`Redis connected at ${host}:${port}`));
    this.client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => {});
  }

  get isConnected(): boolean {
    return this.client.status === 'ready';
  }

  async get(key: string): Promise<string | null> {
    if (!this.isConnected) return null;
    return this.client.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.isConnected) return;
    await this.client.set(key, value);
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    if (!this.isConnected) return;
    await this.client.setex(key, ttlSeconds, value);
  }

  async del(key: string): Promise<void> {
    if (!this.isConnected) return;
    await this.client.del(key);
  }

  async ttl(key: string): Promise<number> {
    if (!this.isConnected) return -2;
    return this.client.ttl(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    if (!this.isConnected) return;
    await this.client.expire(key, ttlSeconds);
  }
}
