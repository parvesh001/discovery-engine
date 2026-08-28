import { loadEnv, type Env } from '../env.js';
import { createPool } from '../db.js';
import { createRedisClient } from '../services/redis/client.js';
import { createIngestionWorker } from '../services/ingestion/worker.js';
import { flushLangfuse } from '../services/observability/langfuse.js';

function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Long-running process (pnpm run ingest:worker) that processes ingestion jobs enqueued
 * by scripts/ingest.ts — spec 10, requirement 4. Stays alive until stopped (Ctrl+C /
 * SIGTERM), logging each job's outcome as it completes.
 */
async function main(): Promise<void> {
  await import('dotenv/config');
  const env = loadEnvOrExit();
  const pool = createPool(env.DATABASE_URL);
  const connection = createRedisClient(env.REDIS_URL, { maxRetriesPerRequest: null });
  const worker = createIngestionWorker(pool, connection);

  worker.on('completed', (job) => {
    console.log(`[ingestion-worker] job ${job.id} (listing ${job.data.id}) completed`);
  });
  worker.on('failed', (job, error) => {
    console.error(`[ingestion-worker] job ${job?.id} (listing ${job?.data.id}) failed:`, error);
  });

  console.log('Ingestion worker started. Waiting for jobs...');

  const shutdown = async (): Promise<void> => {
    console.log('Ingestion worker shutting down...');
    await worker.close();
    await pool.end();
    await flushLangfuse();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
