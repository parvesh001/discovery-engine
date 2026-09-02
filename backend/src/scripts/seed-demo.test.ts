import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { seedDemoDatabase } from './seed-demo.js';
import { demoListings } from './seed-demo-data.js';
import { getTestDatabaseUrl } from '../test/testDb.js';

describe('seedDemoDatabase', () => {
  const pool = new pg.Pool({ connectionString: getTestDatabaseUrl() });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE listings CASCADE');
  });

  it('inserts exactly 72 rows: 35 manali, 37 goa, 0 NULL destination', async () => {
    const count = await seedDemoDatabase(pool);
    expect(count).toBe(72);

    const total = await pool.query('SELECT count(*) FROM listings');
    expect(Number(total.rows[0].count)).toBe(72);

    const byDestination = await pool.query(
      "SELECT destination, count(*)::int AS n FROM listings GROUP BY destination ORDER BY destination",
    );
    expect(byDestination.rows).toEqual([
      { destination: 'goa', n: 37 },
      { destination: 'manali', n: 35 },
    ]);

    const nullDest = await pool.query('SELECT count(*) FROM listings WHERE destination IS NULL');
    expect(Number(nullDest.rows[0].count)).toBe(0);
  });

  it('leaves extracted_attributes and embedding NULL, ingestion_status defaulted to pending', async () => {
    await seedDemoDatabase(pool);

    const result = await pool.query(
      "SELECT count(*) FROM listings WHERE ingestion_status = 'pending' AND extracted_attributes IS NULL AND embedding IS NULL",
    );
    expect(Number(result.rows[0].count)).toBe(72);
  });

  it('is idempotent: running twice leaves exactly 72 rows, not 144', async () => {
    await seedDemoDatabase(pool);
    await seedDemoDatabase(pool);

    const result = await pool.query('SELECT count(*) FROM listings');
    expect(Number(result.rows[0].count)).toBe(72);
  });

  it('fabricates a distinct, strictly-increasing created_at so browse order == demoListings order', async () => {
    await seedDemoDatabase(pool);

    const distinct = await pool.query('SELECT count(DISTINCT created_at)::int AS n FROM listings');
    expect(distinct.rows[0].n).toBe(72);

    // The browse endpoint's exact ORDER BY — must reproduce the curated file sequence
    // (manaliListings in order, then goaListings in order).
    const ordered = await pool.query<{ title: string }>(
      'SELECT title FROM listings ORDER BY created_at ASC, id ASC',
    );
    expect(ordered.rows.map((r) => r.title)).toEqual(demoListings.map((l) => l.title));
  });

  it('accepts an injected listing set for isolated testing', async () => {
    const [firstListing] = demoListings;
    if (!firstListing) throw new Error('demoListings is empty — cannot run this test');
    const count = await seedDemoDatabase(pool, [firstListing]);

    expect(count).toBe(1);
    const result = await pool.query('SELECT count(*) FROM listings');
    expect(Number(result.rows[0].count)).toBe(1);
  });
});
