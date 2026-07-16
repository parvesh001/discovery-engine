# Spec 02 — Phase 1: Dummy Data Generation

**Status:** Ready
**Branch:** `phase-1-dummy-data`
**Depends on:** Phase 0

## Context

We're simulating a real client's messy catalog. If the dummy data is clean and consistent, later phases (attribute extraction, semantic retrieval) will look artificially good and won't prove anything. The dataset must be deliberately inconsistent, the way real user-generated listing content actually is.

## Functional Requirements

1. Create the `listings` table per the schema in `specs/00-architecture.md` (migration, not ad hoc SQL — use whatever lightweight migration approach fits the stack, e.g. `node-pg-migrate` or raw versioned `.sql` files in a `/backend/migrations` folder).
2. A seed script (`pnpm --filter backend run seed`) that inserts 35 listings.
3. Content requirements for the 35 listings:
   - The same underlying attribute must be expressed differently across listings. Specifically ensure variance for: pet policy (explicit "pet friendly", implicit via amenities list, explicit "no pets", unmentioned), view type (explicit "mountain view", paraphrased "overlooks the valley", unmentioned but inferable from location), and general amenities phrasing.
   - At least 5 "long-tail" listings: unusual property types (e.g. yurt, houseboat, treehouse) and/or very sparse descriptions (1-2 sentences) — these exist specifically to test later whether the system can surface niche listings that don't use conventional language.
   - Realistic structured fields: `price_per_night` in the $50–$800 range, `bedrooms` from studio (0) to 6, `location` covering a mix of mountain towns, coastal towns, and cities, with corresponding realistic lat/long.
4. `extracted_attributes` and `embedding` must be left `NULL` on insert; `ingestion_status` defaults to `'pending'`.
5. The seed script must be idempotent — safe to re-run (truncate/clear listings before reinserting, or upsert on a stable identifier).
6. Listing content should be generated into a separate, human-reviewable file (e.g. `seed-data.ts` as a plain exported array) so the actual text can be reviewed before it's inserted — do not generate and insert in the same opaque step.

## Interfaces

- `pnpm --filter backend run seed` — CLI script, no HTTP endpoint required for this phase.

## Non-Functional Requirements

- Re-running the seed script must not create duplicate rows or accumulate garbage data across runs.

## Explicit Out of Scope

- No attribute extraction or embedding generation — that's Phase 2.
- No API endpoint to fetch listings yet.

## Acceptance Criteria

- [ ] `pnpm --filter backend run seed` populates exactly 35 rows in `listings`.
- [ ] Manual review of `seed-data.ts` confirms genuine inconsistency in how pet policy and view type are expressed across listings (not just templated find/replace variations of the same sentence).
- [ ] At least 5 listings are clearly identifiable as "long-tail" per the definition above.
- [ ] All 35 rows have `ingestion_status = 'pending'`, `extracted_attributes IS NULL`, `embedding IS NULL`.
- [ ] Running the seed script twice in a row results in exactly 35 rows, not 70.

## Open Questions Claude Code Should Ask If Unclear

- Whether listing content should be hand-written or LLM-generated-then-reviewed — if generating via LLM, flag that the output needs a human review step before being treated as final, per this spec's requirement #6.
