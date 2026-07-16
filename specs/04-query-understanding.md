# Spec 04 — Phase 3: Query Understanding Service

**Status:** Ready
**Branch:** `phase-3-query-understanding`
**Depends on:** Phase 0

## Context

Parses a natural language query into structured filters (things we can enforce exactly in SQL) plus a semantic remainder (things vector search should handle). The critical judgment call this service makes: only extract something as a hard filter if the query is genuinely explicit about it — vague/subjective language must fall through to semantic search, not be forced into a filter it doesn't confidently support.

## Functional Requirements

1. `understandQuery(rawQuery: string): Promise<QueryIntent>` in `/backend/src/services/search/queryUnderstanding.ts`.
   - Calls Claude (Haiku) via the shared `llm/` wrapper.
   - Returns JSON matching:
     ```ts
     type QueryIntent = {
       filters: {
         pet_friendly: boolean | null;
         property_type: string | null;
         min_bedrooms: number | null;
         max_price: number | null;
       };
       semantic_query: string;
     }
     ```
   - System prompt rule (must be explicit in the prompt, not just this spec): a filter field is only populated if the query explicitly or very clearly implies it. Vague/subjective terms ("cozy," "quiet," "great view," "close to town") must NOT become filters — they remain part of `semantic_query`.
   - Response validated with `zod`; on parse failure, retry once with error-correction context.
2. A test script `/backend/src/scripts/testQueryUnderstanding.ts` that runs `understandQuery` against a fixed array of at least 15 representative queries (covering: explicit hard constraints, vague/subjective queries, numeric constraints like price/bedrooms, and mixed queries combining both) and prints the extracted intent for manual review.

## Interfaces

```ts
understandQuery(rawQuery: string): Promise<QueryIntent>
```

## Non-Functional Requirements

- Target latency ~200-400ms per call (Haiku, small prompt/response).

## Explicit Out of Scope

- No retrieval logic here — this service only produces intent, it doesn't query the database (that's Phase 4).
- No conversation/multi-turn query refinement.

## Acceptance Criteria

- [ ] For the query "pet friendly cabin with mountain view": `filters.pet_friendly = true`, `filters.property_type` reflects "cabin" or is left null with "cabin" folded into `semantic_query` (either is acceptable — document which choice was made and why), `semantic_query` includes the mountain view intent.
- [ ] For a vague query like "somewhere cozy and quiet for a weekend": all `filters` fields are `null`, and the full sentiment is preserved in `semantic_query`.
- [ ] For "cheap studio near the beach": `filters.property_type` reflects "studio" appropriately and/or `max_price` is populated only if "cheap" is treated as a soft/semantic term, not hallucinated into a specific number — document the chosen behavior since "cheap" has no explicit numeric value in the query.
- [ ] All 15 test queries in the test script produce valid, schema-conformant output with no crashes.
- [ ] Malformed/unparseable model output triggers exactly one retry, not an infinite loop or a crash.

## Open Questions Claude Code Should Ask If Unclear

- How to handle a soft quantitative term like "cheap" or "affordable" that has no explicit number — flag this as a judgment call to confirm rather than silently deciding.
