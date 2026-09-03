import { beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { ExtractedAttributes } from '../ingestion/extraction.js';
import type { RankedCandidate } from './retrieval.js';
import type { RerankedCandidate } from './rerank.js';
import type { QueryIntent } from './queryUnderstanding.js';

const understandQueryMock = vi.fn();
vi.mock('./queryUnderstanding.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./queryUnderstanding.js')>();
  return { ...actual, understandQuery: (...args: unknown[]) => understandQueryMock(...args) };
});

const retrieveCandidatesMock = vi.fn();
vi.mock('./retrieval.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./retrieval.js')>();
  return { ...actual, retrieveCandidates: (...args: unknown[]) => retrieveCandidatesMock(...args) };
});

const rerankMock = vi.fn();
vi.mock('./rerank.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rerank.js')>();
  return { ...actual, rerank: (...args: unknown[]) => rerankMock(...args) };
});

import { runSearch, SearchRetrievalError, type SearchResponse } from './orchestrateSearch.js';
import type { CachedSearchEntry } from '../cache/searchCache.js';

const pool = {} as pg.Pool;

// Lightweight fake — always a cache miss (get resolves null) and set resolves fine, so
// existing pipeline-focused tests below are unaffected by caching. The "runSearch — cache"
// describe block further down overrides these per-test to exercise cache-hit/miss directly.
function makeFakeRedis(): Redis {
  return { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') } as unknown as Redis;
}
const redis = makeFakeRedis();

const baseAttributes: ExtractedAttributes = {
  property_type: 'cabin',
  pet_friendly: true,
  view_type: null,
  amenities: [],
  bedrooms_mentioned: null,
};

function makeCandidate(id: string, similarityScore: number): RankedCandidate {
  return {
    id,
    title: `Listing ${id}`,
    raw_description: `Description for ${id}.`,
    price_per_night: 100,
    bedrooms: 1,
    location: 'Test, CO',
    latitude: 0,
    longitude: 0,
    extracted_attributes: baseAttributes,
    ingestion_status: 'processed',
    similarityScore,
  };
}

const emptyFilters: QueryIntent['filters'] = {
  pet_friendly: null,
  property_type: null,
  location: null,
  min_bedrooms: null,
  max_price: null,
};

const realIntent: QueryIntent = {
  filters: { ...emptyFilters, property_type: 'cabin' },
  semantic_query: 'cabin with a mountain view',
};

const realUnderstandingResult = { intent: realIntent, usage: { inputTokens: 10, outputTokens: 5 } };

beforeEach(() => {
  understandQueryMock.mockReset();
  retrieveCandidatesMock.mockReset();
  rerankMock.mockReset();
  vi.mocked(redis.get).mockReset().mockResolvedValue(null);
  vi.mocked(redis.set).mockReset().mockResolvedValue('OK');
});

describe('runSearch — happy path', () => {
  it('returns a well-formed response and log entry, stripping similarityScore from results', async () => {
    understandQueryMock.mockResolvedValue(realUnderstandingResult);
    const candidates = [makeCandidate('a', 0.9), makeCandidate('b', 0.8)];
    retrieveCandidatesMock.mockResolvedValue({ candidates, filtersRelaxed: false, embeddingTokens: 15 });
    const reranked: RerankedCandidate[] = [
      { ...candidates[1]!, relevanceScore: 0.95 },
      { ...candidates[0]!, relevanceScore: 0.4 },
    ];
    rerankMock.mockResolvedValue({ results: reranked, degraded: false, tokens: 30 });

    const { response, logEntry } = await runSearch(pool, 'cabin with a mountain view', redis);

    expect(retrieveCandidatesMock).toHaveBeenCalledWith(pool, realIntent, null, undefined);
    expect(rerankMock).toHaveBeenCalledWith(realIntent.semantic_query, candidates, null);

    expect(response.degraded).toBe(false);
    expect(response.filtersRelaxed).toBe(false);
    expect(response.results.map((r) => r.id)).toEqual(['b', 'a']);
    expect(response.results[0]).not.toHaveProperty('similarityScore');
    expect(response.results[0]?.relevanceScore).toBe(0.95);
    expect(response.timing.total_ms).toBeGreaterThanOrEqual(0);

    expect(logEntry.raw_query).toBe('cabin with a mountain view');
    expect(logEntry.extracted_intent).toEqual(realIntent);
    expect(logEntry.candidate_ids).toEqual(['a', 'b']);
    expect(logEntry.ranked_ids).toEqual(['b', 'a']);
    expect(logEntry.model_calls.query_understanding).toEqual({
      model: 'claude-haiku-4-5-20251001',
      succeeded: true,
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(logEntry.model_calls.embedding).toEqual({ model: 'voyage-4', tokens: 15 });
    expect(logEntry.model_calls.rerank).toEqual({ model: 'rerank-2.5', degraded: false, tokens: 30 });
    expect(logEntry.model_calls.failure).toBeUndefined();
  });

  it('surfaces rerank degradation in both the response and the log entry', async () => {
    understandQueryMock.mockResolvedValue(realUnderstandingResult);
    const candidates = [makeCandidate('a', 0.9)];
    retrieveCandidatesMock.mockResolvedValue({ candidates, filtersRelaxed: false, embeddingTokens: 15 });
    rerankMock.mockResolvedValue({
      results: candidates.map((c) => ({ ...c, relevanceScore: null })),
      degraded: true,
      tokens: null,
    });

    const { response, logEntry } = await runSearch(pool, 'cabin', redis);

    expect(response.degraded).toBe(true);
    expect(logEntry.model_calls.rerank).toEqual({ model: 'rerank-2.5', degraded: true, tokens: null });
  });
});

describe('runSearch — destination scope (spec 12)', () => {
  it('threads a validated destination to retrieveCandidates and namespaces the cache key', async () => {
    understandQueryMock.mockResolvedValue(realUnderstandingResult);
    const candidates = [makeCandidate('a', 0.9)];
    retrieveCandidatesMock.mockResolvedValue({ candidates, filtersRelaxed: false, embeddingTokens: 15 });
    rerankMock.mockResolvedValue({
      results: candidates.map((c) => ({ ...c, relevanceScore: 0.5 })),
      degraded: false,
      tokens: 30,
    });

    await runSearch(pool, 'beachfront villa', redis, 'manali');

    expect(retrieveCandidatesMock).toHaveBeenCalledWith(pool, realIntent, null, 'manali');
    // Cache read + write both keyed under the destination namespace.
    expect(vi.mocked(redis.get).mock.calls[0]?.[0]).toContain('manali:beachfront villa');
    expect(vi.mocked(redis.set).mock.calls[0]?.[0]).toContain('manali:beachfront villa');
  });

  it('omitting the destination keeps the pre-Phase-11 (global) cache key and retrieval call', async () => {
    understandQueryMock.mockResolvedValue(realUnderstandingResult);
    const candidates = [makeCandidate('a', 0.9)];
    retrieveCandidatesMock.mockResolvedValue({ candidates, filtersRelaxed: false, embeddingTokens: 15 });
    rerankMock.mockResolvedValue({
      results: candidates.map((c) => ({ ...c, relevanceScore: 0.5 })),
      degraded: false,
      tokens: 30,
    });

    await runSearch(pool, 'beachfront villa', redis);

    expect(retrieveCandidatesMock).toHaveBeenCalledWith(pool, realIntent, null, undefined);
    expect(vi.mocked(redis.get).mock.calls[0]?.[0]).toBe('search:v1:beachfront villa');
  });
});

describe('runSearch — understandQuery failure', () => {
  it('falls back to the raw query with null filters and continues the pipeline', async () => {
    understandQueryMock.mockRejectedValue(new Error('Claude timed out'));
    const candidates = [makeCandidate('a', 0.9)];
    retrieveCandidatesMock.mockResolvedValue({ candidates, filtersRelaxed: false, embeddingTokens: 15 });
    rerankMock.mockResolvedValue({
      results: candidates.map((c) => ({ ...c, relevanceScore: 0.5 })),
      degraded: false,
      tokens: 30,
    });

    const { logEntry } = await runSearch(pool, 'raw fallback query', redis);

    const expectedFallbackIntent: QueryIntent = { filters: emptyFilters, semantic_query: 'raw fallback query' };
    expect(retrieveCandidatesMock).toHaveBeenCalledWith(pool, expectedFallbackIntent, null, undefined);
    expect(rerankMock).toHaveBeenCalledWith('raw fallback query', candidates, null);
    expect(logEntry.extracted_intent).toEqual(expectedFallbackIntent);
    expect(logEntry.model_calls.query_understanding.succeeded).toBe(false);
    expect(logEntry.model_calls.query_understanding.usage).toBeNull();
  });
});

describe('runSearch — retrieveCandidates failure', () => {
  it('rejects with SearchRetrievalError carrying a partial log entry when understanding succeeded', async () => {
    understandQueryMock.mockResolvedValue(realUnderstandingResult);
    retrieveCandidatesMock.mockRejectedValue(new Error('pgvector query failed'));

    await expect(runSearch(pool, 'cabin with a mountain view', redis)).rejects.toThrow(SearchRetrievalError);

    try {
      await runSearch(pool, 'cabin with a mountain view', redis);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SearchRetrievalError);
      const searchError = error as SearchRetrievalError;
      expect(searchError.partialLogEntry.raw_query).toBe('cabin with a mountain view');
      expect(searchError.partialLogEntry.extracted_intent).toEqual(realIntent);
      expect(searchError.partialLogEntry.candidate_ids).toEqual([]);
      expect(searchError.partialLogEntry.ranked_ids).toEqual([]);
      expect(searchError.partialLogEntry.model_calls).toEqual({
        query_understanding: {
          model: 'claude-haiku-4-5-20251001',
          succeeded: true,
          usage: { inputTokens: 10, outputTokens: 5 },
        },
        embedding: null,
        rerank: null,
        failure: { stage: 'retrieval', error: true },
        cache: { hit: false },
      });
      expect(searchError.cause).toBeInstanceOf(Error);
    }
  });

  it('still records that understanding itself already failed, when both stages fail', async () => {
    understandQueryMock.mockRejectedValue(new Error('Claude timed out'));
    retrieveCandidatesMock.mockRejectedValue(new Error('pgvector query failed'));

    try {
      await runSearch(pool, 'raw fallback query', redis);
      expect.unreachable();
    } catch (error) {
      const searchError = error as SearchRetrievalError;
      expect(searchError.partialLogEntry.extracted_intent).toEqual({
        filters: emptyFilters,
        semantic_query: 'raw fallback query',
      });
      expect(searchError.partialLogEntry.model_calls.query_understanding.succeeded).toBe(false);
      expect(searchError.partialLogEntry.model_calls.failure).toEqual({ stage: 'retrieval', error: true });
    }
  });
});

describe('runSearch — cache', () => {
  const cachedResults = [{ ...makeCandidate('cached-a', 0.9), relevanceScore: 0.8 }];
  const cachedResponse: SearchResponse = {
    results: cachedResults,
    degraded: false,
    filtersRelaxed: false,
    // Deliberately stale/non-zero — a hit must replace this with the current request's
    // own (near-zero) latency, not serve back whatever the original run measured.
    timing: { understanding_ms: 999, retrieval_ms: 999, rerank_ms: 999, total_ms: 999 },
  };
  const cachedEntry: CachedSearchEntry = { response: cachedResponse, intent: realIntent };

  it('on a hit, returns the cached response and skips understandQuery/retrieveCandidates/rerank entirely', async () => {
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedEntry));

    const { response, logEntry } = await runSearch(pool, 'cabin with a mountain view', redis);

    expect(understandQueryMock).not.toHaveBeenCalled();
    expect(retrieveCandidatesMock).not.toHaveBeenCalled();
    expect(rerankMock).not.toHaveBeenCalled();

    expect(response.results).toEqual(cachedResults);
    expect(response.degraded).toBe(false);
    // Timing replaced with this request's own numbers, not the stale cached 999s.
    expect(response.timing.understanding_ms).toBe(0);
    expect(response.timing.retrieval_ms).toBe(0);
    expect(response.timing.rerank_ms).toBe(0);
    expect(response.timing.total_ms).toBeLessThan(999);

    expect(logEntry.extracted_intent).toEqual(realIntent);
    expect(logEntry.candidate_ids).toEqual(['cached-a']);
    expect(logEntry.ranked_ids).toEqual(['cached-a']);
    expect(logEntry.model_calls.cache).toEqual({ hit: true });
    expect(logEntry.model_calls.embedding).toBeNull();
    expect(logEntry.model_calls.rerank).toBeNull();
    expect(logEntry.model_calls.query_understanding.usage).toBeNull();
  });

  it('on a miss, runs the full pipeline and populates the cache with the response and intent', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    understandQueryMock.mockResolvedValue(realUnderstandingResult);
    const candidates = [makeCandidate('a', 0.9)];
    retrieveCandidatesMock.mockResolvedValue({ candidates, filtersRelaxed: false, embeddingTokens: 15 });
    rerankMock.mockResolvedValue({ results: candidates.map((c) => ({ ...c, relevanceScore: 0.7 })), degraded: false, tokens: 30 });

    const { response, logEntry } = await runSearch(pool, 'cabin with a mountain view', redis);

    expect(logEntry.model_calls.cache).toEqual({ hit: false });
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, value] = vi.mocked(redis.set).mock.calls[0] as [string, string];
    expect(key).toBe('search:v1:cabin with a mountain view');
    expect(JSON.parse(value)).toEqual({ response, intent: realIntent });
  });

  it('does not populate the cache when understanding fell back (degraded outcome)', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    understandQueryMock.mockRejectedValue(new Error('Claude timed out'));
    const candidates = [makeCandidate('a', 0.9)];
    retrieveCandidatesMock.mockResolvedValue({ candidates, filtersRelaxed: false, embeddingTokens: 15 });
    rerankMock.mockResolvedValue({ results: candidates.map((c) => ({ ...c, relevanceScore: 0.7 })), degraded: false, tokens: 30 });

    await runSearch(pool, 'raw fallback query', redis);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('does not populate the cache when rerank degraded', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    understandQueryMock.mockResolvedValue(realUnderstandingResult);
    const candidates = [makeCandidate('a', 0.9)];
    retrieveCandidatesMock.mockResolvedValue({ candidates, filtersRelaxed: false, embeddingTokens: 15 });
    rerankMock.mockResolvedValue({ results: candidates.map((c) => ({ ...c, relevanceScore: null })), degraded: true, tokens: null });

    await runSearch(pool, 'cabin with a mountain view', redis);

    expect(redis.set).not.toHaveBeenCalled();
  });
});
