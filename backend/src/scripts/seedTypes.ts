/**
 * Shared shape for both seed datasets (spec 12, Phase 11): the eval dataset
 * (`seed-eval-data.ts` → `pnpm run seed`, local/CI) and the demo dataset
 * (`seed-demo-data.ts` → `pnpm run seed:demo`, the deployed catalogue). Kept in one place
 * so the interface isn't carried in three copies.
 */
export interface SeedListing {
  title: string;
  rawDescription: string;
  pricePerNight: number;
  bedrooms: number;
  location: string;
  latitude: number;
  longitude: number;
}

/**
 * Demo-dataset rows additionally carry a `destination` slug (see
 * `backend/src/config/destinations.ts`), written to `listings.destination` by
 * `seed-demo.ts`. Eval-dataset rows leave that column NULL.
 */
export type DemoSeedListing = SeedListing & { destination: string };
