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

## Post-Merge Amendment (found during Phase 7 manual testing)

**Gap found:** `QueryIntent.filters` had no `location` field at all — a search for "Manali" had nowhere to put the place name except `semantic_query`, meaning location was only ever a soft vibe signal, never an enforced constraint. A search for a specific place could and did surface listings from unrelated regions purely on semantic similarity (e.g. other Himalayan hill towns ranking highly for "Manali" searches). For a rental marketplace, location is normally the single most non-negotiable constraint a user has — this is a real gap, not a nice-to-have.

**Fix:** add `location: string | null` to `QueryIntent.filters`.

```ts
type QueryIntent = {
  filters: {
    pet_friendly: boolean | null;
    property_type: string | null;
    location: string | null;
    min_bedrooms: number | null;
    max_price: number | null;
  };
  semantic_query: string;
}
```

**Extraction rule** (same "only if explicit" principle as every other filter): populate `location` only when the query names a real place (city, region, landmark-adjacent area) — e.g. "Manali," "Goa," "near Cubbon Park." Do not populate it from vague locational language ("somewhere remote," "close to the city") — that stays in `semantic_query`. The place name should still also remain in `semantic_query` in its original phrasing (same redundancy-is-harmless reasoning already applied to `property_type`), since it may carry vibe/context beyond pure geography (e.g. "Goa" implies beach/coastal aesthetic, not just a filter value).

## Acceptance Criteria (amendment)

- [ ] For "pet friendly cottage in Manali": `filters.location` captures "Manali" (or "Manali, Himachal Pradesh" — either acceptable, document which), in addition to the existing `pet_friendly`/`property_type` extraction.
- [ ] For a query with no place name ("cozy quiet weekend getaway"): `filters.location` is `null`, not hallucinated from vague words.

## Open Questions Claude Code Should Ask If Unclear

- Whether `location` should capture just the city ("Manali") or the full string as written ("Manali, Himachal Pradesh") — either is acceptable, document the choice since it affects how Phase 4's SQL match needs to work (substring match handles either correctly, but consistency matters for eval test cases).