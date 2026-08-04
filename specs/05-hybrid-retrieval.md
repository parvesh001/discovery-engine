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

## Post-Merge Amendment (companion to spec 04's `location` addition)

**Gap:** with no `location` filter, a search for "Manali" could surface listings from unrelated regions purely on semantic similarity to Himalayan hill-town language — a real problem for a rental marketplace, where location is normally the most non-negotiable constraint. Now that Phase 3 (spec 04) extracts `filters.location`, this stage must enforce it in SQL, per `CLAUDE.md` rule #2.

**Fix — `location` filter clause:**
```sql
location ILIKE '%' || $n || '%'
```

**Why substring match here, unlike `property_type`'s exact match:** `property_type` is confirmed as case-insensitive *exact* match (Phase 4's original confirmed decision), because it's a short standalone value ("cabin," "studio"). `location` is different: the `listings.location` column stores full strings like `"Manali, Himachal Pradesh"`, while an extracted filter value is typically just the city (`"Manali"`). An exact match would fail every real case. Substring match is the correct, deliberate choice for this field specifically — not an inconsistency with the `property_type` decision, a different data shape requiring a different match strategy.

**Interaction with filter relaxation:** unchanged — relaxation still drops *all* filters together (not selectively) when the filtered result set is too narrow, consistent with the existing design. This means a location-narrow search can still surface other-region results, but only when `filtersRelaxed: true` is explicitly set and surfaced to the caller — turning the original silent bug into an honest, labeled fallback instead of removing the possibility outright.

## Acceptance Criteria (amendment)

- [ ] A query with `filters.location = "Manali"` never returns a listing whose `location` column doesn't contain "Manali" as a substring, *unless* `filtersRelaxed: true` is also set.
- [ ] Verify case-insensitivity: `"manali"` and `"Manali"` match identically.
- [ ] A location-narrow query that would return zero/few results still triggers relaxation correctly (existing relaxation logic, verified still works with the new filter added to the WHERE clause).

## Post-Merge Amendment: hard/soft filter tiers in relaxation (`fix/hard-soft-filter-relaxation`)

**Gap:** the relaxation fallback above (and the location amendment before it) treats
`intent.filters` as one undifferentiated bag — when the filtered result count drops below
`MIN_CANDIDATES_BEFORE_RELAXATION`, every filter is dropped together, with no distinction
between them. Real usage surfaced this as a genuine bug, not just a ranking nuance: searching
"pet friendly houses in Goa" set `filtersRelaxed: true` and dropped `pet_friendly` along with
`location`, so a listing whose own description states "prohibits pets entirely, no exceptions"
ranked above genuinely pet-friendly listings. Showing a result that directly contradicts a
stated dealbreaker isn't broader results, it's actively misleading — a trust problem, not a
ranking nuance.

**Fix — two filter tiers, not one undifferentiated set:**

- **Hard tier — `pet_friendly`, `max_price`, `min_bedrooms`.** Applied unconditionally, in every
  query, and **never dropped by relaxation**, even if that leaves the result set thin or empty.
- **Soft tier — `property_type`, `location`.** Applied when present; **droppable** by relaxation
  to avoid an empty/thin page.

**Why this split, field by field:**

- `pet_friendly` — the anchoring example. A pet owner cannot book a no-pets unit; showing one
  isn't a broader interpretation of the search, it's wrong.
- `max_price` — spec 04's extraction prompt (`queryUnderstanding.ts`) populates this field only
  from an explicit stated number/comparator, never inferred from soft language like "cheap" or
  "affordable" (those stay in `semantic_query` instead). So whenever it's non-null, the user
  stated a real number, not a vibe — the same binary-eligibility shape as `pet_friendly`. Showing
  a ₹14,000/night villa to someone who said "under ₹2000" is the same category of harm: they
  cannot act on it.
- `min_bedrooms` — same reasoning shape: populated only from an explicit stated count ("at least
  3 bedrooms," "3BR"), never inferred from soft language like "family-sized." When present it
  states a real physical-capacity floor — the group won't fit in fewer bedrooms. Showing a
  1-bedroom to someone who said "at least 4 bedrooms" isn't a broader match, it's unusable.
- `property_type` — an exact-match `ILIKE` against a short label an LLM assigned to free-text
  prose ("cabin" vs. "cottage" vs. "chalet" vs. "log cabin" — this file's own filter-clause
  comments already flag the near-synonym risk). This is a vocabulary/labeling-alignment problem,
  not a stated eligibility requirement; relaxing it recovers from extraction/wording mismatch,
  it doesn't violate a stated constraint.
- `location` — already treated as relaxable by the amendment above (substring match against a
  compound "City, State" column, explicitly documented there as an "honest, labeled fallback").
  Notably, in the Goa bug report, dropping `location` was never the misleading part — dropping
  `pet_friendly` was. Consistent with `location` being fundamentally a "broaden the geography"
  relaxation, not a dealbreaker violation.

**The dividing line, stated as a rule:** fields `queryUnderstanding.ts` populates *only* from an
explicit, unambiguous statement (a number, a boolean pet requirement) encode real eligibility —
never soften them. Fields that are inherently label/category matches prone to
extraction-vocabulary mismatch (a place-name substring, a property-type noun-phrase) are safe to
relax, because relaxing them recovers from a data/wording problem rather than ignoring what the
user asked for.

**Interaction with `MIN_CANDIDATES_BEFORE_RELAXATION`:** the threshold value and meaning are
unchanged (still 5, still "fewer than this triggers a fallback query"). What changes is when
relaxation is eligible to fire, and what the fallback query drops:

1. Always run one query with every applicable filter (hard + soft) applied via SQL `WHERE`,
   same as before.
2. Relaxation is only attempted if soft filters (`property_type` and/or `location`) were actually
   present in the query *and* the fully-filtered result count is below the threshold. A query
   with only hard filters and a thin or even empty result set does **not** trigger relaxation —
   there's nothing soft to drop, so that thin/empty hard-filtered set is returned as-is, with
   `filtersRelaxed: false`. This is a deliberate behavior change from the original design (which
   would relax a hard-only thin query down to zero filters).
3. When relaxation does fire, the fallback query re-runs with only the hard filters — soft
   filters dropped, hard filters still enforced in SQL. `filtersRelaxed: true`.
4. No second-level relaxation, ever. If the hard-only fallback is itself still thin or zero rows,
   that's the final answer — there is no further cascade to drop hard filters too.

## Acceptance Criteria (hard/soft tier amendment)

- [ ] A query combining a hard filter (e.g. `pet_friendly: true`) with a soft filter narrow
      enough to trigger relaxation (e.g. an unmatched `location`) never returns a listing that
      fails the hard filter, even though `filtersRelaxed: true`.
- [ ] Same property verified independently for `max_price` and `min_bedrooms` as the hard filter.
- [ ] A query with only hard filters and a thin/zero-match result set reports
      `filtersRelaxed: false` and returns the thin/empty hard-filtered set — it does not fall
      back to unconstrained semantic ranking.
- [ ] A query where dropping soft filters still leaves a thin hard-filtered result set does not
      cascade to a second relaxation — the returned set stays exactly as small as the hard-only
      query produces, never merging in results that fail a hard constraint.

## Open Questions Claude Code Should Ask If Unclear

- Exact threshold for "few results" that triggers filter relaxation (spec says <5 — confirm this is the intended number before hardcoding it as a magic constant; put it in a named config value regardless). *(Original question, still applies; no new open questions from this amendment.)*