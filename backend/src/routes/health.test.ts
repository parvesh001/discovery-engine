import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../app.js';

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/discovery_engine';

describe('GET /health', () => {
  describe('when the database is reachable', () => {
    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
    const app = createApp(pool);

    afterAll(async () => {
      await pool.end();
    });

    it('returns 200 with status ok and db connected', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', db: 'connected' });
    });
  });

  describe('when the database is unreachable', () => {
    const pool = new pg.Pool({
      connectionString: 'postgresql://postgres:postgres@localhost:1/discovery_engine',
      connectionTimeoutMillis: 500,
    });
    const app = createApp(pool);

    afterAll(async () => {
      await pool.end();
    });

    it('returns 503 with a descriptive error instead of crashing', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('error');
      expect(typeof response.body.detail).toBe('string');
    });
  });
});
