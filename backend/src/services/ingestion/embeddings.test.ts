import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEmbeddingInput, generateEmbedding, EmbeddingError } from './embeddings.js';
import type { ExtractedAttributes } from './extraction.js';

describe('buildEmbeddingInput', () => {
  it('formats null/empty fields as their documented placeholders', () => {
    const attrs: ExtractedAttributes = {
      property_type: 'cabin',
      pet_friendly: null,
      view_type: null,
      amenities: [],
      bedrooms_mentioned: null,
    };

    const result = buildEmbeddingInput('Cozy Cabin', 'A nice cabin.', attrs);

    expect(result).toBe(
      [
        'Title: Cozy Cabin',
        'Description: A nice cabin.',
        'Property type: cabin',
        'Pet friendly: unknown',
        'View: none mentioned',
        'Amenities: none listed',
        'Bedrooms mentioned: not specified',
      ].join('\n'),
    );
  });

  it('formats populated pet_friendly/view/amenities/bedrooms fields', () => {
    const attrs: ExtractedAttributes = {
      property_type: 'condo',
      pet_friendly: true,
      view_type: 'ocean view',
      amenities: ['pool', 'gym'],
      bedrooms_mentioned: 3,
    };

    const result = buildEmbeddingInput('Beach Condo', 'Steps from the beach.', attrs);

    expect(result).toContain('Pet friendly: yes');
    expect(result).toContain('View: ocean view');
    expect(result).toContain('Amenities: pool, gym');
    expect(result).toContain('Bedrooms mentioned: 3');
  });

  it('formats pet_friendly: false distinctly from null', () => {
    const attrs: ExtractedAttributes = {
      property_type: 'house',
      pet_friendly: false,
      view_type: null,
      amenities: [],
      bedrooms_mentioned: null,
    };

    const result = buildEmbeddingInput('No Pets House', 'No pets allowed.', attrs);
    expect(result).toContain('Pet friendly: no');
  });
});

describe('generateEmbedding', () => {
  const originalFetch = global.fetch;
  const originalRateLimitEnv = process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE;

  beforeEach(() => {
    // A high limit so these tests aren't slowed by the real 3/minute default
    // spacing; the dedicated 'rate limiting' block below tests that spacing.
    process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE = '1000000';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE = originalRateLimitEnv;
    vi.restoreAllMocks();
  });

  it('returns the embedding vector on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: new Array(1024).fill(0.1) }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const embedding = await generateEmbedding('some text');

    expect(embedding).toHaveLength(1024);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends model=voyage-4, output_dimension=1024, input_type=document', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 2, 3] }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await generateEmbedding('some text');

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({
      model: 'voyage-4',
      input: ['some text'],
      output_dimension: 1024,
      input_type: 'document',
    });
  });

  it('retries once on a 500 and succeeds on the second attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: [1, 2, 3] }] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const embedding = await generateEmbedding('some text');

    expect(embedding).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a typed EmbeddingError after two failed attempts on transient errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(generateEmbedding('some text')).rejects.toBeInstanceOf(EmbeddingError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a non-transient 4xx error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(generateEmbedding('some text')).rejects.toBeInstanceOf(EmbeddingError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('generateEmbedding rate limiting', () => {
  const originalFetch = global.fetch;
  const originalRateLimitEnv = process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE = originalRateLimitEnv;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('serializes concurrent calls, spacing them 60s/limit apart', async () => {
    process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE = '3'; // 20s spacing
    vi.useFakeTimers();

    const callTimestamps: number[] = [];
    const fetchMock = vi.fn().mockImplementation(async () => {
      callTimestamps.push(Date.now());
      return { ok: true, json: async () => ({ data: [{ embedding: [1, 2, 3] }] }) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const calls = Promise.all([generateEmbedding('a'), generateEmbedding('b'), generateEmbedding('c')]);
    await vi.runAllTimersAsync();
    await calls;

    expect(callTimestamps).toHaveLength(3);
    expect(callTimestamps[1]! - callTimestamps[0]!).toBeGreaterThanOrEqual(20_000);
    expect(callTimestamps[2]! - callTimestamps[1]!).toBeGreaterThanOrEqual(20_000);
  });
});
