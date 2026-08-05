import type pg from 'pg';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { INGESTION_QUEUE_NAME } from './queue.js';
import { ingestListing, type PendingListing } from './runIngestion.js';

const CONCURRENCY = 5; // matches the old synchronous pipeline's pLimit(5) cap

/**
 * BullMQ worker whose processor is exactly `ingestListing` — extraction, embedding,
 * DB-update, logging, and failure-marking behavior is unchanged from before spec 10;
 * only how jobs are dispatched (a queue instead of a synchronous Promise.all loop) has
 * changed. `connection` must be the dedicated BullMQ ioredis instance (see queue.ts).
 */
export function createIngestionWorker(pool: pg.Pool, connection: Redis): Worker<PendingListing> {
  return new Worker<PendingListing>(
    INGESTION_QUEUE_NAME,
    async (job: Job<PendingListing>) => {
      const outcome = await ingestListing(pool, job.data);
      if (outcome === 'failed') {
        // ingestListing already logged the real error and marked the listing 'failed' in
        // Postgres — throwing here on top of that just gives BullMQ's own job-failure
        // bookkeeping (retries/dashboards) an accurate signal too, not a duplicate report.
        throw new Error(`Listing ${job.data.id} failed to ingest`);
      }
      return outcome;
    },
    { connection, concurrency: CONCURRENCY },
  );
}
