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

import { ingestListing } from './runIngestion.js';

const validAttributes = {
  property_type: 'cabin',
  pet_friendly: null,
  view_type: null,
  amenities: [],
  bedrooms_mentioned: null,
};

// ingestListing (spec 10) is the single-listing worker logic BullMQ's Worker (worker.ts)
// now dispatches jobs to, replacing the old synchronous batch runIngestion(). Batch-level
// concerns — which rows count as "pending", not re-selecting already-processed listings —
// moved to queue.test.ts's coverage of enqueuePendingListings, since ingestListing itself
// never selects rows; it's handed one listing per call.
describe('ingestListing', () => {
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

  it('processes a listing and writes attributes, embedding, and processed status', async () => {
    const listingId = await insertListing('Test Listing', 'A nice cabin.');
    extractAttributesMock.mockResolvedValue(validExtractionResult);
    generateEmbeddingMock.mockResolvedValue({ embedding: new Array(1024).fill(0.1), tokens: 42 });

    const outcome = await ingestListing(pool, { id: listingId, title: 'Test Listing', raw_description: 'A nice cabin.' });

    expect(outcome).toBe('processed');

    const { rows } = await pool.query(
      `SELECT ingestion_status, extracted_attributes, embedding, ingested_at FROM listings WHERE id = $1`,
      [listingId],
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

    await ingestListing(pool, { id: listingId, title: 'Test Listing', raw_description: 'A nice cabin.' });

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

  it('does not write an ingestion_logs row, and marks the listing failed, when extraction fails', async () => {
    const listingId = await insertListing('Malformed', '');
    extractAttributesMock.mockRejectedValue(new Error('cannot extract from empty description'));

    const outcome = await ingestListing(pool, { id: listingId, title: 'Malformed', raw_description: '' });

    expect(outcome).toBe('failed');

    const { rows: logRows } = await pool.query(`SELECT * FROM ingestion_logs`);
    expect(logRows).toHaveLength(0);

    const { rows: listingRows } = await pool.query(`SELECT ingestion_status FROM listings WHERE id = $1`, [listingId]);
    expect(listingRows[0].ingestion_status).toBe('failed');
  });

  it('processes listings independently — one failing does not affect another call for a different listing', async () => {
    const failingId = await insertListing('Malformed', '');
    const goodId = await insertListing('Good Listing', 'A nice place.');

    extractAttributesMock.mockImplementation(async (rawDescription: string) => {
      if (rawDescription === '') {
        throw new Error('cannot extract from empty description');
      }
      return validExtractionResult;
    });
    generateEmbeddingMock.mockResolvedValue({ embedding: new Array(1024).fill(0.1), tokens: 42 });

    const [failingOutcome, goodOutcome] = await Promise.all([
      ingestListing(pool, { id: failingId, title: 'Malformed', raw_description: '' }),
      ingestListing(pool, { id: goodId, title: 'Good Listing', raw_description: 'A nice place.' }),
    ]);

    expect(failingOutcome).toBe('failed');
    expect(goodOutcome).toBe('processed');

    const { rows } = await pool.query(`SELECT title, ingestion_status FROM listings ORDER BY title`);
    const statusByTitle = Object.fromEntries(rows.map((row) => [row.title, row.ingestion_status]));
    expect(statusByTitle['Good Listing']).toBe('processed');
    expect(statusByTitle['Malformed']).toBe('failed');
  });
});
