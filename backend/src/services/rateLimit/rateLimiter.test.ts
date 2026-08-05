import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { getTestRedisUrl } from '../../test/testRedis.js';
import { createRedisClient } from '../redis/client.js';
import {
  ANONYMOUS_POINTS,
  AUTHENTICATED_POINTS,
  createRateLimiters,
  isAuthenticated,
  rateLimitMiddleware,
  type RateLimiterOverrides,
} from './rateLimiter.js';

const redis = createRedisClient(getTestRedisUrl());

afterAll(() => {
  redis.disconnect();
});

beforeEach(async () => {
  await redis.flushdb();
});

function buildTestApp(overrides?: RateLimiterOverrides): Express {
  const limiters = createRateLimiters(redis, overrides);
  const app = express();
  app.get('/ping', rateLimitMiddleware(limiters), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('isAuthenticated', () => {
  it('is a hardcoded stub always returning false (spec 10: no auth system exists yet)', () => {
    expect(isAuthenticated({} as never)).toBe(false);
  });
});

describe('rateLimitMiddleware — documented tiers', () => {
  it('enforces the documented default anonymous tier (20/min)', async () => {
    const app = buildTestApp();

    for (let i = 0; i < ANONYMOUS_POINTS; i += 1) {
      const ok = await request(app).get('/ping');
      expect(ok.status).toBe(200);
    }

    const limited = await request(app).get('/ping');
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'Too many requests. Please try again later.' });
  });

  it('enforces a small anonymous override independently of the default', async () => {
    const app = buildTestApp({ anonymousPoints: 2 });

    await request(app).get('/ping').expect(200);
    await request(app).get('/ping').expect(200);
    const limited = await request(app).get('/ping');
    expect(limited.status).toBe(429);
  });

  it('enforces the documented authenticated tier (60/min) via the limiter directly, since isAuthenticated is currently dormant', async () => {
    const limiters = createRateLimiters(redis, { authenticatedPoints: 5 });

    for (let i = 0; i < 5; i += 1) {
      await expect(limiters.authenticated.consume('test-authenticated-key')).resolves.toBeDefined();
    }
    await expect(limiters.authenticated.consume('test-authenticated-key')).rejects.toBeDefined();
  });

  it('documents the two tiers as independently configured (20 vs 60 by default)', () => {
    expect(ANONYMOUS_POINTS).toBe(20);
    expect(AUTHENTICATED_POINTS).toBe(60);
  });

  it('sets a Retry-After header on rejection', async () => {
    const app = buildTestApp({ anonymousPoints: 1 });

    await request(app).get('/ping').expect(200);
    const limited = await request(app).get('/ping');

    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});
