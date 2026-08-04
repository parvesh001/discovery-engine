import type pg from 'pg';
import type { ExtractedAttributes } from '../ingestion/extraction.js';
import { generateEmbedding } from '../ingestion/embeddings.js';
import type { QueryIntent } from './queryUnderstanding.js';
import type { LangfuseParent } from '../observability/langfuse.js';

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
  embeddingTokens: number | null;
};

/**
 * Below this many filtered results, we assume the filters were too narrow and fall back
 * to a relaxed query rather than surfacing a near-empty candidate set (spec 05, confirmed
 * threshold — kept as a named constant, not a magic number). Relaxation only ever drops
 * the *soft* tier below, never the hard one — see the amendment in spec 05 and the
 * hard/soft comments on `buildFilterClauses`.
 */
export const MIN_CANDIDATES_BEFORE_RELAXATION = 5;
export const MAX_CANDIDATES = 30;

const CANDIDATE_COLUMNS = `id, title, raw_description, price_per_night, bedrooms, location, latitude, longitude,
       extracted_attributes, ingestion_status`;

type CandidateRow = Listing & { similarity_score: number | string };

/**
 * Two-tier filters (spec 05 amendment). Hard fields encode a stated eligibility
 * requirement — `queryUnderstanding.ts` only ever populates them from an explicit,
 * unambiguous statement in the query (a number, a boolean pet requirement), never
 * inferred from soft language — so a listing that fails one is a listing the user
 * literally cannot use. They are applied unconditionally and are NEVER dropped by
 * relaxation, even if that leaves the result set thin or empty. Soft fields are
 * label/category matches prone to extraction-vocabulary mismatch (a property-type
 * noun-phrase, a place-name substring) rather than stated requirements, so relaxing them
 * recovers from a wording/data problem instead of ignoring what the user asked for —
 * `includeSoft` controls whether they're included in a given query.
 */
function buildFilterClauses(
  filters: QueryIntent['filters'],
  opts: { includeSoft: boolean },
): { clauses: string[]; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];

  // $1 is always the query embedding literal, so filter placeholders start at $2.
  let nextParam = 2;

  // --- Hard tier: stated eligibility constraints, always applied, never relaxed. ---
  if (filters.pet_friendly !== null) {
    clauses.push(`(extracted_attributes->>'pet_friendly')::boolean = $${nextParam}`);
    values.push(filters.pet_friendly);
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

  // --- Soft tier: label/vocabulary matches, only applied when includeSoft, droppable. ---
  if (opts.includeSoft) {
    if (filters.property_type !== null) {
      // Case-insensitive exact match, not substring: a near-synonym like "log cabin" vs.
      // "cabin" should NOT silently match here. That nuance instead lives in
      // semantic_query for ranking, and a genuinely over-narrow filter is caught by the
      // relaxation fallback below.
      clauses.push(`extracted_attributes->>'property_type' ILIKE $${nextParam}`);
      values.push(filters.property_type);
      nextParam += 1;
    }
    if (filters.location !== null) {
      // Substring match, deliberately unlike property_type's exact match: the `location`
      // column stores full "City, State" strings (e.g. "Manali, Himachal Pradesh"), while
      // an extracted filter is typically just the place name as the query named it (e.g.
      // "Manali") — an exact match would fail every real case. This is a different data
      // shape requiring a different match strategy, not an inconsistency with
      // property_type.
      clauses.push(`location ILIKE '%' || $${nextParam} || '%'`);
      values.push(filters.location);
      nextParam += 1;
    }
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
export async function retrieveCandidates(
  pool: pg.Pool,
  intent: QueryIntent,
  langfuseParent?: LangfuseParent | null,
): Promise<RetrievalResult> {
  const { embedding, tokens: embeddingTokens } = await generateEmbedding(
    intent.semantic_query,
    'query',
    undefined,
    langfuseParent,
  );
  const embeddingLiteral = `[${embedding.join(',')}]`;

  const { clauses, values } = buildFilterClauses(intent.filters, { includeSoft: true });
  const hasSoftFilters = intent.filters.property_type !== null || intent.filters.location !== null;

  const fullyFilteredRows = await runCandidateQuery(pool, embeddingLiteral, clauses, values);

  // Relaxation only fires when there's a soft filter to drop, and only ever drops the
  // soft tier — hard constraints (pet_friendly, min_bedrooms, max_price) stay enforced in
  // SQL even if that leaves the result set thin or empty. No second-level relaxation: if
  // dropping soft filters still isn't enough, that thin/empty hard-filtered set is final.
  if (hasSoftFilters && fullyFilteredRows.length < MIN_CANDIDATES_BEFORE_RELAXATION) {
    const hardOnly = buildFilterClauses(intent.filters, { includeSoft: false });
    const hardOnlyRows = await runCandidateQuery(pool, embeddingLiteral, hardOnly.clauses, hardOnly.values);
    return { candidates: hardOnlyRows.map(toRankedCandidate), filtersRelaxed: true, embeddingTokens };
  }

  return { candidates: fullyFilteredRows.map(toRankedCandidate), filtersRelaxed: false, embeddingTokens };
}
