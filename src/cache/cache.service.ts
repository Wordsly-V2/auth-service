import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { userCachePattern } from './cache-keys';
import { CACHE_TTL_SECONDS, CacheKind } from './cache-ttl';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: Redis | null = null;
  private readonly keyPrefix = 'auth';

  constructor(private readonly configService: ConfigService) {}

  get isEnabled(): boolean {
    return this.client !== null;
  }

  async onModuleInit(): Promise<void> {
    const url = this.configService.get<string>('redis.url');
    if (!url) {
      this.logger.warn('REDIS_URL not set; caching is disabled');
      return;
    }

    const client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    try {
      await client.connect();
      this.client = client;
      this.logger.log('Redis cache connected');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Redis connection failed; caching disabled: ${message}`,
      );
      client.disconnect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  userKey(userLoginId: string, ...parts: string[]): string {
    return `${this.keyPrefix}:u:${userLoginId}:${parts.join(':')}`;
  }

  async getOrSet<T>(
    userLoginId: string,
    keyParts: string[],
    factory: () => Promise<T>,
    kind: CacheKind,
  ): Promise<T> {
    const key = this.userKey(userLoginId, ...keyParts);
    if (!this.client) {
      return factory();
    }

    try {
      const cached = await this.client.get(key);
      if (cached !== null) {
        return JSON.parse(cached) as T;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Cache read failed for ${key}: ${message}`);
    }

    const value = await factory();

    try {
      await this.client.set(
        key,
        JSON.stringify(value),
        'EX',
        CACHE_TTL_SECONDS[kind],
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Cache write failed for ${key}: ${message}`);
    }

    return value;
  }

  async invalidateUser(userLoginId: string): Promise<void> {
    if (!this.client) {
      return;
    }

    const pattern = userCachePattern(userLoginId);
    try {
      await this.deleteByPattern(pattern);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Cache invalidation failed for user ${userLoginId}: ${message}`,
      );
    }
  }

  private async deleteByPattern(pattern: string): Promise<void> {
    if (!this.client) {
      return;
    }

    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } while (cursor !== '0');
  }
}
