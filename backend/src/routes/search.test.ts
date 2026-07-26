import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import type { SearchResponse } from '../services/search/orchestrateSearch.js';
import type { SearchLogEntry } from '../services/search/searchLogs.js';

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

import { createApp } from '../app.js';
import { SearchRetrievalError } from '../services/search/orchestrateSearch.js';

const pool = {} as pg.Pool;

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
  extracted_intent: { filters: { pet_friendly: null, property_type: null, min_bedrooms: null, max_price: null }, semantic_query: 'cozy cabin' },
  candidate_ids: ['a'],
  ranked_ids: ['a'],
  latency_ms: 180,
  model_calls: {
    query_understanding: { model: 'claude-haiku-4-5-20251001', succeeded: true },
    embedding: { model: 'voyage-4' },
    rerank: { model: 'rerank-2.5', degraded: false },
  },
};

beforeEach(() => {
  runSearchMock.mockReset();
  logSearchMock.mockClear();
});

describe('POST /api/search', () => {
  const app = createApp(pool);

  it('returns 200 with the search response and fires an async search_logs write', async () => {
    runSearchMock.mockResolvedValue({ response: sampleResponse, logEntry: sampleLogEntry });

    const response = await request(app).post('/api/search').send({ query: 'cozy cabin' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(sampleResponse);
    expect(runSearchMock).toHaveBeenCalledWith(pool, 'cozy cabin');

    await vi.waitFor(() => expect(logSearchMock).toHaveBeenCalledWith(pool, sampleLogEntry));
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
    const app = createApp(pool, { searchRateLimit: { windowMs: 60_000, max: 3 } });
    runSearchMock.mockResolvedValue({ response: sampleResponse, logEntry: sampleLogEntry });

    for (let i = 0; i < 3; i += 1) {
      const ok = await request(app).post('/api/search').send({ query: 'cozy cabin' });
      expect(ok.status).toBe(200);
    }

    const limited = await request(app).post('/api/search').send({ query: 'cozy cabin' });
    expect(limited.status).toBe(429);
  });
});
