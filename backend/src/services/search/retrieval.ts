import type pg from 'pg';
import type { ExtractedAttributes } from '../ingestion/extraction.js';
import { generateEmbedding } from '../ingestion/embeddings.js';
import type { QueryIntent } from './queryUnderstanding.js';

export type Listing = {
  id: string;
  title: string;
  raw_description: string;
  price_per_night: number | null;
  bedrooms: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  extracted_attributes: ExtractedAttributes | null;
  ingestion_status: string;
};

export type RankedCandidate = Listing & { similarityScore: number };

export type RetrievalResult = {
  candidates: RankedCandidate[];
  filtersRelaxed: boolean;
};

/**
 * Below this many filtered results, we assume the structured filters were too narrow
 * and fall back to semantic-only ranking rather than surfacing a near-empty candidate
 * set (spec 05, confirmed threshold — kept as a named constant, not a magic number).
 */
export const MIN_CANDIDATES_BEFORE_RELAXATION = 5;
export const MAX_CANDIDATES = 30;

const CANDIDATE_COLUMNS = `id, title, raw_description, price_per_night, bedrooms, location, latitude, longitude,
       extracted_attributes, ingestion_status`;

type CandidateRow = Listing & { similarity_score: number | string };

function buildFilterClauses(filters: QueryIntent['filters']): { clauses: string[]; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];

  // $1 is always the query embedding literal, so filter placeholders start at $2.
  let nextParam = 2;

  if (filters.pet_friendly !== null) {
    clauses.push(`(extracted_attributes->>'pet_friendly')::boolean = $${nextParam}`);
    values.push(filters.pet_friendly);
    nextParam += 1;
  }
  if (filters.property_type !== null) {
    // Case-insensitive exact match, not substring: property_type is a real hard filter
    // (CLAUDE.md rule #2), so a near-synonym like "log cabin" vs. "cabin" should NOT
    // silently match here. That nuance instead lives in semantic_query for ranking, and
    // a genuinely over-narrow filter is caught by the relaxation fallback below.
    clauses.push(`extracted_attributes->>'property_type' ILIKE $${nextParam}`);
    values.push(filters.property_type);
    nextParam += 1;
  }
  if (filters.min_bedrooms !== null) {
    // Structured `bedrooms` column, not extracted_attributes.bedrooms_mentioned — the
    // latter means "the listing text itself states a count," a different fact.
    clauses.push(`bedrooms >= $${nextParam}`);
    values.push(filters.min_bedrooms);
    nextParam += 1;
  }
  if (filters.max_price !== null) {
    clauses.push(`price_per_night <= $${nextParam}`);
    values.push(filters.max_price);
    nextParam += 1;
  }

  return { clauses, values };
}

async function runCandidateQuery(
  pool: pg.Pool,
  embeddingLiteral: string,
  extraClauses: string[],
  extraValues: unknown[],
): Promise<CandidateRow[]> {
  const whereClauses = [`ingestion_status = 'processed'`, ...extraClauses];

  const query = `
    SELECT ${CANDIDATE_COLUMNS},
           1 - (embedding <=> $1::vector) AS similarity_score
    FROM listings
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY embedding <=> $1::vector
    LIMIT ${MAX_CANDIDATES}
  `;

  const { rows } = await pool.query<CandidateRow>(query, [embeddingLiteral, ...extraValues]);
  return rows;
}

function toRankedCandidate(row: CandidateRow): RankedCandidate {
  const { similarity_score, ...listing } = row;
  return { ...listing, similarityScore: Number(similarity_score) };
}

/**
 * Hybrid retrieval (spec 05): structured filters are applied as real SQL WHERE clauses
 * (CLAUDE.md rule #2 — never left to embedding similarity alone), then remaining rows are
 * ranked by pgvector cosine distance against the query embedding. `pool` is accepted
 * explicitly (rather than the literal single-arg spec signature) so this can be exercised
 * against `getTestDatabaseUrl()` in tests, matching every other DB-touching service in
 * this codebase (`runIngestion(pool)`, `seedDatabase(pool, listings)`).
 */
export async function retrieveCandidates(pool: pg.Pool, intent: QueryIntent): Promise<RetrievalResult> {
  const embedding = await generateEmbedding(intent.semantic_query, 'query');
  const embeddingLiteral = `[${embedding.join(',')}]`;

  const { clauses, values } = buildFilterClauses(intent.filters);
  const hasFilters = clauses.length > 0;

  const filteredRows = await runCandidateQuery(pool, embeddingLiteral, clauses, values);

  if (hasFilters && filteredRows.length < MIN_CANDIDATES_BEFORE_RELAXATION) {
    const relaxedRows = await runCandidateQuery(pool, embeddingLiteral, [], []);
    return { candidates: relaxedRows.map(toRankedCandidate), filtersRelaxed: true };
  }

  return { candidates: filteredRows.map(toRankedCandidate), filtersRelaxed: false };
}
