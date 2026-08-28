import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Worker, type Queue } from 'bullmq';
import { getTestDatabaseUrl } from '../../test/testDb.js';
import { getTestRedisUrl } from '../../test/testRedis.js';
import { createRedisClient } from '../redis/client.js';
import { createIngestionQueue, enqueuePendingListings, INGESTION_QUEUE_NAME } from './queue.js';
import type { PendingListing } from './runIngestion.js';

describe('enqueuePendingListings', () => {
  const pool = new pg.Pool({ connectionString: getTestDatabaseUrl() });
  const connection = createRedisClient(getTestRedisUrl(), { maxRetriesPerRequest: null });
  let queue: Queue<PendingListing>;

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE listings CASCADE');
    await connection.flushdb();
    queue = createIngestionQueue(connection);
  });

  afterEach(async () => {
    await queue.close();
  });

  afterAll(async () => {
    await pool.end();
    connection.disconnect();
  });

  async function insertListing(title: string, rawDescription: string, status = 'pending'): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO listings (title, raw_description, ingestion_status) VALUES ($1, $2, $3) RETURNING id`,
      [title, rawDescription, status],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('insert did not return a row');
    }
    return row.id;
  }

  it('enqueues one job per pending listing and returns the count immediately, without waiting for processing', async () => {
    const id1 = await insertListing('A', 'desc a');
    const id2 = await insertListing('B', 'desc b');

    const { enqueued } = await enqueuePendingListings(pool, queue);

    expect(enqueued).toBe(2);
    const jobs = await queue.getJobs(['waiting']);
    expect(jobs.map((j) => j.data.id).sort()).toEqual([id1, id2].sort());
  });

  it('only selects listings with ingestion_status = pending', async () => {
    await insertListing('Already processed', 'desc', 'processed');
    await insertListing('Already failed', 'desc', 'failed');
    const pendingId = await insertListing('Still pending', 'desc');

    const { enqueued } = await enqueuePendingListings(pool, queue);

    expect(enqueued).toBe(1);
    const jobs = await queue.getJobs(['waiting']);
    expect(jobs.map((j) => j.data.id)).toEqual([pendingId]);
  });

  it('is idempotent within a run: enqueuing the same still-pending listing twice does not duplicate the job', async () => {
    await insertListing('Test', 'desc');

    await enqueuePendingListings(pool, queue);
    const second = await enqueuePendingListings(pool, queue);

    expect(second.enqueued).toBe(1); // the SELECT still finds it (status is still 'pending')
    const jobs = await queue.getJobs(['waiting']);
    expect(jobs).toHaveLength(1); // but BullMQ's jobId-based dedup collapses the add itself
  });

  it('enqueues nothing and returns 0 when there are no pending listings', async () => {
    await insertListing('Already processed', 'desc', 'processed');

    const { enqueued } = await enqueuePendingListings(pool, queue);

    expect(enqueued).toBe(0);
    const jobs = await queue.getJobs(['waiting']);
    expect(jobs).toHaveLength(0);
  });
});

// Confirmed decision (spec 10 Post-Merge Amendment, job-level retries): createIngestionQueue
// sets defaultJobOptions to attempts: 2 with a 5s exponential backoff, so a job that fails
// once (a transient issue that outlasts the fast internal retry already inside
// callClaude/generateEmbedding) still gets a second, later-spaced attempt instead of sitting
// permanently failed after one try. This uses a fake processor (not the real ingestListing
// pipeline, which is already covered elsewhere) to isolate and prove BullMQ's retry
// mechanics alone, driven by the real createIngestionQueue configuration.
describe('createIngestionQueue — job-level retry', () => {
  const retryConnection = createRedisClient(getTestRedisUrl(), { maxRetriesPerRequest: null });

  beforeEach(async () => {
    await retryConnection.flushdb();
  });

  afterAll(() => {
    retryConnection.disconnect();
  });

  it(
    'a job that fails on its first attempt is retried and ends up completed, not stuck failed after one try',
    async () => {
      const queue = createIngestionQueue(retryConnection);
      const listing: PendingListing = { id: 'retry-test-listing', title: 'Retry Test', raw_description: 'desc' };

      let attemptCount = 0;
      const worker = new Worker<PendingListing>(
        INGESTION_QUEUE_NAME,
        async () => {
          attemptCount += 1;
          if (attemptCount === 1) {
            throw new Error('simulated transient failure (e.g. a brief Claude/Voyage outage)');
          }
          return 'processed';
        },
        { connection: retryConnection, concurrency: 1 },
      );

      try {
        const completed = new Promise<void>((resolve) => {
          worker.on('completed', () => resolve());
        });

        await queue.add('ingest-listing', listing, { jobId: listing.id });
        // The real 5s backoff delay (defaultJobOptions) has to actually elapse here — this
        // is the true configured behavior, not a shortened test double of it.
        await completed;

        // Proves a retry genuinely happened — a first-try success would leave this at 1.
        expect(attemptCount).toBe(2);
      } finally {
        await worker.close();
        await queue.close();
      }
    },
    15_000,
  );
});
