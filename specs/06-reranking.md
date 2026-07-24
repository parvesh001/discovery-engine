# Spec 06 — Phase 5: Re-ranking Layer

**Status:** Ready
**Branch:** `phase-5-reranking`
**Depends on:** Phase 4

## Context

Retrieval (Phase 4) optimizes for recall with a fast/cheap pipeline. This stage spends more compute on a small candidate set to get precision right — particularly for subjective/implied intent that similarity search alone handles poorly (e.g. "romantic getaway, not too remote").

## Functional Requirements

1. `rerank(query: string, candidates: RankedCandidate[]): Promise<RerankResult>` in `/backend/src/services/search/rerank.ts`.
   - Calls Voyage AI's `rerank-2.5` model via plain `fetch` against `https://api.voyageai.com/v1/rerank`, following the same pattern already established in `services/ingestion/embeddings.ts` (manual timeout/AbortController, one retry on transient failure, typed error on exhaustion) — **not** the `llm/client.ts` wrapper, since that wrapper is Claude-specific; this is a second, parallel "external AI provider" service following the same design shape, same as `embeddings.ts` already does for Voyage embeddings.
   - Input to Voyage: the original `query` string, and `documents` — an array of strings built from each candidate (title + raw_description + key extracted attributes, same spirit as `buildEmbeddingInput` from Phase 2, but does not need to be the identical string). Cap the candidate list sent at 20 (if more than 20 are passed in, take the top 20 by incoming `similarityScore` first) — this cap is now primarily about cost/consistency with the original design, not latency (`rerank-2.5`'s capacity is far higher than 20 documents), but is kept for continuity with the rest of the pipeline's "narrow before the expensive step" pattern.
   - Voyage returns a relevance score per document. Re-order the *original* candidate objects (not just the 20 sent, if fewer than the full incoming set were sent — see clarified fallback behavior below) by that score, descending.
   - Validate the response shape with `zod`. **On any failure (network, timeout, malformed response), fall back to the original incoming candidate order unmodified** — log a warning, never throw. Re-ranking failure degrades quality, it must not break search (per `CLAUDE.md` rule #3).
2. Latency of this call must be measured and logged (feeds into the `timing` object built in Phase 6).
3. `VOYAGE_API_KEY` (already present from Phase 2) is the only new env dependency — no new key needed.

## Interfaces

```ts
type RerankedCandidate = RankedCandidate & { relevanceScore: number | null };

rerank(query: string, candidates: RankedCandidate[]): Promise<{
  results: RerankedCandidate[];
  degraded: boolean; // true if fallback path was used
}>
```

Note the removal of `reasoning: string` from the previous version of this interface — there is no per-result generated explanation in this design. `relevanceScore` (Voyage's numeric output) replaces it as the only new field.

**Confirmed decision on candidates beyond the 20-cap:** on a successful rerank of more than 20 incoming candidates, the response contains all of them — the top 20 reordered by Voyage's score, with the remaining tail appended afterward in their original incoming order, `relevanceScore: null`. `relevanceScore` is nullable specifically so downstream consumers (Phase 6, Phase 7's UI) can distinguish "scored low" from "never scored" — a cost-driven engineering cap (20) should not silently shrink the candidate set Phase 4 already did real work assembling. Phase 7's UI must handle `relevanceScore: null` by omitting a score indicator, not displaying a fabricated `0`.

## Non-Functional Requirements

- Input capped at 20 candidates regardless of how many are passed in.
- Must fit within the overall P95 < 1.5s budget alongside the earlier stages (target: this stage ≤ 800ms) — **this target is genuinely achievable with `rerank-2.5`**, unlike the prior Sonnet-based design.

## Explicit Out of Scope

- No personalization/user-history weighting yet (mentioned as optional in the architecture doc — not required for MVP).
- No streaming of partial re-rank results.
- No generated reasoning/explanation text (deliberately removed — see Context).
- No use of `rerank-2.5`'s instruction-following capability (e.g. steering relevance with a natural-language instruction like "prioritize explicit pet policy over implied") — a real capability worth knowing exists, but out of scope for this phase; a candidate future enhancement, not a current requirement.

## Acceptance Criteria

- [ ] For a query with subtle/subjective intent (e.g. "romantic getaway, not too remote"), the re-ranked order is visibly different from and better than the raw incoming similarity order — verified by manual review, documented with a before/after comparison of titles and scores.
- [ ] Passing more than 20 candidates results in only the top 20 (by similarity score) being sent to Voyage — verify via a test with 30 mock candidates.
- [ ] Simulating a malformed/failed Voyage response results in the original candidate order being returned with `degraded: true`, and no unhandled exception.
- [ ] Latency for this stage is logged and reported for at least 5 sample queries, and is empirically within (or clearly close to) the ≤800ms target — if not, that's a real finding to report, not something to silently accept a second time.
- [ ] A test script prints pre-rerank vs. post-rerank order side by side, with relevance scores, for 3 subjective-intent queries.

## Open Questions Claude Code Should Ask If Unclear

*(none currently — the model choice, interface shape, and reasoning-field removal are all confirmed above)*