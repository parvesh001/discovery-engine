import pg from 'pg';
import { loadEnv, type Env } from '../env.js';
import { understandQuery } from '../services/search/queryUnderstanding.js';
import { retrieveCandidates } from '../services/search/retrieval.js';
import { TEST_QUERIES } from './testQueryUnderstanding.js';

// Manual end-to-end review script (spec 05, acceptance criterion 6) — not a test suite.
// Runs raw query -> intent -> candidates for 5 queries pulled from Phase 3's test set,
// spanning its categories (explicit hard constraint, vague/subjective, numeric, and two
// mixed queries), and prints titles + similarity scores for a human to eyeball relevance
// against the seeded dataset (e.g. does "a place with a great view" surface listings whose
// text describes a view in different words, per acceptance criterion 3).
const SAMPLE_QUERY_INDICES = [0, 5, 8, 12, 15];

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

  const sampleQueries = SAMPLE_QUERY_INDICES.map((i) => TEST_QUERIES[i]).filter(
    (query): query is string => query !== undefined,
  );

  try {
    for (const query of sampleQueries) {
      console.log(`\nQuery: "${query}"`);
      try {
        const intent = await understandQuery(query);
        console.log('Intent:', JSON.stringify(intent));

        const { candidates, filtersRelaxed } = await retrieveCandidates(pool, intent);
        if (filtersRelaxed) {
          console.log('(filters were relaxed — too narrow, showing semantic-only ranking)');
        }
        for (const candidate of candidates) {
          console.log(`  ${candidate.similarityScore.toFixed(4)}  ${candidate.title}`);
        }
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
