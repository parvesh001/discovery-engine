# Spec 08 — Phase 7: Frontend Search UI

**Status:** Ready
**Branch:** `phase-7-frontend-ui`
**Depends on:** Phase 6

## Context

The UI needs to make the pipeline's value obvious at a glance — this project doubles as a client-facing demo, so a naive-vs-AI comparison is a functional requirement, not a nice-to-have.

## Functional Requirements

1. Search page at `/frontend/app/search/`.
   - Text input + submit action calling `POST /api/search` on the backend.
   - While in flight: sequential loading states reflecting pipeline stages ("Understanding your search..." → "Finding matches..." → "Ranking results..."). If real per-stage timing isn't streamed from the backend, simulate reasonable stage transitions with short timed delays — document this as a simplification, not a hidden inaccuracy.
   - Results rendered as cards: title, price/night, bedrooms, location, a short list of matched attributes (from `extracted_attributes`). Note: Phase 5 uses Voyage `rerank-2.5`, which returns a relevance score, not a generated explanation — there is no per-result reasoning text to display (deliberate speed-over-explanation tradeoff, see `specs/06-reranking.md`). Do not build UI expecting a `reasoning` field; it doesn't exist. `relevanceScore` is nullable (candidates beyond Phase 5's 20-item cap are appended unscored) — omit any score indicator for `null`, never display it as `0`.
   - If the response has `filtersRelaxed: true`, show a visible note that filters were relaxed because they were too narrow.
   - If `degraded: true`, do not show a scary error — the UI should look normal (re-ranking simply fell back to similarity-only order).
2. Naive comparison endpoint: `GET /api/search/naive?q=` on the backend — a trivial `ILIKE` query against `title` + `raw_description`, no AI involved. Add this backend endpoint as part of this phase (small, explicitly scoped here since it only exists to support the UI comparison).
3. A toggle or side-by-side view comparing naive results vs. AI pipeline results for the same query.
4. Tailwind styling, responsive layout, semantic HTML with appropriate ARIA labels on interactive elements. Consult `frontend-design` conventions for visual polish — avoid a generic, unstyled-default look.

## Interfaces

```
GET /api/search/naive?q=<string>
Response: { results: Listing[] }
```

## Non-Functional Requirements

- Usable on mobile viewport widths (responsive, not just "doesn't break").
- No layout shift/flicker between loading stages.

## Explicit Out of Scope

- No user accounts, saved searches, or search history.
- No real-time streaming of backend timing data (simulated stages are acceptable per requirement #1).

## Acceptance Criteria

- [ ] Full flow works end-to-end against the real backend (not mocked) for at least 5 manual test queries.
- [ ] The naive-vs-AI comparison view, shown side by side for a query like "pet friendly cabin with mountain view," makes the difference in relevance obvious without needing an explanation.
- [ ] `filtersRelaxed` and `degraded` states are both manually triggered (via test conditions) and confirmed to render sensibly, not as raw error states.
- [ ] Page passes a basic accessibility check (labeled input, keyboard-navigable submit, sufficient color contrast).
- [ ] Verified responsive at common mobile and desktop breakpoints.

## Open Questions Claude Code Should Ask If Unclear

- Whether the naive/AI comparison is a toggle (one view at a time) or true side-by-side columns — confirm the preferred layout before building, since it affects component structure.