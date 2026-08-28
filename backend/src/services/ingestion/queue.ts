import type pg from 'pg';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PendingListing } from './runIngestion.js';

export const INGESTION_QUEUE_NAME = 'ingestion';

/**
 * Confirmed decision (see specs/10-production-hardening.md's Post-Merge Amendment on
 * job-level retries): 1 retry at the BullMQ job level, 5s base delay, growing
 * exponentially on top of that if attempts is ever raised above 2. This exists to catch
 * *slower*-recovering problems — a provider outage lasting tens of seconds to minutes —
 * that the fast, near-instant single retry already inside callClaude/generateEmbedding
 * (CLAUDE.md rule #3) isn't spaced out enough to ride out.
 *
 * Retry-stacking note: by the time a job reaches its 2nd BullMQ attempt, the 1st attempt
 * has already exhausted its own internal retries at both the extraction (Claude) and
 * embedding (Voyage) layers inside `ingestListing` — each up to 2 attempts on its own. So
 * "attempts: 2" here does NOT mean "the listing is tried twice" — the true worst-case
 * count, if every single call transiently fails, is up to 2 (BullMQ) x 4 (2 Claude + 2
 * Voyage attempts per `ingestListing` call) = 8 real API calls before this job is
 * permanently marked failed. Same layered-retry consideration as CLAUDE.md rule #3's
 * per-call retry, just one level up.
 */
const DEFAULT_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 5000 },
} as const;

/**
 * `connection` must be a dedicated ioredis instance created with
 * `{ maxRetriesPerRequest: null }` — BullMQ requires this on any connection it's given
 * (see services/redis/client.ts and index.ts's bootstrap). Sharing the general-purpose
 * cache/rate-limiter connection here is a documented BullMQ footgun, so a separate
 * instance is used throughout.
 */
export function createIngestionQueue(connection: Redis): Queue<PendingListing> {
  return new Queue<PendingListing>(INGESTION_QUEUE_NAME, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
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
