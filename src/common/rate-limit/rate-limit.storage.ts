import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import Redis, { type Redis as RedisClient } from 'ioredis';

import { readOptionalEnv } from '../env';

interface RateLimitConsumeResult {
  allowed: boolean;
  currentCount: number;
  retryAfterSeconds: number;
  storage: 'redis' | 'memory';
}

interface MemoryBucket {
  count: number;
  expiresAt: number;
}

@Injectable()
export class RateLimitStorageService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitStorageService.name);
  private readonly memoryBuckets = new Map<string, MemoryBucket>();
  private readonly cleanupInterval = setInterval(() => this.cleanupMemory(), 5 * 60 * 1000);
  private readonly redisClient?: RedisClient;
  private redisAvailable = false;

  constructor() {
    this.cleanupInterval.unref?.();

    const redisUrl = readOptionalEnv('REDIS_URL');

    if (!redisUrl) {
      return;
    }

    this.redisClient = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    });

    this.redisClient.on('error', (error) => {
      this.redisAvailable = false;
      this.logger.warn(`Redis rate limit disabled temporarily: ${error.message}`);
    });

    this.redisClient.on('ready', () => {
      this.redisAvailable = true;
      this.logger.log('Redis rate limit storage is ready');
    });
  }

  async consume(
    bucketKey: string,
    windowMs: number,
    limit: number,
  ): Promise<RateLimitConsumeResult> {
    if (this.redisClient) {
      try {
        return await this.consumeWithRedis(bucketKey, windowMs, limit);
      } catch (error) {
        this.redisAvailable = false;
        this.logger.warn(
          `Falling back to in-memory rate limit storage: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return this.consumeWithMemory(bucketKey, windowMs, limit);
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupInterval);

    if (this.redisClient) {
      void this.redisClient.quit();
    }
  }

  private async consumeWithRedis(
    bucketKey: string,
    windowMs: number,
    limit: number,
  ): Promise<RateLimitConsumeResult> {
    if (!this.redisClient) {
      return this.consumeWithMemory(bucketKey, windowMs, limit);
    }

    if (!this.redisAvailable) {
      await this.redisClient.connect();
      this.redisAvailable = true;
    }

    const script = `
      local current = redis.call("INCR", KEYS[1])
      if current == 1 then
        redis.call("PEXPIRE", KEYS[1], ARGV[1])
      end
      local ttl = redis.call("PTTL", KEYS[1])
      return { current, ttl }
    `;

    const result = (await this.redisClient.eval(script, 1, bucketKey, windowMs)) as [
      number,
      number,
    ];

    const currentCount = Number(result[0] ?? 0);
    const ttlMs = Number(result[1] ?? windowMs);
    const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

    return {
      allowed: currentCount <= limit,
      currentCount,
      retryAfterSeconds,
      storage: 'redis',
    };
  }

  private consumeWithMemory(
    bucketKey: string,
    windowMs: number,
    limit: number,
  ): RateLimitConsumeResult {
    const now = Date.now();
    const bucket = this.memoryBuckets.get(bucketKey);

    if (!bucket || bucket.expiresAt <= now) {
      this.memoryBuckets.set(bucketKey, {
        count: 1,
        expiresAt: now + windowMs,
      });

      return {
        allowed: true,
        currentCount: 1,
        retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
        storage: 'memory',
      };
    }

    bucket.count += 1;

    return {
      allowed: bucket.count <= limit,
      currentCount: bucket.count,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((bucket.expiresAt - now) / 1000),
      ),
      storage: 'memory',
    };
  }

  private cleanupMemory(): void {
    const now = Date.now();

    for (const [key, bucket] of this.memoryBuckets.entries()) {
      if (bucket.expiresAt <= now) {
        this.memoryBuckets.delete(key);
      }
    }
  }
}

