import express, { type Express } from 'express';
import cors from 'cors';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { healthRouter } from './routes/health.js';
import { searchRouter } from './routes/search.js';
import type { RateLimiterOverrides } from './services/rateLimit/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';

export type CreateAppOptions = {
  rateLimiterOverrides?: RateLimiterOverrides;
};

export function createApp(pool: pg.Pool, redis: Redis, options?: CreateAppOptions): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(healthRouter(pool));
  app.use(searchRouter(pool, redis, options?.rateLimiterOverrides));
  // Registered last so it only catches what falls through every route's own handling.
  app.use(errorHandler);

  return app;
}
