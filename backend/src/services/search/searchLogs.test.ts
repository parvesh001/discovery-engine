import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { getTestDatabaseUrl } from '../../test/testDb.js';
import { logSearch, type SearchLogEntry } from './searchLogs.js';

describe('logSearch', () => {
  const pool = new pg.Pool({ connectionString: getTestDatabaseUrl() });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE search_logs');
  });

  const sampleEntry: SearchLogEntry = {
    raw_query: 'pet friendly cabin under 5000',
    extracted_intent: {
      filters: { pet_friendly: true, property_type: 'cabin', min_bedrooms: null, max_price: 5000 },
      semantic_query: 'cabin',
    },
    candidate_ids: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
    ranked_ids: ['22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111'],
    latency_ms: 842,
    model_calls: {
      query_understanding: { model: 'claude-haiku-4-5-20251001', succeeded: true },
      embedding: { model: 'voyage-4' },
      rerank: { model: 'rerank-2.5', degraded: false },
    },
  };

  it('inserts a row whose columns match the entry passed in', async () => {
    await logSearch(pool, sampleEntry);

    const { rows } = await pool.query('SELECT * FROM search_logs');
    expect(rows).toHaveLength(1);
    const row = rows[0];

    expect(row.raw_query).toBe(sampleEntry.raw_query);
    expect(row.extracted_intent).toEqual(sampleEntry.extracted_intent);
    expect(row.candidate_ids).toEqual(sampleEntry.candidate_ids);
    expect(row.ranked_ids).toEqual(sampleEntry.ranked_ids);
    expect(row.latency_ms).toBe(sampleEntry.latency_ms);
    expect(row.model_calls).toEqual(sampleEntry.model_calls);
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it('stores a failure entry with empty candidate/ranked arrays and a failure marker', async () => {
    const failureEntry: SearchLogEntry = {
      raw_query: 'somewhere quiet',
      extracted_intent: {
        filters: { pet_friendly: null, property_type: null, min_bedrooms: null, max_price: null },
        semantic_query: 'somewhere quiet',
      },
      candidate_ids: [],
      ranked_ids: [],
      latency_ms: 120,
      model_calls: {
        query_understanding: { model: 'claude-haiku-4-5-20251001', succeeded: true },
        embedding: null,
        rerank: null,
        failure: { stage: 'retrieval', error: true },
      },
    };

    await logSearch(pool, failureEntry);

    const { rows } = await pool.query('SELECT * FROM search_logs');
    expect(rows).toHaveLength(1);
    expect(rows[0].candidate_ids).toEqual([]);
    expect(rows[0].model_calls).toEqual(failureEntry.model_calls);
  });

  it('never rejects, even when the insert fails — logs the error and resolves', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const brokenPool = { query: vi.fn().mockRejectedValue(new Error('connection lost')) } as unknown as pg.Pool;

    await expect(logSearch(brokenPool, sampleEntry)).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith('[search] failed to write search_logs entry:', expect.any(Error));

    consoleErrorSpy.mockRestore();
  });
});
