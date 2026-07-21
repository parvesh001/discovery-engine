import type pg from 'pg';
import pLimit from 'p-limit';
import { extractAttributes } from './extraction.js';
import { buildEmbeddingInput, generateEmbedding } from './embeddings.js';

export type IngestionSummary = {
  processed: number;
  failed: number;
  failedIds: string[];
};

const CONCURRENCY = 5;

type PendingListing = {
  id: string;
  title: string;
  raw_description: string;
};

async function markFailed(pool: pg.Pool, listingId: string): Promise<void> {
  try {
    await pool.query(`UPDATE listings SET ingestion_status = 'failed' WHERE id = $1`, [listingId]);
  } catch (error) {
    console.error(`[ingestion] failed to mark listing ${listingId} as failed:`, error);
  }
}

async function ingestListing(pool: pg.Pool, listing: PendingListing): Promise<'processed' | 'failed'> {
  try {
    const attributes = await extractAttributes(listing.raw_description);
    const embeddingInput = buildEmbeddingInput(listing.title, listing.raw_description, attributes);
    const embedding = await generateEmbedding(embeddingInput);
    const embeddingLiteral = `[${embedding.join(',')}]`;

    await pool.query(
      `UPDATE listings
       SET extracted_attributes = $1, embedding = $2::vector, ingestion_status = 'processed', ingested_at = now()
       WHERE id = $3`,
      [JSON.stringify(attributes), embeddingLiteral, listing.id],
    );
    return 'processed';
  } catch (error) {
    console.error(`[ingestion] listing ${listing.id} failed:`, error);
    await markFailed(pool, listing.id);
    return 'failed';
  }
}

/**
 * Batch ingestion (Phase 2 — synchronous, no queue yet per spec 03's scope).
 * Only ever selects `ingestion_status = 'pending'` rows, so already-`processed`
 * listings are never re-selected and a second run makes zero API calls.
 */
export async function runIngestion(pool: pg.Pool): Promise<IngestionSummary> {
  const { rows } = await pool.query<PendingListing>(
    `SELECT id, title, raw_description FROM listings WHERE ingestion_status = 'pending'`,
  );

  const limit = pLimit(CONCURRENCY);
  const failedIds: string[] = [];
  let processed = 0;
  let failed = 0;

  await Promise.all(
    rows.map((listing) =>
      limit(async () => {
        const outcome = await ingestListing(pool, listing);
        if (outcome === 'processed') {
          processed += 1;
        } else {
          failed += 1;
          failedIds.push(listing.id);
        }
      }),
    ),
  );

  const summary: IngestionSummary = { processed, failed, failedIds };
  console.log(`[ingestion] complete: processed=${processed} failed=${failed} failedIds=${JSON.stringify(failedIds)}`);
  return summary;
}
