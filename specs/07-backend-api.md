# Spec 07 — Phase 6: Backend API & Orchestration

**Status:** Ready
**Branch:** `phase-6-backend-api`
**Depends on:** Phase 3, Phase 4, Phase 5

## Context

Wires the pipeline into a single endpoint the frontend can call, with graceful degradation at every stage — this is where the "never a blank results page" principle from the architecture doc becomes concrete.

## Functional Requirements

1. `POST /api/search` in `/backend/src/routes/search.ts`.
   - Request body: `{ query: string }`, validated with `zod` — non-empty, reasonable max length (define and enforce a specific character limit, e.g. 500). Invalid input → `400` with a structured error body.
   - Orchestrates: `understandQuery` → `retrieveCandidates` → `rerank`, in sequence.
   - **Degradation rules (each wrapped in its own try/catch):**
     - If `understandQuery` fails: treat the raw query as `semantic_query` with all filters null, and continue the pipeline.
     - If `rerank` fails: return the retrieval-stage order, with `degraded: true` in the response.
     - If `retrieveCandidates` itself fails (the one stage with no fallback): return an error response — this is the only case where the endpoint can return non-200.
   - Response includes `timing: { understanding_ms, retrieval_ms, rerank_ms, total_ms }`.
   - After responding (do not block the response on this), asynchronously log the full request to `search_logs`: raw query, extracted intent, candidate IDs, final ranked IDs, latency, and per-LLM-call metadata (model used, token counts if available from the SDK response).
2. Basic rate limiting middleware: 30 requests/minute per IP (explicitly a placeholder — full hardening is Phase 9, but the endpoint must not ship with zero protection).

## Interfaces

```
POST /api/search
Request:  { query: string }
Response: {
  results: Array<Listing & { relevanceScore: number | null }>,
  degraded: boolean,
  filtersRelaxed: boolean,
  timing: { understanding_ms: number, retrieval_ms: number, rerank_ms: number, total_ms: number }
}
400: { error: string }        // invalid input
500: { error: string }        // retrieval-stage failure only
```

## Non-Functional Requirements

- Async logging to `search_logs` must not add latency to the response the user waits on.
- Total P95 latency budget: < 1.5s (per architecture doc).

## Explicit Out of Scope

- No auth/session handling (rate limiting is IP-based only for now).
- No caching (Phase 9).

## Acceptance Criteria

- [ ] Endpoint returns correct, well-formed results for the 15-query test set from Phase 3.
- [ ] With the Anthropic API key temporarily invalidated (test-only), the endpoint still returns retrieval-stage results rather than a 500 — confirms the degradation path actually works, not just exists in code.
- [ ] `search_logs` is populated correctly for a sample of real requests — spot check the JSON shape matches what was actually logged.
- [ ] Sending 31 requests within a minute from the same IP results in a 429 on the 31st.
- [ ] Integration test suite covers: valid query happy path, empty query (400), oversized query (400), and the degraded-mode path (mocked failure).

## Open Questions Claude Code Should Ask If Unclear

- Exact character limit for query length — pick a specific number and confirm rather than leaving it implicit.