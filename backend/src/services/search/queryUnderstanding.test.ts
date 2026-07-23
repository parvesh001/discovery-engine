import { beforeEach, describe, expect, it, vi } from 'vitest';
import { understandQuery, QueryUnderstandingError } from './queryUnderstanding.js';

const callClaudeMock = vi.fn();
vi.mock('../llm/client.js', () => ({
  callClaude: (...args: unknown[]) => callClaudeMock(...args),
}));

// These tests exercise the validation/retry plumbing (schema conformance, retry-once,
// give-up-after-two-attempts) with a mocked callClaude. Whether the model itself makes the
// right judgment call on a real query (e.g. never populating max_price for "cheap") is a
// prompt-behavior question a mock can't verify — that's covered by manually reviewing
// scripts/testQueryUnderstanding.ts output against real Claude calls, not here.
describe('understandQuery', () => {
  beforeEach(() => {
    callClaudeMock.mockReset();
  });

  it('returns parsed intent on a valid first response', async () => {
    callClaudeMock.mockResolvedValueOnce(
      JSON.stringify({
        filters: { pet_friendly: true, property_type: 'cabin', min_bedrooms: null, max_price: null },
        semantic_query: 'cabin with a mountain view',
      }),
    );

    const result = await understandQuery('pet friendly cabin with mountain view');

    expect(result).toEqual({
      filters: { pet_friendly: true, property_type: 'cabin', min_bedrooms: null, max_price: null },
      semantic_query: 'cabin with a mountain view',
    });
    expect(callClaudeMock).toHaveBeenCalledTimes(1);
  });

  it('strips markdown code fences before parsing', async () => {
    callClaudeMock.mockResolvedValueOnce(
      '```json\n' +
        JSON.stringify({
          filters: { pet_friendly: null, property_type: null, min_bedrooms: null, max_price: null },
          semantic_query: 'somewhere cozy and quiet for a weekend',
        }) +
        '\n```',
    );

    const result = await understandQuery('somewhere cozy and quiet for a weekend');
    expect(result.semantic_query).toBe('somewhere cozy and quiet for a weekend');
  });

  it('retries once with an error-correction prompt on malformed JSON, then succeeds', async () => {
    callClaudeMock.mockResolvedValueOnce('not json');
    callClaudeMock.mockResolvedValueOnce(
      JSON.stringify({
        filters: { pet_friendly: null, property_type: 'studio', min_bedrooms: null, max_price: null },
        semantic_query: 'cheap studio near the beach',
      }),
    );

    const result = await understandQuery('cheap studio near the beach');

    expect(result.filters.property_type).toBe('studio');
    expect(result.filters.max_price).toBeNull();
    expect(callClaudeMock).toHaveBeenCalledTimes(2);

    const secondCallArgs = callClaudeMock.mock.calls[1]?.[0];
    expect(JSON.stringify(secondCallArgs)).toContain('not json');
  });

  it('throws a typed QueryUnderstandingError after two failed attempts, without fabricating a default', async () => {
    callClaudeMock.mockResolvedValueOnce('not json');
    callClaudeMock.mockResolvedValueOnce('still not json');

    await expect(understandQuery('malformed input')).rejects.toBeInstanceOf(QueryUnderstandingError);
    expect(callClaudeMock).toHaveBeenCalledTimes(2);
  });

  it('throws a typed QueryUnderstandingError when the schema validates but a required field is missing', async () => {
    callClaudeMock.mockResolvedValueOnce(JSON.stringify({ filters: {} }));
    callClaudeMock.mockResolvedValueOnce(JSON.stringify({ filters: {} }));

    await expect(understandQuery('some query')).rejects.toBeInstanceOf(QueryUnderstandingError);
  });

  it('rejects a max_price that is not a number, even if the rest of the shape is valid', async () => {
    callClaudeMock.mockResolvedValueOnce(
      JSON.stringify({
        filters: { pet_friendly: null, property_type: null, min_bedrooms: null, max_price: 'cheap' },
        semantic_query: 'cheap studio near the beach',
      }),
    );
    callClaudeMock.mockResolvedValueOnce(
      JSON.stringify({
        filters: { pet_friendly: null, property_type: 'studio', min_bedrooms: null, max_price: null },
        semantic_query: 'cheap studio near the beach',
      }),
    );

    const result = await understandQuery('cheap studio near the beach');
    expect(result.filters.max_price).toBeNull();
    expect(callClaudeMock).toHaveBeenCalledTimes(2);
  });
});
