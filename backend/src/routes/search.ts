import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type pg from 'pg';
import { runSearch, SearchRetrievalError } from '../services/search/orchestrateSearch.js';
import { logSearch } from '../services/search/searchLogs.js';
import { naiveSearchListings } from '../services/search/naiveSearch.js';

const MAX_QUERY_LENGTH = 200;

const searchRequestSchema = z.object({
  query: z
    .string({ required_error: 'query is required' })
    .min(1, 'query must not be empty')
    .max(MAX_QUERY_LENGTH, `query must be at most ${MAX_QUERY_LENGTH} characters`),
});

const naiveSearchQuerySchema = z.object({
  q: z
    .string({ required_error: 'q is required' })
    .min(1, 'q must not be empty')
    .max(MAX_QUERY_LENGTH, `q must be at most ${MAX_QUERY_LENGTH} characters`),
});

const DEFAULT_RATE_LIMIT = { windowMs: 60_000, limit: 30 };

export function searchRouter(pool: pg.Pool, rateLimitOptions?: { windowMs: number; max: number }): Router {
  const router = Router();

  const limiter = rateLimit({
    windowMs: rateLimitOptions?.windowMs ?? DEFAULT_RATE_LIMIT.windowMs,
    limit: rateLimitOptions?.max ?? DEFAULT_RATE_LIMIT.limit,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post('/api/search', limiter, async (req, res) => {
    const parseResult = searchRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const message = parseResult.error.issues.map((issue) => issue.message).join('; ');
      res.status(400).json({ error: message });
      return;
    }

    try {
      const { response, logEntry } = await runSearch(pool, parseResult.data.query);
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
      const results = await naiveSearchListings(pool, parseResult.data.q);
      res.status(200).json({ results });
    } catch (error) {
      console.error('[search] naive search failed:', error);
      res.status(500).json({ error: 'Search failed. Please try again.' });
    }
  });

  return router;
}
