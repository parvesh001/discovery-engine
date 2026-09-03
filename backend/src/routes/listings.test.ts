import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { getTestDatabaseUrl } from '../test/testDb.js';
import { getTestRedisUrl } from '../test/testRedis.js';
import { createRedisClient } from '../services/redis/client.js';
import { createApp } from '../app.js';

const pool = new pg.Pool({ connectionString: getTestDatabaseUrl() });
const redis = createRedisClient(getTestRedisUrl());
const app = createApp(pool, redis);

afterAll(async () => {
  await pool.end();
  redis.disconnect();
});

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE listings CASCADE');
  await redis.flushdb();
});

// `createdAt` is set explicitly per row: the browse endpoint orders by `created_at ASC,
// id ASC`, and seed-demo.ts fabricates that column to encode curated order (spec 12,
// "Revised During Implementation"). Passing it here keeps these tests deterministic rather
// than leaning on wall-clock ordering between sequential INSERTs.
async function insert(
  title: string,
  destination: string | null,
  opts: { price?: number; status?: string; createdAt?: string } = {},
) {
  await pool.query(
    `INSERT INTO listings (title, raw_description, price_per_night, bedrooms, location, latitude, longitude,
                            ingestion_status, destination, created_at)
     VALUES ($1, 'A listing.', $2, 1, 'Test', 0, 0, $3, $4, $5)`,
    [
      title,
      opts.price ?? 1000,
      opts.status ?? 'processed',
      destination,
      opts.createdAt ?? '2020-01-01T00:00:00.000Z',
    ],
  );
}

describe('GET /api/listings', () => {
  it('returns processed listings for the destination in created_at (curated) order, not price order', async () => {
    // Insert in the intended display order with ascending created_at, prices deliberately
    // NOT monotonic — proves the endpoint honours created_at, not price.
    await insert('Manali First', 'manali', { price: 5000, createdAt: '2020-01-01T00:00:01.000Z' });
    await insert('Manali Second', 'manali', { price: 1000, createdAt: '2020-01-01T00:00:02.000Z' });
    await insert('Manali Third', 'manali', { price: 3000, createdAt: '2020-01-01T00:00:03.000Z' });
    await insert('Goa One', 'goa', { price: 2000, createdAt: '2020-01-01T00:00:00.500Z' });
    await insert('Unscoped', null, { price: 500, createdAt: '2020-01-01T00:00:00.100Z' });
    await insert('Manali Pending', 'manali', { price: 100, status: 'pending', createdAt: '2020-01-01T00:00:00.200Z' });

    const response = await request(app).get('/api/listings').query({ destination: 'manali' });

    expect(response.status).toBe(200);
    expect(response.body.destination).toBe('manali');
    expect(response.body.results.map((r: { title: string }) => r.title)).toEqual([
      'Manali First',
      'Manali Second',
      'Manali Third',
    ]);
  });

  it('returns an empty list (not an error) for a destination with no processed listings', async () => {
    await insert('Goa Only', 'goa');

    const response = await request(app).get('/api/listings').query({ destination: 'manali' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: [], destination: 'manali' });
  });

  it('returns 400 when destination is missing', async () => {
    const response = await request(app).get('/api/listings');

    expect(response.status).toBe(400);
    expect(typeof response.body.error).toBe('string');
  });

  it('returns 400 for an unknown destination slug', async () => {
    const response = await request(app).get('/api/listings').query({ destination: 'mumbai' });

    expect(response.status).toBe(400);
    expect(typeof response.body.error).toBe('string');
  });

  it('shares the per-IP rate-limit budget with the search routes', async () => {
    const sharedApp = createApp(pool, redis, { rateLimiterOverrides: { anonymousPoints: 2 } });
    await insert('Manali One', 'manali');

    const first = await request(sharedApp).get('/api/listings').query({ destination: 'manali' });
    const second = await request(sharedApp).get('/api/search/naive').query({ q: 'listing' });
    const third = await request(sharedApp).get('/api/listings').query({ destination: 'manali' });

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(third.status).toBe(429);
  });
});
