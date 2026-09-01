import type pg from 'pg';
import { loadEnv, type Env } from '../env.js';
import { createPool } from '../db.js';
import { demoListings } from './seed-demo-data.js';
import type { DemoSeedListing } from './seedTypes.js';

// Structural twin of `seed.ts`, but for the deployed demo catalogue (spec 12, Phase 11):
// 8 columns per row instead of 7 — `destination` is the extra one — so it keeps its own
// insert builder rather than parameterising `seed.ts` (whose tests pin the 7-column
// shape). Like `seed`, this TRUNCATEs `listings` first and has NO guard against running
// against a populated database — that interlock is a tracked future enhancement
// (specs/00-architecture.md); DEPLOYMENT.md §4 carries the loud manual warning.
const COLUMNS_PER_ROW = 8;

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
    );
    const placeholders = Array.from({ length: COLUMNS_PER_ROW }, (_, i) => `$${offset + i + 1}`);
    return `(${placeholders.join(', ')})`;
  });

  const text = `
    INSERT INTO listings (title, raw_description, price_per_night, bedrooms, location, latitude, longitude, destination)
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
