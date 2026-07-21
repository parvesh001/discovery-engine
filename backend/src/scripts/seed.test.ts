import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { seedDatabase } from './seed.js';
import { seedListings } from './seed-data.js';
import { getTestDatabaseUrl } from '../test/testDb.js';

describe('seedDatabase', () => {
  const pool = new pg.Pool({ connectionString: getTestDatabaseUrl() });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE listings');
  });

  it('inserts exactly 35 rows', async () => {
    const count = await seedDatabase(pool);

    expect(count).toBe(35);
    const result = await pool.query('SELECT count(*) FROM listings');
    expect(Number(result.rows[0].count)).toBe(35);
  });

  it('leaves extracted_attributes and embedding NULL, and ingestion_status defaulted to pending', async () => {
    await seedDatabase(pool);

    const result = await pool.query(
      "SELECT count(*) FROM listings WHERE ingestion_status = 'pending' AND extracted_attributes IS NULL AND embedding IS NULL",
    );
    expect(Number(result.rows[0].count)).toBe(35);
  });

  it('is idempotent: running twice in a row results in exactly 35 rows, not 70', async () => {
    await seedDatabase(pool);
    await seedDatabase(pool);

    const result = await pool.query('SELECT count(*) FROM listings');
    expect(Number(result.rows[0].count)).toBe(35);
  });

  it('accepts an injected listing set for isolated testing', async () => {
    const count = await seedDatabase(pool, [seedListings[0]]);

    expect(count).toBe(1);
    const result = await pool.query('SELECT count(*) FROM listings');
    expect(Number(result.rows[0].count)).toBe(1);
  });
});
