import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { getTestDatabaseUrl } from '../../test/testDb.js';
import { naiveSearchListings } from './naiveSearch.js';

describe('naiveSearchListings', () => {
  const pool = new pg.Pool({ connectionString: getTestDatabaseUrl() });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE listings CASCADE');
  });

  async function insert(title: string, destination: string | null, description = 'A riverside cabin with a deck.') {
    await pool.query(
      `INSERT INTO listings (title, raw_description, price_per_night, bedrooms, location, latitude, longitude,
                              ingestion_status, destination)
       VALUES ($1, $2, 100, 1, 'Test', 0, 0, 'processed', $3)`,
      [title, description, destination],
    );
  }

  it('matches title/description with ILIKE and ignores case, no destination filter by default', async () => {
    await insert('Riverside Cabin, Manali', 'manali');
    await insert('Beach House, Goa', 'goa', 'A cabin feel by the sea.');
    await insert('Unrelated Loft', null, 'City apartment, no outdoor space.');

    const rows = await naiveSearchListings(pool, 'cabin');

    expect(rows.map((r) => r.title).sort()).toEqual(['Beach House, Goa', 'Riverside Cabin, Manali']);
  });

  it('scopes to a single destination when one is passed', async () => {
    await insert('Riverside Cabin, Manali', 'manali');
    await insert('Cabin by the Sea, Goa', 'goa');
    await insert('Unscoped Cabin', null);

    const rows = await naiveSearchListings(pool, 'cabin', 'manali');

    expect(rows.map((r) => r.title)).toEqual(['Riverside Cabin, Manali']);
  });

  it('never returns rows from another destination even on a strong text match', async () => {
    await insert('Cabin One, Goa', 'goa');
    await insert('Cabin Two, Goa', 'goa');

    const rows = await naiveSearchListings(pool, 'cabin', 'manali');

    expect(rows).toHaveLength(0);
  });

  it('excludes non-processed rows regardless of scope', async () => {
    await pool.query(
      `INSERT INTO listings (title, raw_description, price_per_night, bedrooms, location, latitude, longitude,
                              ingestion_status, destination)
       VALUES ('Pending Cabin', 'A cabin.', 100, 1, 'Test', 0, 0, 'pending', 'manali')`,
    );

    const rows = await naiveSearchListings(pool, 'cabin', 'manali');

    expect(rows).toHaveLength(0);
  });
});
