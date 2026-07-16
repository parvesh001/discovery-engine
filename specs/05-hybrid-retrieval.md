# Spec 05 — Phase 4: Hybrid Retrieval Engine

**Status:** Ready
**Branch:** `phase-4-hybrid-retrieval`
**Depends on:** Phase 2 (ingested data), Phase 3 (query intent)

## Context

Combines structured SQL filtering (exact, never approximate) with pgvector semantic similarity (fuzzy, handles paraphrase/synonyms) into one retrieval call. Per `CLAUDE.md` rule #2, hard filters are always real SQL — never left to embedding similarity alone.

## Functional Requirements

1. `retrieveCandidates(intent: QueryIntent): Promise<RankedCandidate[]>` in `/backend/src/services/search/retrieval.ts`.
   - Generate an embedding for `intent.semantic_query` using the same embedding function from Phase 2.
   - Build a SQL query that:
     - Applies each non-null field in `intent.filters` as a `WHERE` clause against `extracted_attributes` (JSONB) or the relevant structured column.
     - Orders remaining rows by cosine distance (pgvector `<=>` operator) between the query embedding and each listing's `embedding` column.
     - Limits to top 30.
     - Only considers listings where `ingestion_status = 'processed'`.
   - **Filter-relaxation fallback:** if the filtered query returns fewer than 5 results, re-run the same semantic ranking *without* the structured filters, and include `filters_relaxed: true` in the result so the caller can inform the user their filters were too narrow. Do not silently drop this information.
   - Returns each candidate with its similarity score (`RankedCandidate = Listing & { similarityScore: number }`).

## Interfaces

```ts
retrieveCandidates(intent: QueryIntent): Promise<{
  candidates: RankedCandidate[];
  filtersRelaxed: boolean;
}>
```

## Non-Functional Requirements

- Retrieval query itself should execute in well under 150ms against the 35-row dataset (this budget matters more once the dataset scales — measure now to have a baseline).
- Must use the `idx_listings_embedding` HNSW index (verify via `EXPLAIN` that it's actually used, not doing a sequential scan).

## Explicit Out of Scope

- No re-ranking here — that's Phase 5. This stage optimizes for recall (getting the right listings *into* the candidate set), not final precision ordering.
- No pagination (returns a fixed top-30 candidate set for the re-ranker to work with).

## Acceptance Criteria

- [ ] A query with `filters.pet_friendly = true` never returns a listing where `extracted_attributes.pet_friendly = false`.
- [ ] A query with only `semantic_query` populated (all filters null) returns results ranked purely by similarity.
- [ ] Verified against the Phase 1 dataset: a query using different wording than a listing's actual text (e.g. query says "scenic overlook," listing says "mountain view") still retrieves that listing in the candidate set.
- [ ] A deliberately over-narrow filter combination (e.g. filters matching zero listings) triggers the relaxation fallback and returns `filtersRelaxed: true` with semantically-ranked results rather than an empty array.
- [ ] `EXPLAIN ANALYZE` on the retrieval query confirms the HNSW index is used.
- [ ] A test script runs the 5 sample queries from Phase 3's test file end-to-end (raw query → intent → candidates) and prints titles + scores for manual relevance review.

## Open Questions Claude Code Should Ask If Unclear

- Exact threshold for "few results" that triggers filter relaxation (spec says <5 — confirm this is the intended number before hardcoding it as a magic constant; put it in a named config value regardless).
