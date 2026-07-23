import { loadEnv, type Env } from '../env.js';
import { understandQuery } from '../services/search/queryUnderstanding.js';

// Manual review script (spec 04, item 2) — not a test suite. Prints extracted intent for
// each query so a human can eyeball whether the model's judgment calls (esp. never
// hallucinating max_price from soft terms like "cheap") match the spec's expectations.
const TEST_QUERIES: string[] = [
  // Explicit hard constraints
  'pet friendly apartment',
  '3 bedroom house',
  'no pets allowed',
  'a condo with at least 2 bedrooms',

  // Vague / subjective only
  'somewhere cozy and quiet for a weekend',
  'a place with a great view',
  'something charming and romantic',
  'a relaxing getaway close to nature',

  // Numeric constraints
  'under $150 a night',
  'at least 2 bedrooms',
  '$100 max per night', // purely numeric — checks the semantic_query-never-empty fallback
  'less than 200 a night, 4 bedrooms',

  // Mixed (explicit + vague)
  'pet friendly cabin with mountain view',
  'cheap studio near the beach',
  '3 bedroom house under $300, pet friendly',
  'affordable loft with a great view, dog friendly',
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
  loadEnvOrExit();

  for (const query of TEST_QUERIES) {
    console.log(`\nQuery: "${query}"`);
    try {
      const intent = await understandQuery(query);
      console.log(JSON.stringify(intent, null, 2));
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : error);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
