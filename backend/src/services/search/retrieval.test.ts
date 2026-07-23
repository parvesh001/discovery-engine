import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { getTestDatabaseUrl } from '../../test/testDb.js';
import type { ExtractedAttributes } from '../ingestion/extraction.js';
import type { QueryIntent } from './queryUnderstanding.js';

const generateEmbeddingMock = vi.fn();
vi.mock('../ingestion/embeddings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ingestion/embeddings.js')>();
  return {
    ...actual,
    generateEmbedding: (...args: unknown[]) => generateEmbeddingMock(...args),
  };
});

import { retrieveCandidates, MIN_CANDIDATES_BEFORE_RELAXATION } from './retrieval.js';

const EMBEDDING_DIMENSION = 1024;

// A one-hot vector at `dim` has cosine similarity 1 with another one-hot at the same
// dim, 0 with a one-hot at a different dim, and -1 with its negation — giving fully
// deterministic, hand-verifiable cosine distances for ordering assertions.
function oneHot(dim: number, value = 1): number[] {
  const vector = new Array(EMBEDDING_DIMENSION).fill(0);
  vector[dim] = value;
  return vector;
}

const baseAttributes: ExtractedAttributes = {
  property_type: 'cabin',
  pet_friendly: true,
  view_type: null,
  amenities: [],
  bedrooms_mentioned: null,
};

const emptyFilters: QueryIntent['filters'] = {
  pet_friendly: null,
  property_type: null,
  min_bedrooms: null,
  max_price: null,
};

describe('retrieveCandidates', () => {
  const pool = new pg.Pool({ connectionString: getTestDatabaseUrl() });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE listings');
    generateEmbeddingMock.mockReset();
    generateEmbeddingMock.mockResolvedValue(oneHot(0));
  });

  async function insertListing(overrides: {
    title: string;
    price_per_night?: number;
    bedrooms?: number;
    extracted_attributes?: ExtractedAttributes;
    embedding?: number[] | null;
    ingestion_status?: string;
  }): Promise<void> {
    const row = {
      price_per_night: 100,
      bedrooms: 1,
      extracted_attributes: baseAttributes,
      embedding: oneHot(0) as number[] | null,
      ingestion_status: 'processed',
      ...overrides,
    };
    const embeddingLiteral = row.embedding ? `[${row.embedding.join(',')}]` : null;

    await pool.query(
      `INSERT INTO listings (title, raw_description, price_per_night, bedrooms, location, latitude, longitude,
                              extracted_attributes, embedding, ingestion_status)
       VALUES ($1, 'A test listing description.', $2, $3, 'Test, CO', 0, 0, $4, $5::vector, $6)`,
      [
        row.title,
        row.price_per_night,
        row.bedrooms,
        JSON.stringify(row.extracted_attributes),
        embeddingLiteral,
        row.ingestion_status,
      ],
    );
  }

  it('embeds the query with input_type "query", not "document"', async () => {
    await insertListing({ title: 'Any Listing' });

    await retrieveCandidates(pool, { filters: emptyFilters, semantic_query: 'a cozy cabin' });

    expect(generateEmbeddingMock).toHaveBeenCalledWith('a cozy cabin', 'query');
  });

  it('never returns a listing where extracted_attributes.pet_friendly = false when the filter is true', async () => {
    for (let i = 0; i < 5; i += 1) {
      await insertListing({
        title: `Pet Friendly ${i}`,
        extracted_attributes: { ...baseAttributes, pet_friendly: true },
      });
    }
    await insertListing({
      title: 'No Pets Allowed',
      extracted_attributes: { ...baseAttributes, pet_friendly: false },
    });

    const result = await retrieveCandidates(pool, {
      filters: { ...emptyFilters, pet_friendly: true },
      semantic_query: 'a place to stay',
    });

    expect(result.filtersRelaxed).toBe(false);
    expect(result.candidates).toHaveLength(5);
    expect(result.candidates.every((c) => c.extracted_attributes?.pet_friendly === true)).toBe(true);
    expect(result.candidates.some((c) => c.title === 'No Pets Allowed')).toBe(false);
  });

  it('excludes a listing whose pet policy is null/ambiguous when filtering for pet_friendly = true', async () => {
    for (let i = 0; i < 5; i += 1) {
      await insertListing({
        title: `Pet Friendly ${i}`,
        extracted_attributes: { ...baseAttributes, pet_friendly: true },
      });
    }
    await insertListing({
      title: 'Ambiguous Pet Policy',
      extracted_attributes: { ...baseAttributes, pet_friendly: null },
    });

    const result = await retrieveCandidates(pool, {
      filters: { ...emptyFilters, pet_friendly: true },
      semantic_query: 'a place to stay',
    });

    expect(result.candidates.some((c) => c.title === 'Ambiguous Pet Policy')).toBe(false);
  });

  it('matches property_type case-insensitively but requires an exact match, not a substring', async () => {
    for (let i = 0; i < 5; i += 1) {
      await insertListing({
        title: `Cabin ${i}`,
        extracted_attributes: { ...baseAttributes, property_type: i % 2 === 0 ? 'cabin' : 'Cabin' },
      });
    }
    await insertListing({
      title: 'Log Cabin Retreat',
      extracted_attributes: { ...baseAttributes, property_type: 'log cabin' },
    });

    const result = await retrieveCandidates(pool, {
      filters: { ...emptyFilters, property_type: 'cabin' },
      semantic_query: 'a place to stay',
    });

    expect(result.filtersRelaxed).toBe(false);
    expect(result.candidates).toHaveLength(5);
    expect(result.candidates.some((c) => c.title === 'Log Cabin Retreat')).toBe(false);
  });

  it('applies the structured bedrooms column for min_bedrooms, not extracted_attributes.bedrooms_mentioned', async () => {
    for (let i = 0; i < 5; i += 1) {
      await insertListing({
        title: `Big Place ${i}`,
        bedrooms: 3,
        extracted_attributes: { ...baseAttributes, bedrooms_mentioned: null },
      });
    }
    await insertListing({
      title: 'Studio With Bedrooms Mentioned In Text',
      bedrooms: 0,
      extracted_attributes: { ...baseAttributes, bedrooms_mentioned: 3 },
    });

    const result = await retrieveCandidates(pool, {
      filters: { ...emptyFilters, min_bedrooms: 2 },
      semantic_query: 'a place to stay',
    });

    expect(result.candidates.some((c) => c.title === 'Studio With Bedrooms Mentioned In Text')).toBe(false);
  });

  it('applies max_price against price_per_night', async () => {
    for (let i = 0; i < 5; i += 1) {
      await insertListing({ title: `Cheap ${i}`, price_per_night: 50 });
    }
    await insertListing({ title: 'Expensive Place', price_per_night: 500 });

    const result = await retrieveCandidates(pool, {
      filters: { ...emptyFilters, max_price: 100 },
      semantic_query: 'a place to stay',
    });

    expect(result.candidates.some((c) => c.title === 'Expensive Place')).toBe(false);
  });

  it('with no filters, returns results ordered purely by cosine similarity', async () => {
    await insertListing({ title: 'Identical', embedding: oneHot(0) });
    await insertListing({ title: 'Orthogonal', embedding: oneHot(1) });
    await insertListing({ title: 'Opposite', embedding: oneHot(0, -1) });

    generateEmbeddingMock.mockResolvedValue(oneHot(0));

    const result = await retrieveCandidates(pool, { filters: emptyFilters, semantic_query: 'anything' });

    expect(result.filtersRelaxed).toBe(false);
    expect(result.candidates.map((c) => c.title)).toEqual(['Identical', 'Orthogonal', 'Opposite']);
    expect(result.candidates[0]?.similarityScore).toBeCloseTo(1);
    expect(result.candidates[1]?.similarityScore).toBeCloseTo(0);
    expect(result.candidates[2]?.similarityScore).toBeCloseTo(-1);
  });

  it('relaxes an over-narrow filter combination that matches zero listings, and reports filtersRelaxed: true', async () => {
    await insertListing({ title: 'Only Listing A', bedrooms: 1 });
    await insertListing({ title: 'Only Listing B', bedrooms: 1 });

    const result = await retrieveCandidates(pool, {
      filters: { ...emptyFilters, min_bedrooms: 99 },
      semantic_query: 'a place to stay',
    });

    expect(result.filtersRelaxed).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.map((c) => c.title).sort()).toEqual(['Only Listing A', 'Only Listing B']);
  });

  it(`does not relax when filtered results meet the ${MIN_CANDIDATES_BEFORE_RELAXATION}-result threshold`, async () => {
    for (let i = 0; i < MIN_CANDIDATES_BEFORE_RELAXATION; i += 1) {
      await insertListing({ title: `Match ${i}`, bedrooms: 3 });
    }

    const result = await retrieveCandidates(pool, {
      filters: { ...emptyFilters, min_bedrooms: 2 },
      semantic_query: 'a place to stay',
    });

    expect(result.filtersRelaxed).toBe(false);
    expect(result.candidates).toHaveLength(MIN_CANDIDATES_BEFORE_RELAXATION);
  });

  it('never returns a listing whose ingestion_status is not "processed", filtered or relaxed', async () => {
    await insertListing({ title: 'Processed', ingestion_status: 'processed' });
    await insertListing({
      title: 'Still Pending',
      ingestion_status: 'pending',
      embedding: null,
    });

    const result = await retrieveCandidates(pool, {
      filters: { ...emptyFilters, min_bedrooms: 99 }, // forces relaxation
      semantic_query: 'a place to stay',
    });

    expect(result.filtersRelaxed).toBe(true);
    expect(result.candidates.map((c) => c.title)).toEqual(['Processed']);
  });
});
