import { loadEnv, type Env } from '../env.js';
import { createPool } from '../db.js';
import { runIngestion } from '../services/ingestion/runIngestion.js';

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

  try {
    const summary = await runIngestion(pool);
    console.log(`Ingestion complete: ${summary.processed} processed, ${summary.failed} failed.`);
    if (summary.failedIds.length > 0) {
      console.log(`Failed listing IDs: ${summary.failedIds.join(', ')}`);
    }
  } catch (error) {
    console.error('Ingestion run crashed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
