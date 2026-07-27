import { loadEnv, type Env } from '../env.js';
import { understandQuery } from '../services/search/queryUnderstanding.js';

// Manual review script (spec 04, item 2) — not a test suite. Prints extracted intent for
// each query so a human can eyeball whether the model's judgment calls (esp. never
// hallucinating max_price from soft terms like "cheap") match the spec's expectations.
export const TEST_QUERIES: string[] = [
  // Explicit hard constraints
  'pet friendly flat',
  '3 bedroom villa',
  'no pets allowed',
  'a flat with at least 2 bedrooms',

  // Vague / subjective only
  'somewhere cozy and quiet for a weekend',
  'a place with a great view',
  'something charming and romantic',
  'a relaxing getaway close to nature',

  // Numeric constraints
  'under ₹5000 a night',
  'at least 2 bedrooms',
  '₹3000 max per night', // purely numeric — checks the semantic_query-never-empty fallback
  'less than 6000 a night, 4 bedrooms',

  // Mixed (explicit + vague)
  'pet friendly cottage in Manali',
  'budget homestay near a Goa beach',
  '3 bedroom villa under ₹8000 a night, pet friendly',
  'affordable flat with a great view, dog friendly',

  // Location as the only explicit constraint — isolates filters.location from the other
  // fields, and (per seed-data.ts) only one listing is tagged "Manali, Himachal Pradesh",
  // so this also exercises the retrieval filter-relaxation fallback end-to-end.
  'a place to stay in Manali',
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
