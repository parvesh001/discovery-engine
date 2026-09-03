import type pg from 'pg';
import { MAX_CANDIDATES, type Listing } from './retrieval.js';

const CANDIDATE_COLUMNS = `id, title, raw_description, price_per_night, bedrooms, location, latitude, longitude,
       extracted_attributes, ingestion_status`;

/**
 * Escapes ILIKE wildcard metacharacters in user input before it's embedded in a `%...%`
 * pattern. The value itself is still bound as a query parameter (no SQL injection risk
 * either way) — this only stops `%`/`_` in the query text from being interpreted as
 * wildcards instead of literal characters, e.g. a query of "50%" matching unrelated rows.
 */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Trivial ILIKE-only comparison baseline (spec 08) — no embeddings, no LLM, no ranking.
 * Exists solely so the UI can show naive vs. AI pipeline results side by side.
 *
 * `destinationScope` (spec 12): when set, ANDed in as a real SQL WHERE clause so the naive
 * column is scoped to the same destination as the AI column for a fair comparison.
 */
export async function naiveSearchListings(
  pool: pg.Pool,
  query: string,
  destinationScope?: string,
): Promise<Listing[]> {
  const pattern = `%${escapeLikePattern(query)}%`;
  const params: unknown[] = [pattern];

  let destinationClause = '';
  if (destinationScope !== undefined) {
    params.push(destinationScope);
    destinationClause = `AND destination = $${params.length}`;
  }

  const { rows } = await pool.query<Listing>(
    `
    SELECT ${CANDIDATE_COLUMNS}
    FROM listings
    WHERE ingestion_status = 'processed'
      AND (title ILIKE $1 ESCAPE '\\' OR raw_description ILIKE $1 ESCAPE '\\')
      ${destinationClause}
    ORDER BY title ASC
    LIMIT ${MAX_CANDIDATES}
    `,
    params,
  );

  return rows;
}
