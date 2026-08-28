import { loadEnv, type Env } from '../env.js';
import { createPool } from '../db.js';
import { createRedisClient } from '../services/redis/client.js';
import { createIngestionQueue, enqueuePendingListings } from '../services/ingestion/queue.js';

function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await import('dotenv/config');
  const env = loadEnvOrExit();
  const pool = createPool(env.DATABASE_URL);
  // BullMQ requires maxRetriesPerRequest: null on its connection — a dedicated instance,
  // never the general-purpose cache/rate-limiter one (see services/redis/client.ts).
  const connection = createRedisClient(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = createIngestionQueue(connection);

  try {
    const { enqueued } = await enqueuePendingListings(pool, queue);
    console.log(`Enqueued ${enqueued} listing(s) for ingestion. Run "pnpm run ingest:worker" to process them.`);
  } catch (error) {
    console.error('Enqueueing ingestion jobs crashed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
    // queue.close() alone doesn't disconnect a connection BullMQ doesn't own — this script
    // created `connection` itself, so it must also disconnect it, or the process (a
    // one-shot CLI trigger, not a long-running worker) hangs forever on the open socket.
    await queue.close();
    connection.disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
