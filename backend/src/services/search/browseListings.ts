import type pg from 'pg';
import { type Listing } from './retrieval.js';

// Same projected columns as naiveSearch / retrieval so the frontend can render browse
// results with the identical ListingCard.
const LISTING_COLUMNS = `id, title, raw_description, price_per_night, bedrooms, location, latitude, longitude,
       extracted_attributes, ingestion_status`;

/**
 * Browse-before-search (spec 12 §2): a plain, indexed SQL read of every processed listing
 * in one destination — no LLM, no embedding, no rerank. `destination` is a pre-validated
 * slug from the route; the demo's catalogue is ~35–37 rows per destination so there is no
 * pagination.
 *
 * Order is the curated `seed-demo-data.ts` sequence: `seed-demo.ts` writes a fabricated,
 * strictly-increasing `created_at` per row that encodes the array index (see its "semantic
 * fiction" comment), so `created_at ASC` reproduces the file order. `id ASC` is a
 * defensive tiebreaker only.
 */
export async function browseListingsByDestination(pool: pg.Pool, destination: string): Promise<Listing[]> {
  const { rows } = await pool.query<Listing>(
    `
    SELECT ${LISTING_COLUMNS}
    FROM listings
    WHERE ingestion_status = 'processed'
      AND destination = $1
    ORDER BY created_at ASC, id ASC
    `,
    [destination],
  );

  return rows;
}
