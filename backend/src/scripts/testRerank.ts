import pg from 'pg';
import { loadEnv, type Env } from '../env.js';
import { understandQuery } from '../services/search/queryUnderstanding.js';
import { retrieveCandidates } from '../services/search/retrieval.js';
import { rerank } from '../services/search/rerank.js';

// Manual before/after review script (spec 06, acceptance criteria 1 and 5) — not a test
// suite. Runs raw query -> intent -> candidates -> rerank for subjective-intent queries
// where similarity search alone is expected to struggle, and prints the pre-rerank
// (similarity-only) order next to the post-rerank order with Voyage relevance scores, so a
// human can judge whether the re-ranked order is visibly better. Also prints latency per
// query (criterion 4), which should now be close to the ≤800ms target with rerank-2.5.
const SUBJECTIVE_QUERIES: string[] = [
  'romantic getaway, not too remote',
  'somewhere cozy and quiet for a weekend',
  'a relaxing getaway close to nature',
  'something charming and full of character',
  'a peaceful spot for a solo writing retreat',
];

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
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

  try {
    for (const query of SUBJECTIVE_QUERIES) {
      console.log(`\n=== Query: "${query}" ===`);
      try {
        const intent = await understandQuery(query);
        const { candidates, filtersRelaxed } = await retrieveCandidates(pool, intent);
        if (filtersRelaxed) {
          console.log('(filters were relaxed — too narrow, showing semantic-only ranking)');
        }

        console.log('\nBefore (similarity order):');
        candidates.forEach((c, i) => {
          console.log(`  ${i + 1}. ${c.similarityScore.toFixed(4)}  ${c.title}`);
        });

        const started = Date.now();
        const { results, degraded } = await rerank(query, candidates);
        const elapsedMs = Date.now() - started;

        console.log(`\nAfter (reranked${degraded ? ', DEGRADED — fell back to original order' : ''}):`);
        results.forEach((r, i) => {
          const score = r.relevanceScore === null ? 'unscored (beyond cap)' : r.relevanceScore.toFixed(4);
          console.log(`  ${i + 1}. ${score}  ${r.title}`);
        });
        console.log(`\nrerank latency: ${elapsedMs}ms`);
      } catch (error) {
        console.error('Failed:', error instanceof Error ? error.message : error);
      }
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
