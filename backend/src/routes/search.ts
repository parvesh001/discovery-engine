import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { runSearch, SearchRetrievalError } from '../services/search/orchestrateSearch.js';
import { logSearch } from '../services/search/searchLogs.js';
import { naiveSearchListings } from '../services/search/naiveSearch.js';
import { createRateLimiters, rateLimitMiddleware, type RateLimiterOverrides } from '../services/rateLimit/rateLimiter.js';
import { destinationSlugSchema } from '../config/destinations.js';

const MAX_QUERY_LENGTH = 200;

// Optional and additive (spec 12): a request that omits `destination` keeps today's
// global behaviour, so the eval harness and existing callers are unaffected. An unknown
// slug is rejected by the enum below → the existing 400 path, never a silent fallback.
const searchRequestSchema = z.object({
  query: z
    .string({ required_error: 'query is required' })
    .min(1, 'query must not be empty')
    .max(MAX_QUERY_LENGTH, `query must be at most ${MAX_QUERY_LENGTH} characters`),
  destination: destinationSlugSchema.optional(),
});

const naiveSearchQuerySchema = z.object({
  q: z
    .string({ required_error: 'q is required' })
    .min(1, 'q must not be empty')
    .max(MAX_QUERY_LENGTH, `q must be at most ${MAX_QUERY_LENGTH} characters`),
  destination: destinationSlugSchema.optional(),
});

export function searchRouter(pool: pg.Pool, redis: Redis, rateLimiterOverrides?: RateLimiterOverrides): Router {
  const router = Router();

  const limiters = createRateLimiters(redis, rateLimiterOverrides);
  const limiter = rateLimitMiddleware(limiters);

  router.post('/api/search', limiter, async (req, res) => {
    const parseResult = searchRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const message = parseResult.error.issues.map((issue) => issue.message).join('; ');
      res.status(400).json({ error: message });
      return;
    }

    try {
      const { response, logEntry } = await runSearch(
        pool,
        parseResult.data.query,
        redis,
        parseResult.data.destination,
      );
      res.status(200).json(response);
      void logSearch(pool, logEntry);
    } catch (error) {
      console.error('[search] request failed:', error);
      if (error instanceof SearchRetrievalError) {
        void logSearch(pool, error.partialLogEntry);
      }
      res.status(500).json({ error: 'Search failed. Please try again.' });
    }
  });

  router.get('/api/search/naive', limiter, async (req, res) => {
    const parseResult = naiveSearchQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      const message = parseResult.error.issues.map((issue) => issue.message).join('; ');
      res.status(400).json({ error: message });
      return;
    }

    try {
      const results = await naiveSearchListings(pool, parseResult.data.q, parseResult.data.destination);
      res.status(200).json({ results });
    } catch (error) {
      console.error('[search] naive search failed:', error);
      res.status(500).json({ error: 'Search failed. Please try again.' });
    }
  });

  return router;
}
