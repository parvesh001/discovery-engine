import type { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import type { Redis } from 'ioredis';

export const ANONYMOUS_POINTS = 20;
export const AUTHENTICATED_POINTS = 60;
const DURATION_SECONDS = 60;

/**
 * Stub, per spec 10's open question (resolved — treat all traffic as anonymous): no auth
 * system exists yet, so every request is anonymous. The authenticated tier below is fully
 * implemented and unit-tested, but this always returning false means it's dormant until a
 * real auth phase adds a real identity check here.
 */
export function isAuthenticated(_req: Request): boolean {
  return false;
}

export type RateLimiters = {
  anonymous: RateLimiterRedis;
  authenticated: RateLimiterRedis;
};

export type RateLimiterOverrides = {
  anonymousPoints?: number;
  authenticatedPoints?: number;
  durationSeconds?: number;
};

/**
 * Two Redis-backed tiers (spec 10, requirement 2), replacing the Phase 6 in-memory
 * express-rate-limit placeholder. `keyPrefix` keeps the tiers' Redis keys distinct so a
 * client can't exhaust one tier's quota and have it bleed into the other.
 */
export function createRateLimiters(redis: Redis, overrides?: RateLimiterOverrides): RateLimiters {
  const duration = overrides?.durationSeconds ?? DURATION_SECONDS;
  return {
    anonymous: new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:anon',
      points: overrides?.anonymousPoints ?? ANONYMOUS_POINTS,
      duration,
    }),
    authenticated: new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:auth',
      points: overrides?.authenticatedPoints ?? AUTHENTICATED_POINTS,
      duration,
    }),
  };
}

// req.ip reflects Express's `trust proxy` setting, unconfigured as of this phase — fine
// for local/direct traffic; revisit once Phase 10 puts the service behind Render's proxy.
function clientKey(req: Request): string {
  return req.ip ?? 'unknown';
}

/**
 * Express middleware consuming one point per request from the tier `isAuthenticated`
 * selects. On rejection responds 429 with a generic body (CLAUDE.md rule #6 / spec 10
 * error hygiene) — never leaks limiter internals. A genuine limiter/Redis failure (not a
 * quota rejection) fails open rather than blocking all traffic on a Redis blip, logging
 * loudly so it's visible server-side.
 */
export function rateLimitMiddleware(limiters: RateLimiters) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const limiter = isAuthenticated(req) ? limiters.authenticated : limiters.anonymous;
    try {
      await limiter.consume(clientKey(req));
      next();
    } catch (rejection) {
      if (!(rejection instanceof RateLimiterRes)) {
        console.error('[rateLimiter] limiter error, failing open:', rejection);
        next();
        return;
      }
      res.set('Retry-After', String(Math.ceil(rejection.msBeforeNext / 1000)));
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
  };
}
