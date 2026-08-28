import { Redis, type RedisOptions } from 'ioredis';

/**
 * Shared ioredis factory (mirrors `createPool` in db.ts). BullMQ requires
 * `maxRetriesPerRequest: null` on the connection it's given — passing that
 * to a connection also used for the cache/rate limiter is harmless, but bootstrap keeps
 * them as separate instances (see index.ts) since sharing one connection across BullMQ's
 * blocking calls and everything else is a documented BullMQ footgun.
 */
export function createRedisClient(url: string, options?: RedisOptions): Redis {
  return options ? new Redis(url, options) : new Redis(url);
}
