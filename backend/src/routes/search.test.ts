import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import type { SearchResponse } from '../services/search/orchestrateSearch.js';
import type { SearchLogEntry } from '../services/search/searchLogs.js';
import { getTestRedisUrl } from '../test/testRedis.js';
import { createRedisClient } from '../services/redis/client.js';

const runSearchMock = vi.fn();
vi.mock('../services/search/orchestrateSearch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/search/orchestrateSearch.js')>();
  return { ...actual, runSearch: (...args: unknown[]) => runSearchMock(...args) };
});

const logSearchMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/search/searchLogs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/search/searchLogs.js')>();
  return { ...actual, logSearch: (...args: unknown[]) => logSearchMock(...args) };
});

const naiveSearchListingsMock = vi.fn();
vi.mock('../services/search/naiveSearch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/search/naiveSearch.js')>();
  return { ...actual, naiveSearchListings: (...args: unknown[]) => naiveSearchListingsMock(...args) };
});

import { createApp } from '../app.js';
import { SearchRetrievalError } from '../services/search/orchestrateSearch.js';
import type { Listing } from '../services/search/retrieval.js';

const pool = {} as pg.Pool;
// Real test Redis (RateLimiterRedis needs genuine Redis quota/window semantics, not an
// in-memory swap) — flushed before every test so leftover consumption from one test's
// limiter never bleeds into the next (all limiter instances in this file share the same
// keyPrefix + client-IP key regardless of which `createApp` call constructed them).
const redis = createRedisClient(getTestRedisUrl());

afterAll(() => {
  redis.disconnect();
});

const sampleListing: Listing = {
  id: 'a',
  title: 'Cozy Cabin',
  raw_description: 'A cozy cabin.',
  price_per_night: 100,
  bedrooms: 1,
  location: 'Manali',
  latitude: 0,
  longitude: 0,
  extracted_attributes: null,
  ingestion_status: 'processed',
};

const sampleResponse: SearchResponse = {
  results: [
    {
      id: 'a',
      title: 'Cozy Cabin',
      raw_description: 'A cozy cabin.',
      price_per_night: 100,
      bedrooms: 1,
      location: 'Manali',
      latitude: 0,
      longitude: 0,
      extracted_attributes: null,
      ingestion_status: 'processed',
      relevanceScore: 0.9,
    },
  ],
  degraded: false,
  filtersRelaxed: false,
  timing: { understanding_ms: 100, retrieval_ms: 50, rerank_ms: 30, total_ms: 180 },
};

const sampleLogEntry: SearchLogEntry = {
  raw_query: 'cozy cabin',
  extracted_intent: { filters: { pet_friendly: null, property_type: null, location: null, min_bedrooms: null, max_price: null }, semantic_query: 'cozy cabin' },
  candidate_ids: ['a'],
  ranked_ids: ['a'],
  latency_ms: 180,
  model_calls: {
    query_understanding: {
      model: 'claude-haiku-4-5-20251001',
      succeeded: true,
      usage: { inputTokens: 40, outputTokens: 20 },
    },
    embedding: { model: 'voyage-4', tokens: 8 },
    rerank: { model: 'rerank-2.5', degraded: false, tokens: 150 },
    cache: { hit: false },
  },
};

beforeEach(async () => {
  runSearchMock.mockReset();
  logSearchMock.mockClear();
  naiveSearchListingsMock.mockReset();
  await redis.flushdb();
});

describe('POST /api/search', () => {
  const app = createApp(pool, redis);

  it('returns 200 with the search response and fires an async search_logs write', async () => {
    runSearchMock.mockResolvedValue({ response: sampleResponse, logEntry: sampleLogEntry });

    const response = await request(app).post('/api/search').send({ query: 'cozy cabin' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(sampleResponse);
    expect(runSearchMock).toHaveBeenCalledWith(pool, 'cozy cabin', redis, undefined);

    await vi.waitFor(() => expect(logSearchMock).toHaveBeenCalledWith(pool, sampleLogEntry));
  });

  it('threads a valid destination through to runSearch (spec 12)', async () => {
    runSearchMock.mockResolvedValue({ response: sampleResponse, logEntry: sampleLogEntry });

    const response = await request(app).post('/api/search').send({ query: 'cozy cabin', destination: 'goa' });

    expect(response.status).toBe(200);
    expect(runSearchMock).toHaveBeenCalledWith(pool, 'cozy cabin', redis, 'goa');
  });

  it('returns 400 for an unknown destination slug and does not call runSearch', async () => {
    const response = await request(app).post('/api/search').send({ query: 'cozy cabin', destination: 'mumbai' });

    expect(response.status).toBe(400);
    expect(typeof response.body.error).toBe('string');
    expect(runSearchMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty query', async () => {
    const response = await request(app).post('/api/search').send({ query: '' });

    expect(response.status).toBe(400);
    expect(typeof response.body.error).toBe('string');
    expect(runSearchMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an oversized query', async () => {
    const response = await request(app)
      .post('/api/search')
      .send({ query: 'a'.repeat(201) });

    expect(response.status).toBe(400);
    expect(typeof response.body.error).toBe('string');
    expect(runSearchMock).not.toHaveBeenCalled();
  });

  it('returns 500 and still logs a partial entry when retrieveCandidates fails', async () => {
    const partialLogEntry: SearchLogEntry = {
      ...sampleLogEntry,
      candidate_ids: [],
      ranked_ids: [],
      model_calls: { ...sampleLogEntry.model_calls, embedding: null, rerank: null, failure: { stage: 'retrieval', error: true } },
    };
    runSearchMock.mockRejectedValue(new SearchRetrievalError(new Error('pgvector failed'), partialLogEntry));

    const response = await request(app).post('/api/search').send({ query: 'cozy cabin' });

    expect(response.status).toBe(500);
    expect(typeof response.body.error).toBe('string');
    await vi.waitFor(() => expect(logSearchMock).toHaveBeenCalledWith(pool, partialLogEntry));
  });

  it('returns 500 without logging when an unrecognized error is thrown', async () => {
    runSearchMock.mockRejectedValue(new Error('unexpected'));

    const response = await request(app).post('/api/search').send({ query: 'cozy cabin' });

    expect(response.status).toBe(500);
    expect(logSearchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/search — rate limiting', () => {
  it('rejects the request past the configured per-window limit with 429', async () => {
    const app = createApp(pool, redis, { rateLimiterOverrides: { anonymousPoints: 3 } });
    runSearchMock.mockResolvedValue({ response: sampleResponse, logEntry: sampleLogEntry });

    for (let i = 0; i < 3; i += 1) {
      const ok = await request(app).post('/api/search').send({ query: 'cozy cabin' });
      expect(ok.status).toBe(200);
    }

    const limited = await request(app).post('/api/search').send({ query: 'cozy cabin' });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'Too many requests. Please try again later.' });
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('GET /api/search/naive', () => {
  const app = createApp(pool, redis);

  it('returns 200 with results for a valid query', async () => {
    naiveSearchListingsMock.mockResolvedValue([sampleListing]);

    const response = await request(app).get('/api/search/naive').query({ q: 'cabin' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: [sampleListing] });
    expect(naiveSearchListingsMock).toHaveBeenCalledWith(pool, 'cabin', undefined);
  });

  it('passes literal % and _ through to the service unescaped by the route itself', async () => {
    naiveSearchListingsMock.mockResolvedValue([]);

    const response = await request(app).get('/api/search/naive').query({ q: '50%_off' });

    expect(response.status).toBe(200);
    expect(naiveSearchListingsMock).toHaveBeenCalledWith(pool, '50%_off', undefined);
  });

  it('threads a valid destination through to the service (spec 12)', async () => {
    naiveSearchListingsMock.mockResolvedValue([sampleListing]);

    const response = await request(app).get('/api/search/naive').query({ q: 'cabin', destination: 'goa' });

    expect(response.status).toBe(200);
    expect(naiveSearchListingsMock).toHaveBeenCalledWith(pool, 'cabin', 'goa');
  });

  it('returns 400 for an unknown destination slug and does not call the service', async () => {
    const response = await request(app).get('/api/search/naive').query({ q: 'cabin', destination: 'mumbai' });

    expect(response.status).toBe(400);
    expect(naiveSearchListingsMock).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing q', async () => {
    const response = await request(app).get('/api/search/naive');

    expect(response.status).toBe(400);
    expect(typeof response.body.error).toBe('string');
    expect(naiveSearchListingsMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty q', async () => {
    const response = await request(app).get('/api/search/naive').query({ q: '' });

    expect(response.status).toBe(400);
    expect(naiveSearchListingsMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the service throws', async () => {
    naiveSearchListingsMock.mockRejectedValue(new Error('db error'));

    const response = await request(app).get('/api/search/naive').query({ q: 'cabin' });

    expect(response.status).toBe(500);
    expect(typeof response.body.error).toBe('string');
  });

  it('shares the rate limiter with POST /api/search (confirmed shared-budget design)', async () => {
    const sharedApp = createApp(pool, redis, { rateLimiterOverrides: { anonymousPoints: 3 } });
    runSearchMock.mockResolvedValue({ response: sampleResponse, logEntry: sampleLogEntry });
    naiveSearchListingsMock.mockResolvedValue([sampleListing]);

    const first = await request(sharedApp).post('/api/search').send({ query: 'cozy cabin' });
    const second = await request(sharedApp).get('/api/search/naive').query({ q: 'cabin' });
    const third = await request(sharedApp).post('/api/search').send({ query: 'cozy cabin' });
    expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);

    const fourth = await request(sharedApp).get('/api/search/naive').query({ q: 'cabin' });
    expect(fourth.status).toBe(429);
  });
});
