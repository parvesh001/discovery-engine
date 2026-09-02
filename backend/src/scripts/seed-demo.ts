import type pg from 'pg';
import { loadEnv, type Env } from '../env.js';
import { createPool } from '../db.js';
import { demoListings } from './seed-demo-data.js';
import type { DemoSeedListing } from './seedTypes.js';

// Structural twin of `seed.ts`, but for the deployed demo catalogue (spec 12, Phase 11):
// 9 columns per row instead of 7 — `destination` and an explicit `created_at` are the
// extras — so it keeps its own insert builder rather than parameterising `seed.ts` (whose
// tests pin the 7-column shape). Like `seed`, this TRUNCATEs `listings` first and has NO
// guard against running against a populated database — that interlock is a tracked future
// enhancement (specs/00-architecture.md); DEPLOYMENT.md §4 carries the loud manual warning.
const COLUMNS_PER_ROW = 9;

// Semantic fiction, on purpose (spec 12, "Revised During Implementation"): every demo row
// is really created in one bulk INSERT at the same instant, but the browse endpoint orders
// by `created_at ASC, id ASC` and we want that to be the *curated* order — `manaliListings`
// then `goaListings`, each in `seed-demo-data.ts` file order. So we fabricate a
// strictly-increasing `created_at` (1 second apart, from a fixed base) that encodes the
// array index. `created_at` here means "curated display position", not "when the row was
// written". Nothing else in the system reads `created_at` for the demo dataset. To reorder
// the browse list, reorder the arrays in `seed-demo-data.ts` and re-seed.
const CREATED_AT_BASE_MS = Date.parse('2020-01-01T00:00:00.000Z');
const CREATED_AT_STEP_MS = 1000;

function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export function buildDemoInsertQuery(listings: DemoSeedListing[]): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const rows = listings.map((listing, index) => {
    const offset = index * COLUMNS_PER_ROW;
    values.push(
      listing.title,
      listing.rawDescription,
      listing.pricePerNight,
      listing.bedrooms,
      listing.location,
      listing.latitude,
      listing.longitude,
      listing.destination,
      new Date(CREATED_AT_BASE_MS + index * CREATED_AT_STEP_MS),
    );
    const placeholders = Array.from({ length: COLUMNS_PER_ROW }, (_, i) => `$${offset + i + 1}`);
    return `(${placeholders.join(', ')})`;
  });

  const text = `
    INSERT INTO listings (title, raw_description, price_per_night, bedrooms, location, latitude, longitude, destination, created_at)
    VALUES ${rows.join(', ')}
  `;

  return { text, values };
}

export async function seedDemoDatabase(
  pool: pg.Pool,
  listings: DemoSeedListing[] = demoListings,
): Promise<number> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE listings CASCADE');

    const { text, values } = buildDemoInsertQuery(listings);
    await client.query(text, values);

    await client.query('COMMIT');
    return listings.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  await import('dotenv/config');
  const env = loadEnvOrExit();
  const pool = createPool(env.DATABASE_URL);

  try {
    const count = await seedDemoDatabase(pool);
    console.log(`Seeded ${count} demo listings (${demoListings.filter((l) => l.destination === 'manali').length} manali, ${demoListings.filter((l) => l.destination === 'goa').length} goa).`);
  } catch (error) {
    console.error('Demo seed failed, rolled back:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
