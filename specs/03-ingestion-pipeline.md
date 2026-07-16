# Spec 03 — Phase 2: Ingestion Pipeline (Attribute Extraction + Embeddings)

**Status:** Ready
**Branch:** `phase-2-ingestion-pipeline`
**Depends on:** Phase 0, Phase 1

## Context

This is the highest-leverage part of the whole system: it's what makes inconsistently-worded and niche listings discoverable at all, by converting messy free text into structured, filterable data plus a semantic embedding — once, at ingestion time, not repeatedly at query time.

## Functional Requirements

1. `extractAttributes(rawDescription: string): Promise<ExtractedAttributes>` in `/backend/src/services/ingestion/extraction.ts`.
   - Calls Claude (Haiku) via the shared `llm/` wrapper (per `CLAUDE.md` rule #1).
   - System prompt instructs extraction of structured attributes from a rental listing description, returning **only** valid JSON matching:
     ```ts
     type ExtractedAttributes = {
       property_type: string;
       pet_friendly: boolean | null;
       view_type: string | null;
       amenities: string[];
       bedrooms_mentioned: number | null;
     }
     ```
   - The prompt must explicitly instruct: use `null` when the description doesn't provide enough information to infer a field confidently — never guess.
   - Response validated against a `zod` schema. On validation failure, retry once with an error-correction prompt (include the parse error in the retry). If it fails twice, propagate a typed error — do not fabricate a default object.
2. `generateEmbedding(text: string): Promise<number[]>` in `/backend/src/services/ingestion/embeddings.ts`.
   - Input text is a normalized concatenation of: title + raw_description + extracted attributes (as text) — construct this combination explicitly and document the format used, since it affects retrieval quality later.
3. `runIngestion(): Promise<IngestionSummary>` in `/backend/src/services/ingestion/runIngestion.ts`.
   - Queries all listings where `ingestion_status = 'pending'`.
   - For each: calls `extractAttributes`, then `generateEmbedding` (on title + description + the *result* of extraction), updates the row with `extracted_attributes`, `embedding`, `ingestion_status = 'processed'`, `ingested_at = now()`.
   - On any failure for a given listing: set `ingestion_status = 'failed'`, log the listing ID and error — must not crash or halt processing of the remaining listings.
   - Processes with bounded concurrency (max 5 concurrent listings) to respect API rate limits.
   - Returns/logs a summary: count processed, count failed, list of failed listing IDs.
4. Re-running `runIngestion()` must be a no-op for already-`processed` listings (only picks up `pending` or explicitly re-queued `failed` ones) — no wasted API spend on reprocessing.

## Interfaces

```ts
runIngestion(): Promise<{ processed: number; failed: number; failedIds: string[] }>
```
CLI entrypoint: `pnpm --filter backend run ingest`

## Non-Functional Requirements

- Concurrency capped at 5 to respect Anthropic API rate limits.
- Each extraction call has a timeout and one retry per `CLAUDE.md` rule #3.

## Explicit Out of Scope

- No queue/background job system yet (that's Phase 9 — this phase runs as a synchronous batch script).
- No re-ingestion trigger on listing update (assume static dataset for now).

## Acceptance Criteria

- [ ] Running `runIngestion()` against the Phase 1 dataset (35 listings) results in all reaching `ingestion_status = 'processed'` (or documented, justified `'failed'` if genuinely malformed input was seeded).
- [ ] Spot check: a listing that only implies pet-friendliness via its amenities list (not stated explicitly) is correctly extracted with `pet_friendly: true`.
- [ ] Spot check: a listing with no mention of view is correctly extracted with `view_type: null`, not a guessed value.
- [ ] Re-running `runIngestion()` after a full successful run makes zero additional Claude API calls (verify via logs or a call counter).
- [ ] A deliberately malformed/empty description doesn't crash the batch — it's marked `failed` and the rest of the batch still completes.

## Open Questions Claude Code Should Ask If Unclear

- Exact embedding model/dimension to standardize on if not already fixed by the `VECTOR(1536)` column — confirm which Claude/embedding provider and model before implementing, since the column width must match.
