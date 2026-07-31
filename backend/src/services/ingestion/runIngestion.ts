import type pg from 'pg';
import pLimit from 'p-limit';
import { extractAttributes, EXTRACTION_MODEL } from './extraction.js';
import { buildEmbeddingInput, generateEmbedding, EMBEDDING_MODEL } from './embeddings.js';
import { startIngestionTrace } from '../observability/langfuse.js';

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

type IngestionLogEntry = {
  listingId: string;
  extractionInputTokens: number;
  extractionOutputTokens: number;
  embeddingTokens: number | null;
  latencyMs: number;
};

/**
 * Awaited (unlike searchLogs.logSearch's fire-and-forget) since ingestion has no
 * user-facing latency to protect — but never rejects, same try/catch/log pattern, so a
 * broken log write can never turn a successful ingestion into a reported failure.
 */
async function logIngestion(pool: pg.Pool, entry: IngestionLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ingestion_logs
         (listing_id, extraction_model, extraction_input_tokens, extraction_output_tokens,
          embedding_model, embedding_tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.listingId,
        EXTRACTION_MODEL,
        entry.extractionInputTokens,
        entry.extractionOutputTokens,
        EMBEDDING_MODEL,
        entry.embeddingTokens,
        entry.latencyMs,
      ],
    );
  } catch (error) {
    console.error(`[ingestion] failed to write ingestion_logs entry for listing ${entry.listingId}:`, error);
  }
}

async function markFailed(pool: pg.Pool, listingId: string): Promise<void> {
  try {
    await pool.query(`UPDATE listings SET ingestion_status = 'failed' WHERE id = $1`, [listingId]);
  } catch (error) {
    console.error(`[ingestion] failed to mark listing ${listingId} as failed:`, error);
  }
}

async function ingestListing(pool: pg.Pool, listing: PendingListing): Promise<'processed' | 'failed'> {
  const startedAt = Date.now();
  const trace = startIngestionTrace(listing.id);

  try {
    const { attributes, usage: extractionUsage } = await extractAttributes(listing.raw_description, trace);
    const embeddingInput = buildEmbeddingInput(listing.title, listing.raw_description, attributes);
    const { embedding, tokens: embeddingTokens } = await generateEmbedding(embeddingInput, 'document', undefined, trace);
    const embeddingLiteral = `[${embedding.join(',')}]`;

    await pool.query(
      `UPDATE listings
       SET extracted_attributes = $1, embedding = $2::vector, ingestion_status = 'processed', ingested_at = now()
       WHERE id = $3`,
      [JSON.stringify(attributes), embeddingLiteral, listing.id],
    );

    await logIngestion(pool, {
      listingId: listing.id,
      extractionInputTokens: extractionUsage.inputTokens,
      extractionOutputTokens: extractionUsage.outputTokens,
      embeddingTokens,
      latencyMs: Date.now() - startedAt,
    });

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
