# Spec 12 — Phase 11: Location-Scoped Demo Experience

**Status:** Ready
**Branch:** `phase-11-location-scoped-search`
**Depends on:** Phase 2 (ingestion), Phase 6 (backend API), Phase 7 (frontend), Phase 10 (deployment)

## Context

The deployed system is a client-facing demo. Today it drops the visitor straight onto a
single global search box over a 36-listing mixed-geography dataset. Two problems for a
demo: (1) there is nothing to look at before you type, so the value of the pipeline is
invisible until the visitor already knows what to search for; (2) global search means a
"pet friendly cottage" query returns results from unrelated regions, which muddies the
naive-vs-AI comparison the demo exists to show.

This phase adds a location-scoped experience on top of the existing pipeline — pick a
destination first, browse everything there with a plain query, then search *within* that
destination — and swaps in a larger, purpose-built 72-listing demo dataset across two
destinations (Manali and Goa). The existing 36-listing dataset is retained unchanged for
the eval suite, which depends on specific listings in it (the Goa pet-friendly
trust-bug regression case and the adversarial-injection case).

Nothing about the query-understanding / retrieval / rerank pipeline itself changes. The
destination is a new, **authoritative** scope applied around the pipeline — never inferred
from free text, never relaxed.

## Decisions Locked During Review

- **Destination is a real schema column** (`listings.destination`), not `location`
  substring matching. The consolidated Manali dataset includes listings whose `location`
  string is Kasol / Tosh / Manikaran / Naggar / Aut / Kothi / Gulaba — substring scoping
  would silently drop them. A column makes the scope exact and relaxation-proof.
- **`seed-data.ts` is renamed** to `seed-eval-data.ts` (export `evalSeedListings`), giving
  the eval and demo datasets symmetrical, self-describing names. Contents unedited.
- **The frontend mirrors the backend destination registry as a local constant.** No
  `GET /api/destinations` endpoint for a two-item hardcoded list.
- **An extracted `QueryIntent.filters.location` that restates the picked destination is
  left to apply as a redundant soft filter** — consistent with spec 04's
  "redundancy is harmless" stance. The authoritative destination bound is enforced
  independently and always wins.
- **The demo DB and the eval/CI/test DB are strictly separate.** Demo = the deploy
  database, seeded via `seed:demo`. Eval/CI/test = seeded via `seed`. The
  `destination = $1` filter also naturally excludes NULL-tagged eval rows if the two ever
  coexist.
- **The Manali/Goa split of the 72 listings is authoritative as the source file groups
  it** — the "same crowd" entries (Kasol, Tosh, Manikaran, Kullu-valley) are intended to
  show under Manali.

## Functional Requirements

### 1. Destination scope — data model & registry

1. Add a nullable `destination TEXT` column to `listings` (versioned `.sql` migration in
   `/backend/migrations`, consistent with the existing approach). Add a partial index:
   `CREATE INDEX idx_listings_destination ON listings (destination) WHERE destination IS NOT NULL;`
2. `destination` holds a lowercase slug (`'manali'`, `'goa'`) for demo-dataset rows and is
   left `NULL` for eval-dataset rows. It is written only by the demo seed script
   (requirement 4) — never by ingestion, never from user input.
3. A single shared registry, `backend/src/config/destinations.ts`, is the source of truth:
   ```ts
   export type Destination = { slug: string; label: string };
   export const DESTINATIONS: Destination[] = [
     { slug: 'manali', label: 'Manali' },
     { slug: 'goa', label: 'Goa' },
   ];
   export const DESTINATION_SLUGS = DESTINATIONS.map((d) => d.slug); // for zod enums
   ```
4. Every `destination` value received over HTTP is validated against `DESTINATION_SLUGS`
   with `zod`. An unknown or missing-where-required slug is a `400` with the existing
   `{ error: string }` shape — never a silent empty result, never a silent fallback to
   global.
5. The frontend carries a mirrored constant (e.g. `frontend/app/search/destinations.ts`)
   with the same `{ slug, label }` pairs. A comment in each file points at the other as
   the thing to keep in sync. A lightweight test asserts the two lists are identical.

### 2. Browse endpoint (no AI pipeline)

1. `GET /api/listings?destination=<slug>` in `/backend/src/routes/listings.ts` (new
   router, registered in `app.ts`).
2. Plain parameterized SQL — no LLM, no embedding, no rerank:
   ```sql
   SELECT <listing columns>
   FROM listings
   WHERE ingestion_status = 'processed'
     AND destination = $1
   ORDER BY price_per_night ASC NULLS LAST, id ASC
   ```
   Deterministic order, price ascending. (`created_at` is uniform across a single seed
   batch, so recency ordering would be arbitrary without deliberately staggering
   timestamps — price ascending is the sensible, stable choice.)
3. `destination` is **required** on this endpoint. Missing or unknown → `400`.
4. Returns `{ results: Listing[], destination: string }`, `Listing` being the exact shape
   `/api/search/naive` already returns (`id, title, raw_description, price_per_night,
   bedrooms, location, latitude, longitude, extracted_attributes, ingestion_status`).
5. Shares the existing IP rate limiter with the other search routes.
6. No pagination — each destination holds ~35–37 listings; return all matches.
7. Only `ingestion_status = 'processed'` rows are returned, matching naive search's
   existing behavior. On a deployed demo, ingestion is run to completion before traffic;
   a partially-ingested destination showing fewer rows is acceptable and expected only
   during that window.

### 3. Destination-scoped search & naive comparison

1. `POST /api/search` request body gains an **optional** `destination` field:
   `{ query: string, destination?: string }`, validated against `DESTINATION_SLUGS`.
   - Present: threaded into retrieval as a hard, non-relaxable scope (below).
   - Absent: exactly today's global behavior — backward-compatible, so the eval harness
     and any existing caller are unaffected.
   - Unknown slug: `400` (no fallback to global).
2. `GET /api/search/naive` gains an optional `destination` query param with the same
   validation and the same "absent = global" semantics.
3. `retrieveCandidates(pool, intent, langfuseParent?, destinationScope?: string)` gains a
   final optional argument. When set, `AND destination = $n` is appended to the **base**
   `WHERE` in `runCandidateQuery` — alongside `ingestion_status = 'processed'` — so it is
   present in **both** the fully-filtered pass and the relaxed hard-only pass. Relaxation
   never removes it. `orchestrateSearch.ts` / `runSearch` threads the request's
   destination straight through.
4. `naiveSearchListings(pool, query, destinationScope?: string)` gains the same optional
   argument and ANDs `destination = $n` into its `WHERE`.
5. `understandQuery` is **not** modified and is **not** consulted for the destination.
   `QueryIntent.filters.location` continues to be extracted and applied exactly as today
   (a soft, relaxable filter); within a scoped search it can still narrow to a sub-area
   the user names ("near Vashisht"), while the authoritative destination bound is
   enforced independently.
6. Response shapes are unchanged. `filtersRelaxed` continues to describe only the
   soft-filter tier — the destination scope is never reported as relaxed because it never
   is.
7. Both `retrieveCandidates` and `naiveSearchListings` are shared functions; per repo
   convention their signature change is preceded by a full consumer grep audit
   (`orchestrateSearch.ts`, `routes/search.ts`, `testRetrieval.ts`, and every `.test.ts`
   touching them), and the ripple is landed with `lint` / `test` / `build` green after
   each file. The argument is optional and additive specifically to keep every existing
   call site compiling untouched.

### 4. Datasets — structure & seeding

1. **The eval dataset is preserved unchanged.** `backend/src/scripts/seed-data.ts`
   (36 listings, `export const seedListings`) is renamed to
   `backend/src/scripts/seed-eval-data.ts` exporting `export const evalSeedListings`.
   Contents are not edited. All consumers are updated in one audited pass:
   `seed.ts`, `seed-data.test.ts` → `seed-eval-data.test.ts`, and the sync comment in
   `backend/src/evals/testCases.ts`. `seed-eval-data.test.ts` keeps its existing
   assertions in substance (exactly 36 listings, ₹800–₹18,000 band, bedrooms 0–6,
   pet-policy and view-type variety, long-tail count).
2. `SeedListing` is defined once. Hoist the interface to a shared module (e.g.
   `backend/src/scripts/seedTypes.ts`) and have both datasets import it — do not carry a
   third copy of the interface.
3. **New file** `backend/src/scripts/seed-demo-data.ts` — the cleaned 72-listing set from
   the supplied `final-consolidated-listings.ts` (35 Manali + 37 Goa):
   - UTF-8 mojibake in the source (`â`, `Ã©`, `dÃ©cor`, `cafÃ©`, `â` em-dashes, …) is
     repaired to the correct characters on import.
   - Exports `manaliListings: SeedListing[]`, `goaListings: SeedListing[]`, and a combined
     `demoListings: Array<SeedListing & { destination: string }>` where each Manali entry
     is tagged `destination: 'manali'` and each Goa entry `destination: 'goa'`.
4. **New script** `backend/src/scripts/seed-demo.ts`, exposed as
   `pnpm --filter backend run seed:demo`:
   - Mirrors `seed.ts`: load `dotenv`, `TRUNCATE TABLE listings CASCADE` inside a
     transaction, bulk insert. Additionally writes the `destination` column from each
     row's tag.
   - `extracted_attributes` / `embedding` left `NULL`; `ingestion_status` defaults to
     `'pending'` — identical to the eval seed's contract, so the existing
     `ingest` → `ingest:worker` flow processes the demo rows with no changes.
   - Idempotent / safe to re-run.
   - Targets `DATABASE_URL` (the deploy database). It inherits the *"`seed` has no guard
     against running against a populated database"* gap already tracked in
     `specs/00-architecture.md` — this phase does not close it. `DEPLOYMENT.md`'s manual
     warning is extended to cover `seed:demo` at the same severity as `seed`.
5. **New test** `backend/src/scripts/seed-demo-data.test.ts`:
   - Asserts exactly 72 combined listings, 35 tagged `manali`, 37 tagged `goa`.
   - Asserts every combined row carries a `destination` of `'manali'` or `'goa'`.
   - Basic sanity only on price/bedrooms (positive numbers) — it must **not** reuse the
     eval band assertions: the demo set intentionally exceeds ₹18,000 (Goa villas up to
     ₹22,000).
   - Asserts no duplicate `rawDescription` across the combined set.
6. `seed.ts` (now seeding `evalSeedListings`) and `pnpm --filter backend run seed` are
   unchanged in behavior — still the local / CI / test path, still 36 rows, `destination`
   NULL.
7. **The eval suite (`testCases.ts`, `runEvals.ts`) is not modified and never touches the
   demo dataset.** CI seeds `evalSeedListings`. The Goa pet-friendly trust-bug regression
   case (`Beach House Near Calangute Market` / `Portuguese Quarter Flat, Fontainhas`) and
   the adversarial-injection case (`Riverside Studio, Rishikesh`) keep referencing their
   original listings.

### 5. Frontend — picker + browse-before-search

1. `/frontend/app/search` gains a destination step ahead of the search box:
   - First load, no destination chosen: render only the picker (Manali / Goa). No results
     area, no empty naive/AI columns.
   - The selected destination is reflected in the URL as `?destination=<slug>` (shareable,
     reload-stable for the demo). Loading with a valid `?destination=` goes straight to
     the browse view; an invalid slug falls back to the picker.
2. **Browse view** (destination chosen, search box empty): on selection / load, call
   `GET /api/listings?destination=<slug>` and render results with the existing
   `ListingCard` in a single list (not the two-column compare layout). A heading names the
   destination and the result count. No AI, no pipeline trace. If the destination has zero
   processed listings, show a plain "nothing to show yet" state, not an error.
3. **Search view** (destination chosen, query submitted non-empty): the existing
   naive-vs-AI comparison, unchanged in layout and behavior, except both requests carry
   `destination`:
   - `POST /api/search` body `{ query, destination }`.
   - `GET /api/search/naive?q=<query>&destination=<slug>`.
   - Copy makes the scope explicit ("Searching within Manali").
4. Clearing the query back to empty returns to the browse view without a full reload.
   Changing the destination re-runs browse and clears any active query and results.
5. A visible affordance to change destination is present in both views.
6. Tailwind, responsive, semantic HTML with ARIA: the picker has radio-group semantics,
   the search input keeps its Phase 7 labeling.

## Interfaces

```
GET /api/listings?destination=<slug>
  200: { results: Listing[], destination: string }
  400: { error: string }                        // missing / unknown destination

POST /api/search
  Request: { query: string, destination?: string }   // destination optional, additive
  400 on unknown destination slug; response body shape otherwise unchanged from Phase 6

GET /api/search/naive?q=<string>&destination=<slug>   // destination optional
  Response shape unchanged from Phase 7

// Backend service signatures (additive, optional trailing params — no call-site breakage):
retrieveCandidates(pool, intent, langfuseParent?, destinationScope?: string)
naiveSearchListings(pool, query, destinationScope?: string)
```

New command:
```
pnpm --filter backend run seed:demo    // TRUNCATE + load the 72-listing demo dataset (destructive)
```

## Non-Functional Requirements

- The browse endpoint is a single indexed SQL query; target < 100ms server-side.
- The destination scope MUST be enforced in SQL as a `WHERE` clause on every path
  (browse, AI search, naive search) — never by post-filtering in JS, never by relying on
  embedding similarity (CLAUDE.md rule #2).
- Adding `destination` to a `/api/search` request MUST NOT change results for callers that
  omit it — verified by the eval suite continuing to pass unchanged.
- Browse results populate on page load / destination selection with no layout shift when
  they arrive, consistent with Phase 7's no-flicker requirement.
- All new HTTP inputs validated with `zod` (CLAUDE.md rule #5).
- The destination scope is never surfaced as `filtersRelaxed` — it is not a relaxable
  filter.

## Explicit Out of Scope

- No third destination and no dynamic / admin-managed destination list — the two are a
  hardcoded registry this phase.
- No true geolocation / radius / landmark-proximity search — still scope + text matching
  only. The two newly-recorded gaps in `specs/00-architecture.md` are documented, not
  built.
- No `min_price` / price-range filtering — newly recorded in `specs/00-architecture.md`,
  not built here.
- No pagination, infinite scroll, or sort controls on the browse view (fixed price-asc
  order).
- No map UI, no geolocation capture.
- No change to query understanding, retrieval ranking, rerank, caching, or observability
  beyond threading one optional scope argument.
- No migration of the deployed database's existing rows to a `destination` value — the
  demo DB is wiped and re-seeded by `seed:demo`.
- Eval dataset content, `testCases.ts`, and `runEvals.ts` are untouched. Destination-scoped
  eval coverage is therefore deferred — the eval dataset stays `destination: NULL` and the
  harness keeps issuing unscoped queries. Recorded as a future enhancement in
  `specs/00-architecture.md` for a dedicated later phase (at minimum: a cross-destination
  "must never leak Manali → Goa" case, plus a paired in-destination-relevance case).

## Acceptance Criteria

- [ ] Migration adds `listings.destination` + the partial index; `migrate:up` and
      `migrate:down` both succeed.
- [ ] `pnpm --filter backend run seed:demo` loads exactly 72 rows — 35 with
      `destination = 'manali'`, 37 with `destination = 'goa'`, 0 NULL — and is safely
      re-runnable.
- [ ] `pnpm --filter backend run seed` still loads exactly 36 rows, all `destination`
      NULL; `seed-eval-data.test.ts` passes unchanged in substance.
- [ ] Full eval suite (`pnpm --filter backend run eval`) passes at or above its existing
      threshold with no edits to `testCases.ts` — including the Goa pet-friendly
      trust-bug case and the adversarial-injection case.
- [ ] `GET /api/listings?destination=manali` returns only Manali-tagged processed
      listings in price-ascending order; `?destination=goa` likewise; missing or unknown
      slug → `400`.
- [ ] After `seed:demo` + ingestion, `POST /api/search { query: "pet friendly cottage",
      destination: "manali" }` returns only Manali listings; a Goa listing never appears
      regardless of semantic similarity.
- [ ] With filters forced narrow enough to trigger relaxation, the relaxed pass still
      returns only in-destination listings (scope survives relaxation).
- [ ] `POST /api/search { query }` with no `destination` returns results identical to
      pre-phase behavior for a sample of eval queries.
- [ ] Frontend: a fresh load shows only the picker; choosing Manali populates a browse
      list on load and sets `?destination=manali`; reloading that URL lands directly on
      the Manali browse view.
- [ ] Typing and submitting a query switches to the naive-vs-AI compare view scoped to
      the chosen destination; clearing the query returns to browse; switching destination
      resets the query and re-browses.
- [ ] `DEPLOYMENT.md` documents `seed:demo` as the production catalogue loader with a
      data-loss warning at the same severity as the existing `seed` warning, and its
      post-deploy smoke test covers a browse check and a scoped-search check per
      destination.
- [ ] `pnpm lint`, `pnpm --filter backend test`, and `pnpm --filter backend run build`
      (`tsc`) all green (CLAUDE.md verification loop).

## Open Questions Claude Code Should Ask If Unclear

- Exact browse-view heading copy and the "change destination" affordance's placement /
  wording — pick something clean and confirm during implementation rather than guessing at
  final copy now.
- Whether the "back to browse" transition is triggered purely by the search input going
  empty, or also needs an explicit button — confirm the interaction before building the
  component, since it affects state structure in `useSearch`.
