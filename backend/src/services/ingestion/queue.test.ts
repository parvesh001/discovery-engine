import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Queue } from 'bullmq';
import { getTestDatabaseUrl } from '../../test/testDb.js';
import { getTestRedisUrl } from '../../test/testRedis.js';
import { createRedisClient } from '../redis/client.js';
import { createIngestionQueue, enqueuePendingListings } from './queue.js';
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
