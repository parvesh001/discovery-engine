import express, { type Express } from 'express';
import cors from 'cors';
import type pg from 'pg';
import { healthRouter } from './routes/health.js';

export function createApp(pool: pg.Pool): Express {
  const app = express();

  app.use(cors());
  app.use(healthRouter(pool));

  return app;
}
