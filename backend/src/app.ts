import express, { type Express } from 'express';
import cors from 'cors';
import type pg from 'pg';
import { healthRouter } from './routes/health.js';
import { searchRouter } from './routes/search.js';

export type CreateAppOptions = {
  searchRateLimit?: { windowMs: number; max: number };
};

export function createApp(pool: pg.Pool, options?: CreateAppOptions): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(healthRouter(pool));
  app.use(searchRouter(pool, options?.searchRateLimit));

  return app;
}
