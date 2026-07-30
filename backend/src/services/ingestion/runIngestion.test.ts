import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { getTestDatabaseUrl } from '../../test/testDb.js';

const extractAttributesMock = vi.fn();
vi.mock('./extraction.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./extraction.js')>();
  return {
    ...actual,
    extractAttributes: (...args: unknown[]) => extractAttributesMock(...args),
  };
});

const generateEmbeddingMock = vi.fn();
vi.mock('./embeddings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./embeddings.js')>();
  return {
    ...actual,
    generateEmbedding: (...args: unknown[]) => generateEmbeddingMock(...args),
  };
});

import { runIngestion } from './runIngestion.js';

const validAttributes = {
  property_type: 'cabin',
  pet_friendly: null,
  view_type: null,
  amenities: [],
  bedrooms_mentioned: null,
};

describe('runIngestion', () => {
  const pool = new pg.Pool({ connectionString: getTestDatabaseUrl() });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE listings CASCADE');
    extractAttributesMock.mockReset();
    generateEmbeddingMock.mockReset();
  });

  async function insertListing(title: string, rawDescription: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO listings (title, raw_description) VALUES ($1, $2) RETURNING id`,
      [title, rawDescription],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('insert did not return a row');
    }
    return row.id;
  }

  const validExtractionResult = { attributes: validAttributes, usage: { inputTokens: 10, outputTokens: 5 } };

  it('processes pending listings and writes attributes, embedding, and processed status', async () => {
    await insertListing('Test Listing', 'A nice cabin.');
    extractAttributesMock.mockResolvedValue(validExtractionResult);
    generateEmbeddingMock.mockResolvedValue({ embedding: new Array(1024).fill(0.1), tokens: 42 });

    const summary = await runIngestion(pool);

    expect(summary).toEqual({ processed: 1, failed: 0, failedIds: [] });

    const { rows } = await pool.query(
      `SELECT ingestion_status, extracted_attributes, embedding, ingested_at FROM listings`,
    );
    expect(rows[0].ingestion_status).toBe('processed');
    expect(rows[0].extracted_attributes).toEqual(validAttributes);
    expect(rows[0].embedding).not.toBeNull();
    expect(rows[0].ingested_at).not.toBeNull();
  });

  it('writes one ingestion_logs row per successful ingestion, with observed token usage', async () => {
    const listingId = await insertListing('Test Listing', 'A nice cabin.');
    extractAttributesMock.mockResolvedValue(validExtractionResult);
    generateEmbeddingMock.mockResolvedValue({ embedding: new Array(1024).fill(0.1), tokens: 42 });

    await runIngestion(pool);

    const { rows } = await pool.query(
      `SELECT listing_id, extraction_model, extraction_input_tokens, extraction_output_tokens,
              embedding_model, embedding_tokens, latency_ms
       FROM ingestion_logs`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      listing_id: listingId,
      extraction_model: 'claude-haiku-4-5-20251001',
      extraction_input_tokens: 10,
      extraction_output_tokens: 5,
      embedding_model: 'voyage-4',
      embedding_tokens: 42,
    });
    expect(rows[0].latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('does not write an ingestion_logs row when a listing fails to ingest', async () => {
    await insertListing('Malformed', '');
    extractAttributesMock.mockRejectedValue(new Error('cannot extract from empty description'));

    await runIngestion(pool);

    const { rows } = await pool.query(`SELECT * FROM ingestion_logs`);
    expect(rows).toHaveLength(0);
  });

  it('marks a failing listing as failed without halting the rest of the batch', async () => {
    await insertListing('Malformed', '');
    await insertListing('Good Listing', 'A nice place.');

    extractAttributesMock.mockImplementation(async (rawDescription: string) => {
      if (rawDescription === '') {
        throw new Error('cannot extract from empty description');
      }
      return validExtractionResult;
    });
    generateEmbeddingMock.mockResolvedValue({ embedding: new Array(1024).fill(0.1), tokens: 42 });

    const summary = await runIngestion(pool);

    expect(summary.processed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.failedIds).toHaveLength(1);

    const { rows } = await pool.query(`SELECT title, ingestion_status FROM listings ORDER BY title`);
    const statusByTitle = Object.fromEntries(rows.map((row) => [row.title, row.ingestion_status]));
    expect(statusByTitle['Good Listing']).toBe('processed');
    expect(statusByTitle['Malformed']).toBe('failed');
  });

  it('is a no-op on a second run: zero additional extraction/embedding calls, zero additional writes', async () => {
    await insertListing('Test Listing', 'A nice cabin.');
    extractAttributesMock.mockResolvedValue(validExtractionResult);
    generateEmbeddingMock.mockResolvedValue({ embedding: new Array(1024).fill(0.1), tokens: 42 });

    const firstSummary = await runIngestion(pool);
    expect(firstSummary).toEqual({ processed: 1, failed: 0, failedIds: [] });
    expect(extractAttributesMock).toHaveBeenCalledTimes(1);
    expect(generateEmbeddingMock).toHaveBeenCalledTimes(1);

    const secondSummary = await runIngestion(pool);

    expect(secondSummary).toEqual({ processed: 0, failed: 0, failedIds: [] });
    expect(extractAttributesMock).toHaveBeenCalledTimes(1);
    expect(generateEmbeddingMock).toHaveBeenCalledTimes(1);
  });
});
