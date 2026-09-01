import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { browseListingsByDestination } from '../services/search/browseListings.js';
import { destinationSlugSchema } from '../config/destinations.js';
import { createRateLimiters, rateLimitMiddleware, type RateLimiterOverrides } from '../services/rateLimit/rateLimiter.js';

// `destination` is REQUIRED here (unlike the optional param on /api/search): browse is
// meaningless without a scope. Missing or unknown slug -> 400, never a silent empty list.
const browseQuerySchema = z.object({
  destination: destinationSlugSchema,
});

/**
 * Browse-before-search endpoint (spec 12 §2). Registered in app.ts alongside the search
 * router. Reuses `createRateLimiters` — the shared `rl:anon` Redis key prefix means this
 * draws from the same per-IP budget as /api/search and /api/search/naive.
 */
export function listingsRouter(pool: pg.Pool, redis: Redis, rateLimiterOverrides?: RateLimiterOverrides): Router {
  const router = Router();

  const limiter = rateLimitMiddleware(createRateLimiters(redis, rateLimiterOverrides));

  router.get('/api/listings', limiter, async (req, res) => {
    const parseResult = browseQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      const message = parseResult.error.issues.map((issue) => issue.message).join('; ');
      res.status(400).json({ error: message });
      return;
    }

    try {
      const results = await browseListingsByDestination(pool, parseResult.data.destination);
      res.status(200).json({ results, destination: parseResult.data.destination });
    } catch (error) {
      console.error('[listings] browse failed:', error);
      res.status(500).json({ error: 'Could not load listings. Please try again.' });
    }
  });

  return router;
}
