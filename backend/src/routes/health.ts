import { Router } from 'express';
import type pg from 'pg';
import { checkConnection } from '../db.js';

export function healthRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    try {
      await checkConnection(pool);
      res.status(200).json({ status: 'ok', db: 'connected' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown database error';
      console.error('[health] database connectivity check failed:', detail);
      res.status(503).json({ status: 'error', detail });
    }
  });

  return router;
}
