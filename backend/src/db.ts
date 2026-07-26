import pg from 'pg';

const { Pool, types } = pg;

// Postgres OID for NUMERIC/DECIMAL columns (price_per_night, latitude, longitude on
// `listings` — see migrations/1784285145000_create-listings.sql). node-pg returns these
// as strings by default, to avoid silently losing precision on arbitrary-precision
// decimals — but this project's `Listing` type (services/search/retrieval.ts) declares
// them as `number`, and every consumer (rerank's document builder, the frontend's price
// rendering) is written against that declared type, not the actual wire value. Confirmed
// against the real running backend: a real query returned `"price_per_night": "4500"`,
// a string, despite the type declaration.
const NUMERIC_OID = 1700;

/**
 * `pg.types.setTypeParser` mutates parser state shared by the whole `pg` module within
 * a process, so registering it once here (called from this module and from
 * `test/testDb.ts`, since integration tests build pools directly rather than through
 * `createPool`) makes every Pool/Client created afterward — prod and test alike — return
 * a real number for these columns, matching the declared type instead of leaving each
 * consumer to rediscover and work around the mismatch itself.
 */
export function registerNumericTypeParser(): void {
  types.setTypeParser(NUMERIC_OID, (value) => (value === null ? null : parseFloat(value)));
}

registerNumericTypeParser();

export function createPool(connectionString: string): pg.Pool {
  return new Pool({ connectionString });
}

export async function checkConnection(pool: pg.Pool): Promise<void> {
  await pool.query('SELECT 1');
}
