type RedisEvent = 'error' | 'ready';

interface RedisMock {
  connect: jest.Mock<Promise<void>, []>;
  eval: jest.Mock<Promise<[number, number]>, [string, number, string, number]>;
  quit: jest.Mock<Promise<void>, []>;
  handlers: Partial<Record<RedisEvent, (...args: unknown[]) => void>>;
}

const mockRedisInstances: RedisMock[] = [];
const mockRedisOptions: Array<{
  retryStrategy: (times: number) => number;
}> = [];

jest.mock('ioredis', () => ({
  __esModule: true,
  default: class Redis {
    connect = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    eval = jest.fn<
      Promise<[number, number]>,
      [string, number, string, number]
    >();
    quit = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    handlers: RedisMock['handlers'] = {};

    constructor(
      _url: string,
      options: { retryStrategy: (times: number) => number },
    ) {
      mockRedisInstances.push(this);
      mockRedisOptions.push(options);
    }

    on(event: RedisEvent, handler: (...args: unknown[]) => void): void {
      this.handlers[event] = handler;
    }
  },
}));

import { RateLimitStorageService } from './rate-limit.storage';

describe('RateLimitStorageService', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    jest.restoreAllMocks();
    mockRedisInstances.length = 0;
    mockRedisOptions.length = 0;
    delete process.env.REDIS_URL;
  });

  afterAll(() => {
    if (originalRedisUrl !== undefined) {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  it('limits repeated requests using the in-memory fallback', async () => {
    const service = new RateLimitStorageService();

    const first = await service.consume('user:login', 60_000, 1);
    const second = await service.consume('user:login', 60_000, 1);
    service.onModuleDestroy();

    expect(first).toMatchObject({
      allowed: true,
      currentCount: 1,
      storage: 'memory',
    });
    expect(second).toMatchObject({
      allowed: false,
      currentCount: 2,
      storage: 'memory',
    });
  });

  it('creates a new memory bucket after the previous window expires', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(2_001);
    const service = new RateLimitStorageService();

    await service.consume('expired', 1_000, 2);
    const renewed = await service.consume('expired', 1_000, 2);
    service.onModuleDestroy();

    expect(renewed.currentCount).toBe(1);
    expect(renewed.allowed).toBe(true);
  });

  it('uses Redis when configured and closes it on destroy', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const service = new RateLimitStorageService();
    const redis = mockRedisInstances[0];
    redis.eval.mockResolvedValue([2, 1_500]);

    const result = await service.consume('redis-key', 5_000, 2);
    expect(mockRedisOptions[0].retryStrategy(1)).toBe(100);
    expect(mockRedisOptions[0].retryStrategy(30)).toBe(2_000);
    redis.handlers.ready?.();
    redis.handlers.error?.(new Error('offline'));
    service.onModuleDestroy();

    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      allowed: true,
      currentCount: 2,
      retryAfterSeconds: 2,
      storage: 'redis',
    });
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });

  it('falls back to memory when Redis fails', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const service = new RateLimitStorageService();
    mockRedisInstances[0].eval.mockRejectedValue(new Error('offline'));

    const result = await service.consume('fallback', 1_000, 1);
    service.onModuleDestroy();

    expect(result.storage).toBe('memory');
    expect(result.allowed).toBe(true);
  });

  it('covers cleanup and Redis-less internal fallbacks', async () => {
    const service = new RateLimitStorageService();
    const internal = service as unknown as {
      memoryBuckets: Map<string, { count: number; expiresAt: number }>;
      cleanupMemory: () => void;
      consumeWithRedis: (
        key: string,
        windowMs: number,
        limit: number,
      ) => Promise<{ storage: string }>;
    };
    internal.memoryBuckets.set('old', { count: 1, expiresAt: 1 });
    internal.memoryBuckets.set('current', {
      count: 1,
      expiresAt: Date.now() + 60_000,
    });

    internal.cleanupMemory();
    const result = await internal.consumeWithRedis('key', 1_000, 1);
    service.onModuleDestroy();

    expect(internal.memoryBuckets.has('old')).toBe(false);
    expect(internal.memoryBuckets.has('current')).toBe(true);
    expect(result.storage).toBe('memory');
  });

  it('handles non-Error Redis failures', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const service = new RateLimitStorageService();
    mockRedisInstances[0].eval.mockRejectedValue('offline');

    const result = await service.consume('fallback-string', 1_000, 1);
    service.onModuleDestroy();

    expect(result.storage).toBe('memory');
  });
});
