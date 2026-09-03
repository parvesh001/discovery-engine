# Spec 00 — Architecture & Data Model

**Status:** Approved (reference document — not implemented directly, referenced by every phase)

## Context

Users can't find relevant listings because search relies on keyword matching, weak filters, and rule-based ranking. This system replaces that with intent understanding, hybrid retrieval, and learned re-ranking, built as a pipeline of small, purpose-built stages rather than one large AI call.

## System Diagram

```
┌──────────────┐        ┌──────────────────────────────────────────────┐
│   Next.js     │        │              Node.js Backend (Express)         │
│   Frontend    │◄──────►│                                                │
│  (search UI)  │  REST  │  ┌────────────┐  ┌────────────┐  ┌──────────┐ │
└──────────────┘        │  │  Query      │  │  Retrieval  │  │ Re-rank  │ │
                         │  │Understanding│─►│   Engine    │─►│  Layer   │ │
                         │  │  Service    │  │  (hybrid)   │  │          │ │
                         │  └─────┬──────┘  └──────┬──────┘  └────┬─────┘ │
                         │        └────────────────┴──────────────┘       │
                         │                     │                          │
                         │                     ▼                          │
                         │        Claude API (shared llm/ wrapper)        │
                         │                     │                          │
                         │                     ▼                          │
                         │       PostgreSQL + pgvector                    │
                         │   (structured columns + embeddings)            │
                         │                     ▲                          │
                         │                     │                          │
                         │         Ingestion Pipeline (offline)           │
                         └──────────────────────────────────────────────┘
```

Query-time flow: `user query → Query Understanding → Hybrid Retrieval → Re-ranking → response`
Ingestion-time flow (per listing, on create/update): `raw listing → attribute extraction → structured columns → embedding → stored`

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Next.js (App Router), TS, Tailwind | Matches existing skillset |
| Backend | Node.js + Express + TS, isolated service | Independently scalable, mirrors real client infra |
| Database | PostgreSQL + pgvector | One DB for structured + vector data, production-viable with HNSW |
| Embeddings | Voyage AI — `voyage-4`, 1024 dims, `input_type: document`/`query` | Anthropic-recommended embeddings partner; asymmetric input_type per Voyage's retrieval convention (see `specs/03-ingestion-pipeline.md`, `specs/05-hybrid-retrieval.md`) |
| LLM | Claude API — Haiku (extraction/query understanding) | Cost-tiered: cheap/fast model for high-frequency small tasks |
| Reranker | Voyage AI — `rerank-2.5` (re-ranking, Phase 5) | Cross-encoder reranker, ~600ms latency vs. ~30-50s for a generative-model approach tried and rejected during Phase 5 (see `specs/06-reranking.md`); no generated reasoning text, score-only |
| Queue/Cache | BullMQ + Redis (Phase 9+) | Async ingestion, query caching |
| Observability | Langfuse (self-hosted) | Full LLM call tracing. *(2026-07-28, Phase 8: started on Langfuse Cloud's free tier instead — no self-hosted instance stood up yet. Self-hosting means adding Postgres/ClickHouse/MinIO/Redis + langfuse-web/worker containers, deferred as a pragmatic first step. Revisit before this goes to a real client engagement.)* |
| Deployment | Vercel (frontend) + Render (backend + managed Postgres) | Confirmed. Realistic prod topology, cheap tiers sufficient |
| Source control / CI | GitHub + GitHub Actions | Confirmed |

## Data Model

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  raw_description TEXT NOT NULL,
  price_per_night NUMERIC,
  bedrooms INT,
  location TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  extracted_attributes JSONB,
  embedding VECTOR(1024), -- Voyage voyage-4, output_dimension: 1024 (see Tech Stack; corrected from an initial 1536 during Phase 2)
  ingestion_status TEXT DEFAULT 'pending',  -- pending | processed | failed
  ingested_at TIMESTAMPTZ
);

CREATE INDEX idx_listings_embedding ON listings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_listings_attributes ON listings USING gin (extracted_attributes);

CREATE TABLE search_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_query TEXT NOT NULL,
  extracted_intent JSONB,
  candidate_ids UUID[],
  ranked_ids UUID[],
  latency_ms INT,
  model_calls JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Non-Functional Requirements (apply to every phase)

- P95 end-to-end search latency < 1.5s
- Every LLM call: timeout + 1 retry on transient/parse failure + defined fallback
- Every search request logged with full reasoning trace (`search_logs`)
- No stage failure should produce a blank/broken result for the user — degrade, don't crash

## Documented Future Enhancements

- **True geolocation search (proximity / radius, not text matching).** The location filter (added post-Phase-7, see `specs/04-query-understanding.md` and `specs/05-hybrid-retrieval.md` amendments) is text substring matching against the `listings.location` column, not real coordinate-based search — even though latitude/longitude have existed in the schema since Phase 1. A genuine "near me" or radius search ("within 50km of Manali," proximity to a landmark rather than a city-name match) would require: (1) a geocoding step converting extracted place names into coordinates (OpenStreetMap Nominatim, free, or Google Maps Geocoding, paid), and (2) either the PostGIS extension or a Haversine-distance calculation against the existing lat/long columns. Not built now because there's no location-capture or map UI in the current frontend to justify it — revisit once a real client engagement needs proximity search, not before.

- **Query-understanding latency — distillation into a dedicated NLU model.** `understanding_ms` consistently runs ~1100ms, the dominant cost in total search latency. Production path once real query volume exists: distill Claude's extraction behavior into a fast, purpose-built intent/slot-filling model (or evaluate fast-inference hosting of an open model via Groq/Cerebras as a lower-effort interim step), the same "LLM for flexibility now, dedicated model once data exists" pattern already applied to re-ranking in Phase 5. Not actionable without production query volume to train or validate against.

- **Voyage rate-limit queue is a shared, global capacity ceiling under concurrent load.** Load testing (Phase 9, `backend/LOAD_TEST_REPORT.md`) showed that under 50 simultaneous cache-miss requests, cold-pass P99 latency rises to ~4.5–5s (run-to-run variance from external API contention) — well above the ~2s single-request baseline. Root cause: the single global Voyage rate-limit queue (`backend/src/services/voyage/rateLimiter.ts`) serializes embedding and rerank calls across all concurrent users, so requests queue behind each other rather than running in parallel. This is not a bug — it's a genuine capacity ceiling surfaced by load testing. Production path: move to a higher Voyage pricing tier (raising `VOYAGE_MAX_REQUESTS_PER_MINUTE`), and/or split the rate-limit budget so embedding and rerank calls don't compete for the same queue. Not actionable without real concurrent production traffic to justify the cost.

- **`seed` has no guard against running against a populated database.** `pnpm --filter backend run seed` (`backend/src/scripts/seed.ts`) `TRUNCATE`s `listings` (CASCADE) and reloads the dummy dataset. That is correct for this reference build — the deployed database is demo data — but once this system is deployed for a real client, an accidental `seed` against a database holding real listings would be unrecoverable. Before any real-client use, add an interlock: refuse to run if `listings` already contains more than a small threshold of rows unless an explicit `--force` flag (or a `SEED_ALLOW_NONEMPTY=1` env var) is passed, and have `DEPLOYMENT.md`'s seeding step reference it. Not built in Phase 10 (that phase is infra/config only); flagged here so it isn't lost. Until then, `DEPLOYMENT.md` carries a loud manual warning above the seeding step.

- **Observability failure is fatal at boot rather than degrading.** `backend/src/env.ts` makes `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` required, so if they are unset, revoked, or Langfuse Cloud is unreachable at startup, the whole backend fails `loadEnv()` and crash-loops — taking search down with it, even though tracing is non-essential (the runtime path in `langfuse.ts` already tolerates a missing client and Langfuse errors mid-request). Acceptable for a reference build, where fail-fast on misconfiguration is the Phase 0 principle. Before real production traffic: make the two keys optional in `env.ts`, log a single startup warning when they're absent, and keep serving search with tracing disabled, so a Langfuse outage or a free-tier limit can't take the product offline.

- **Price-range / minimum-price filtering — only `max_price` exists today.** `QueryIntent.filters` (see `specs/04-query-understanding.md`) has a single `max_price` field, and retrieval's hard tier (`buildFilterClauses` in `backend/src/services/search/retrieval.ts`) only ever emits `price_per_night <= $n`. A query like "between ₹1000 and ₹1500 a night" or "at least ₹5000, nothing cheaper" therefore cannot be honored as a hard constraint: the lower bound is silently dropped — best case the query-understanding prompt folds the range into `max_price` and the floor is lost, worst case the whole range stays in `semantic_query` and neither bound is enforced. Nothing in the response distinguishes "we filtered to your range" from "we ignored half of it." Production path: add `min_price: number | null` to `QueryIntent.filters`, extract it under the same "only if explicit" rule as every other filter, and emit a `price_per_night >= $n` clause in the hard tier alongside `max_price`. Small and self-contained — deferred only because no current demo query exercises a price floor. Surfaced during demo-prep query testing (Phase 11).

- **Landmark / proximity phrasing ("near the market," "walk to the club," "close to the fort") has no structured support.** This is the same underlying gap as the "True geolocation search" entry at the top of this list — latitude/longitude sit unused in the schema and the location filter is plain substring matching against `listings.location` — surfacing through a different class of query. Where the geolocation entry frames it as city/radius search ("within 50km of Manali"), demo-prep testing showed the same missing capability behind *intra-destination* phrasing: "near the flea market," "close to Mall Road," "a short walk to the beach." These only "work" when a listing's description happens to reuse the same landmark words, so a genuinely close listing that says "5 minutes from the sand" but never says "market" ranks on embedding coincidence, with no distance logic behind it. Resolution is identical to the geolocation entry (geocode landmarks → PostGIS or Haversine against the existing lat/long columns), and the two should be built together; recorded separately here so the landmark-phrasing symptom isn't mistaken for a distinct, smaller problem. Surfaced during demo-prep query testing (Phase 11).

- **The eval suite has no destination-scope regression coverage.** Phase 11 (`specs/12-location-scoped-search.md`) adds an authoritative, non-relaxable destination filter to retrieval and naive search, but the eval harness (`backend/src/evals/runEvals.ts`) posts `{ query }` with no `destination`, and every row in the eval dataset (`evalSeedListings`) is `destination: NULL` by design — so the pass/fail suite exercises only the global path. The new capability gets Phase 11's unit/integration tests but not the same automated relevance-regression net that protects every pipeline stage built before it. A dedicated later phase should add destination-scoped eval cases: at minimum a query with strong cross-destination semantic pull (e.g. "beachfront villa with a pool") issued with `destination: 'manali'` that must return **zero** Goa listings, plus a paired case confirming in-destination relevance is unharmed by the scope. This needs its own fixture decision — either tag a subset of eval rows with a `destination` (couples the eval fixture to demo concerns) or stand up a small separate scoped-eval fixture seeded and queried with a `destination` (keeps the eval/demo separation Phase 11 deliberately established). Not built in Phase 11 so that phase leaves `testCases.ts` / `runEvals.ts` untouched; flagged here so the gap isn't lost.

## Phase Index

| Phase | Spec File | Depends On |
|---|---|---|
| 0 | `01-scaffolding.md` | — |
| 1 | `02-dummy-data.md` | 0 |
| 2 | `03-ingestion-pipeline.md` | 0, 1 |
| 3 | `04-query-understanding.md` | 0 |
| 4 | `05-hybrid-retrieval.md` | 2, 3 |
| 5 | `06-reranking.md` | 4 |
| 6 | `07-backend-api.md` | 3, 4, 5 |
| 7 | `08-frontend-ui.md` | 6 |
| 8 | `09-observability-evals.md` | 6, 7 |
| 9 | `10-production-hardening.md` | 8 |
| 10 | `11-deployment.md` | 9 |
| 11 | `12-location-scoped-search.md` | 2, 6, 7, 10 |