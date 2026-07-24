import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedAttributes } from '../ingestion/extraction.js';
import type { RankedCandidate } from './retrieval.js';
import { buildRerankDocument, rerank, selectTopCandidates } from './rerank.js';

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

// Mocks matching the Voyage /v1/rerank response shape: { data: [{ index, relevance_score }] }.
function voyageResponse(scores: number[]): { ok: true; json: () => Promise<unknown> } {
  return {
    ok: true,
    json: async () => ({
      data: scores.map((relevance_score, index) => ({ index, relevance_score })),
    }),
  };
}

describe('buildRerankDocument', () => {
  it('formats null/empty fields as their documented placeholders', () => {
    const candidate = makeCandidate('a', 0.5);
    candidate.extracted_attributes = { ...baseAttributes, pet_friendly: null, view_type: null, amenities: [] };
    candidate.bedrooms = null;
    candidate.price_per_night = null;
    candidate.location = null;

    const result = buildRerankDocument(candidate);

    expect(result).toContain('Pet friendly: unknown');
    expect(result).toContain('View: none mentioned');
    expect(result).toContain('Amenities: none listed');
    expect(result).toContain('Bedrooms: not specified');
    expect(result).toContain('Price per night: not specified');
    expect(result).toContain('Location: not specified');
  });

  it('formats populated fields, and pet_friendly: false distinctly from null', () => {
    const candidate = makeCandidate('a', 0.5);
    candidate.extracted_attributes = {
      property_type: 'condo',
      pet_friendly: false,
      view_type: 'ocean view',
      amenities: ['pool', 'gym'],
      bedrooms_mentioned: 3,
    };

    const result = buildRerankDocument(candidate);

    expect(result).toContain('Pet friendly: no');
    expect(result).toContain('View: ocean view');
    expect(result).toContain('Amenities: pool, gym');
  });

  it('handles null extracted_attributes gracefully', () => {
    const candidate = makeCandidate('a', 0.5);
    candidate.extracted_attributes = null;

    const result = buildRerankDocument(candidate);

    expect(result).toContain('Property type: unknown');
    expect(result).toContain('Pet friendly: unknown');
  });
});

describe('selectTopCandidates', () => {
  it('returns candidates unchanged when at or under the limit', () => {
    const candidates = [makeCandidate('a', 0.5), makeCandidate('b', 0.9)];
    expect(selectTopCandidates(candidates)).toEqual(candidates);
  });

  it('caps at 20, keeping the top 20 by similarityScore when more are passed in', () => {
    const candidates = Array.from({ length: 30 }, (_, i) => makeCandidate(`id-${i}`, i));

    const result = selectTopCandidates(candidates);

    expect(result).toHaveLength(20);
    const expectedIds = Array.from({ length: 20 }, (_, i) => `id-${29 - i}`).sort();
    expect(result.map((c) => c.id).sort()).toEqual(expectedIds);
  });
});

describe('rerank', () => {
  const originalFetch = global.fetch;
  const originalRateLimitEnv = process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE;

  beforeEach(() => {
    // High limit so these tests aren't slowed by the real 3/minute default spacing —
    // voyage/rateLimiter.test.ts covers spacing behavior directly.
    process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE = '1000000';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE = originalRateLimitEnv;
    vi.restoreAllMocks();
  });

  it('returns candidates ordered by relevance_score descending, degraded: false', async () => {
    const candidates = [makeCandidate('a', 0.5), makeCandidate('b', 0.9)];
    // a scores higher than b despite lower similarityScore.
    const fetchMock = vi.fn().mockResolvedValue(voyageResponse([0.3, 0.8]));
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await rerank('romantic getaway, not too remote', candidates);

    expect(outcome.degraded).toBe(false);
    expect(outcome.results.map((r) => r.id)).toEqual(['b', 'a']);
    expect(outcome.results[0]?.relevanceScore).toBe(0.8);
    expect(outcome.results[1]?.relevanceScore).toBe(0.3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends model=rerank-2.5 and the query/documents to the Voyage rerank endpoint', async () => {
    const candidates = [makeCandidate('a', 0.5)];
    const fetchMock = vi.fn().mockResolvedValue(voyageResponse([0.5]));
    global.fetch = fetchMock as unknown as typeof fetch;

    await rerank('cozy cabin', candidates);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.voyageai.com/v1/rerank');
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe('rerank-2.5');
    expect(body.query).toBe('cozy cabin');
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]).toContain('Listing a');
  });

  it('sends only the top 20 documents by similarityScore when more than 20 candidates are passed in', async () => {
    const candidates = Array.from({ length: 30 }, (_, i) => makeCandidate(`id-${i}`, i));
    const fetchMock = vi.fn().mockResolvedValue(voyageResponse(Array.from({ length: 20 }, (_, i) => i)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await rerank('a place to stay', candidates);

    expect(outcome.degraded).toBe(false);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.documents).toHaveLength(20);
  });

  it('appends candidates beyond the 20-cap after the reranked set, in original order, relevanceScore: null', async () => {
    const candidates = Array.from({ length: 30 }, (_, i) => makeCandidate(`id-${i}`, i));
    const fetchMock = vi.fn().mockResolvedValue(voyageResponse(Array.from({ length: 20 }, (_, i) => i)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await rerank('a place to stay', candidates);

    expect(outcome.results).toHaveLength(30);
    const top20Ids = new Set(outcome.results.slice(0, 20).map((r) => r.id));
    const tail = outcome.results.slice(20);
    // Tail is exactly the 10 lowest-similarityScore candidates (id-0..id-9), in their
    // original incoming order, all unscored.
    expect(tail.map((r) => r.id)).toEqual(Array.from({ length: 10 }, (_, i) => `id-${i}`));
    expect(tail.every((r) => r.relevanceScore === null)).toBe(true);
    expect(top20Ids.size).toBe(20);
  });

  it('falls back to the original full candidate order, unmodified, on a persistent network failure', async () => {
    const candidates = [makeCandidate('a', 0.5), makeCandidate('b', 0.9), makeCandidate('c', 0.1)];
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await rerank('a place to stay', candidates);

    expect(outcome.degraded).toBe(true);
    expect(outcome.results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(outcome.results.every((r) => r.relevanceScore === null)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once on a transient 500 and succeeds on the second attempt', async () => {
    const candidates = [makeCandidate('a', 0.5), makeCandidate('b', 0.9)];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error' })
      .mockResolvedValueOnce(voyageResponse([0.4, 0.6]));
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await rerank('a place to stay', candidates);

    expect(outcome.degraded).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back after a single attempt on a non-transient 4xx (no retry, but no throw)', async () => {
    const candidates = [makeCandidate('a', 0.5), makeCandidate('b', 0.9)];
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' });
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await rerank('a place to stay', candidates);

    expect(outcome.degraded).toBe(true);
    expect(outcome.results.map((r) => r.id)).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back on a malformed response shape (missing relevance_score) after both attempts', async () => {
    const candidates = [makeCandidate('a', 0.5), makeCandidate('b', 0.9)];
    const malformed = { ok: true, json: async () => ({ data: [{ index: 0 }, { index: 1 }] }) };
    const fetchMock = vi.fn().mockResolvedValue(malformed);
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await rerank('a place to stay', candidates);

    expect(outcome.degraded).toBe(true);
    expect(outcome.results.map((r) => r.id)).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back on a response with a duplicate index', async () => {
    const candidates = [makeCandidate('a', 0.5), makeCandidate('b', 0.9)];
    const duplicateIndex = {
      ok: true,
      json: async () => ({
        data: [
          { index: 0, relevance_score: 0.5 },
          { index: 0, relevance_score: 0.7 },
        ],
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(duplicateIndex);
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await rerank('a place to stay', candidates);

    expect(outcome.degraded).toBe(true);
    expect(outcome.results.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('falls back on a response with an out-of-range index', async () => {
    const candidates = [makeCandidate('a', 0.5), makeCandidate('b', 0.9)];
    const outOfRangeIndex = {
      ok: true,
      json: async () => ({
        data: [
          { index: 0, relevance_score: 0.5 },
          { index: 5, relevance_score: 0.7 },
        ],
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(outOfRangeIndex);
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await rerank('a place to stay', candidates);

    expect(outcome.degraded).toBe(true);
    expect(outcome.results.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('falls back when the response has fewer results than documents sent', async () => {
    const candidates = [makeCandidate('a', 0.5), makeCandidate('b', 0.9)];
    const tooFewResults = { ok: true, json: async () => ({ data: [{ index: 0, relevance_score: 0.5 }] }) };
    const fetchMock = vi.fn().mockResolvedValue(tooFewResults);
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await rerank('a place to stay', candidates);

    expect(outcome.degraded).toBe(true);
    expect(outcome.results.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('awaits reserveSlot before making the request', async () => {
    const events: string[] = [];
    const reserveSlotSpy = vi
      .spyOn(await import('../voyage/rateLimiter.js'), 'reserveSlot')
      .mockImplementation(async () => {
        events.push('reserveSlot');
      });
    const fetchMock = vi.fn().mockImplementation(async () => {
      events.push('fetch');
      return voyageResponse([0.5]);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await rerank('a place to stay', [makeCandidate('a', 0.5)]);

    expect(events).toEqual(['reserveSlot', 'fetch']);
    reserveSlotSpy.mockRestore();
  });
});
