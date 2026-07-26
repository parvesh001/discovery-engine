export type ExtractedAttributes = {
  property_type: string;
  pet_friendly: boolean | null;
  view_type: string | null;
  amenities: string[];
  bedrooms_mentioned: number | null;
};

export type Listing = {
  id: string;
  title: string;
  raw_description: string;
  price_per_night: number | null;
  bedrooms: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  extracted_attributes: ExtractedAttributes | null;
  ingestion_status: string;
};

export type RerankedListing = Listing & { relevanceScore: number | null };

export type SearchResponse = {
  results: RerankedListing[];
  degraded: boolean;
  filtersRelaxed: boolean;
  timing: { understanding_ms: number; retrieval_ms: number; rerank_ms: number; total_ms: number };
};

export type NaiveSearchResponse = { results: Listing[] };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Only checks the top-level response shape (results is an array, degraded/filtersRelaxed
 * are booleans) — not every field of every listing inside `results`. This is our own
 * backend responding to our own frontend, not third-party/user-authored data, so full zod
 * validation of the fetch boundary is a deliberate judgment call to skip (see plan). But a
 * blind `as SearchResponse` cast on unknown JSON is still wrong: this phase has no
 * automated frontend test net to catch a contract drift, so a shape check here is the only
 * thing standing between a backend change and an unhandled exception mid-render.
 * Per-listing defensiveness is handled one level deeper, in ListingCard.
 */
export function isSearchResponse(value: unknown): value is SearchResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.results) &&
    typeof value.degraded === 'boolean' &&
    typeof value.filtersRelaxed === 'boolean'
  );
}

export function isNaiveSearchResponse(value: unknown): value is NaiveSearchResponse {
  return isRecord(value) && Array.isArray(value.results);
}
