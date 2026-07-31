import { beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
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

import { runSearch, SearchRetrievalError } from './orchestrateSearch.js';

const pool = {} as pg.Pool;

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

    const { response, logEntry } = await runSearch(pool, 'cabin with a mountain view');

    expect(retrieveCandidatesMock).toHaveBeenCalledWith(pool, realIntent, null);
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

    const { response, logEntry } = await runSearch(pool, 'cabin');

    expect(response.degraded).toBe(true);
    expect(logEntry.model_calls.rerank).toEqual({ model: 'rerank-2.5', degraded: true, tokens: null });
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

    const { logEntry } = await runSearch(pool, 'raw fallback query');

    const expectedFallbackIntent: QueryIntent = { filters: emptyFilters, semantic_query: 'raw fallback query' };
    expect(retrieveCandidatesMock).toHaveBeenCalledWith(pool, expectedFallbackIntent, null);
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

    await expect(runSearch(pool, 'cabin with a mountain view')).rejects.toThrow(SearchRetrievalError);

    try {
      await runSearch(pool, 'cabin with a mountain view');
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
      });
      expect(searchError.cause).toBeInstanceOf(Error);
    }
  });

  it('still records that understanding itself already failed, when both stages fail', async () => {
    understandQueryMock.mockRejectedValue(new Error('Claude timed out'));
    retrieveCandidatesMock.mockRejectedValue(new Error('pgvector query failed'));

    try {
      await runSearch(pool, 'raw fallback query');
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
