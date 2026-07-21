import type pg from 'pg';
import { loadEnv, type Env } from '../env.js';
import { createPool } from '../db.js';
import { seedListings, type SeedListing } from './seed-data.js';

const COLUMNS_PER_ROW = 7;

function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export function buildInsertQuery(listings: SeedListing[]): { text: string; values: unknown[] } {
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
    );
    const placeholders = Array.from({ length: COLUMNS_PER_ROW }, (_, i) => `$${offset + i + 1}`);
    return `(${placeholders.join(', ')})`;
  });

  const text = `
    INSERT INTO listings (title, raw_description, price_per_night, bedrooms, location, latitude, longitude)
    VALUES ${rows.join(', ')}
  `;

  return { text, values };
}

export async function seedDatabase(pool: pg.Pool, listings: SeedListing[] = seedListings): Promise<number> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE listings');

    const { text, values } = buildInsertQuery(listings);
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
    const count = await seedDatabase(pool);
    console.log(`Seeded ${count} listings.`);
  } catch (error) {
    console.error('Seed failed, rolled back:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
