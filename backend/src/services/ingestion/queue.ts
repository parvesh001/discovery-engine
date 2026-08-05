import type pg from 'pg';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PendingListing } from './runIngestion.js';

export const INGESTION_QUEUE_NAME = 'ingestion';

/**
 * `connection` must be a dedicated ioredis instance created with
 * `{ maxRetriesPerRequest: null }` — BullMQ requires this on any connection it's given
 * (see services/redis/client.ts and index.ts's bootstrap). Sharing the general-purpose
 * cache/rate-limiter connection here is a documented BullMQ footgun, so a separate
 * instance is used throughout.
 */
export function createIngestionQueue(connection: Redis): Queue<PendingListing> {
  return new Queue<PendingListing>(INGESTION_QUEUE_NAME, { connection });
}

export type EnqueueSummary = { enqueued: number };

/**
 * Selects pending listings (same query the old synchronous runIngestion() used) and adds
 * one BullMQ job per listing, returning as soon as they're queued — spec 10, requirement
 * 4: "listing ingestion becomes a background job rather than a blocking synchronous
 * script." Actual processing happens later, asynchronously, in worker.ts's Worker.
 */
export async function enqueuePendingListings(pool: pg.Pool, queue: Queue<PendingListing>): Promise<EnqueueSummary> {
  const { rows } = await pool.query<PendingListing>(
    `SELECT id, title, raw_description FROM listings WHERE ingestion_status = 'pending'`,
  );

  // jobId: listing.id gives natural de-duplication within a single run — adding the same
  // pending listing twice in one enqueue call is a no-op rather than a duplicate job.
  await Promise.all(rows.map((listing) => queue.add('ingest-listing', listing, { jobId: listing.id })));

  return { enqueued: rows.length };
}
