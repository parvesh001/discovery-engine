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
| Observability | Langfuse (self-hosted) | Full LLM call tracing |
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