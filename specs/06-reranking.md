# Spec 06 — Phase 5: Re-ranking Layer

**Status:** Ready
**Branch:** `phase-5-reranking`
**Depends on:** Phase 4

## Context

Retrieval (Phase 4) optimizes for recall with a fast/cheap pipeline. This stage spends more compute on a small candidate set to get precision right — particularly for subjective/implied intent that similarity search alone handles poorly (e.g. "romantic getaway, not too remote").

## Functional Requirements

1. `rerank(query: string, candidates: RankedCandidate[]): Promise<RerankedResult[]>` in `/backend/src/services/search/rerank.ts`.
   - Calls Claude (Sonnet) via the shared `llm/` wrapper.
   - Input to the model: the original user query + candidate listings (id, title, full description, extracted attributes) — cap the candidate list sent to the model at 20 (if more than 20 are passed in, take the top 20 by incoming `similarityScore` first).
   - System prompt: act as a search relevance expert, re-order candidates by true relevance to the query's full intent (including subjective/implied aspects earlier stages couldn't capture).
   - Output: JSON array of `{id: string, reasoning: string}` in ranked order — `reasoning` is a one-sentence explanation of that listing's placement.
   - Validate with `zod`. **On failure, fall back to the original incoming candidate order unmodified** — log a warning, never throw. Re-ranking failure degrades quality, it must not break search (per `CLAUDE.md` rule #3).
2. Latency of this call must be measured and logged (feeds into the `timing` object built in Phase 6).

## Interfaces

```ts
rerank(query: string, candidates: RankedCandidate[]): Promise<{
  results: Array<RankedCandidate & { reasoning: string }>;
  degraded: boolean; // true if fallback path was used
}>
```

## Non-Functional Requirements

- Input capped at 20 candidates regardless of how many are passed in, to bound cost/latency.
- Must fit within the overall P95 < 1.5s budget alongside the earlier stages (target: this stage ≤ 800ms).

## Explicit Out of Scope

- No personalization/user-history weighting yet (mentioned as optional in the architecture doc — not required for MVP).
- No streaming of partial re-rank results.

## Acceptance Criteria

- [ ] For a query with subtle/subjective intent (e.g. "romantic getaway, not too remote"), the re-ranked order is visibly different from and better than the raw incoming similarity order — verified by manual review, documented with a before/after comparison.
- [ ] Passing more than 20 candidates results in only the top 20 (by similarity score) being sent to the model — verify via a test with 30 mock candidates.
- [ ] Simulating a malformed/invalid model response (e.g. via a mocked failure) results in the original candidate order being returned with `degraded: true`, and no unhandled exception.
- [ ] Latency for this stage is logged and reported for at least 5 sample queries.
- [ ] A test script prints pre-rerank vs. post-rerank order side by side for 3 subjective-intent queries.

## Open Questions Claude Code Should Ask If Unclear

- Whether `reasoning` strings should be surfaced to end users in the UI (Phase 7 assumes yes) — confirm this doesn't change the prompt design (e.g. tone/length) before finalizing.
