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

async function insert(
  title: string,
  destination: string | null,
  opts: { price?: number; status?: string } = {},
) {
  await pool.query(
    `INSERT INTO listings (title, raw_description, price_per_night, bedrooms, location, latitude, longitude,
                            ingestion_status, destination)
     VALUES ($1, 'A listing.', $2, 1, 'Test', 0, 0, $3, $4)`,
    [title, opts.price ?? 1000, opts.status ?? 'processed', destination],
  );
}

describe('GET /api/listings', () => {
  it('returns only processed listings for the requested destination, price-ascending', async () => {
    await insert('Manali Pricey', 'manali', { price: 5000 });
    await insert('Manali Cheap', 'manali', { price: 1000 });
    await insert('Manali Mid', 'manali', { price: 3000 });
    await insert('Goa One', 'goa', { price: 2000 });
    await insert('Unscoped', null, { price: 500 });
    await insert('Manali Pending', 'manali', { price: 100, status: 'pending' });

    const response = await request(app).get('/api/listings').query({ destination: 'manali' });

    expect(response.status).toBe(200);
    expect(response.body.destination).toBe('manali');
    expect(response.body.results.map((r: { title: string }) => r.title)).toEqual([
      'Manali Cheap',
      'Manali Mid',
      'Manali Pricey',
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
