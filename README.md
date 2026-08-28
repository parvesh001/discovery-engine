# Discovery Engine

AI-powered semantic search/discovery engine for a rental listings marketplace (reference build, dummy data).

See [`specs/00-architecture.md`](specs/00-architecture.md) for the full architecture and data model, and [`CLAUDE.md`](CLAUDE.md) for project rules.

## Prerequisites

- Node.js 20.x (see `.nvmrc` — run `nvm use` if you use nvm)
- [pnpm](https://pnpm.io/installation) (v9+)
- [Docker](https://www.docker.com/products/docker-desktop/) with Docker Compose
- An [Anthropic API key](https://console.anthropic.com/) and a [Voyage AI API key](https://dash.voyageai.com/) (embeddings)
- Optional: a [Langfuse Cloud](https://cloud.langfuse.com) project (observability) — the app runs without it, just without tracing

## Setup

Run these in order from the repo root.

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Start Postgres (with pgvector) and Redis**

   ```bash
   docker compose up -d
   ```

   This starts, per the root [`docker-compose.yml`](docker-compose.yml):
   - Postgres 16 with pgvector, on port `5432`
   - Redis 7, on port `6379` — backs the search cache, rate limiter, and the BullMQ ingestion queue (Phase 9)

   Check both are healthy:

   ```bash
   docker compose ps
   ```

3. **Configure backend environment variables**

   ```bash
   cp backend/.env.example backend/.env
   ```

   Edit `backend/.env` and fill in:
   - `ANTHROPIC_API_KEY` — required, server fails fast at startup if missing
   - `VOYAGE_API_KEY` — required for the ingestion pipeline (embeddings)
   - `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` — optional, leave as placeholders to run without tracing

   Leave `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_URL`, `TEST_REDIS_URL`, and `PORT` at their defaults — they already match the `docker compose` setup above and the test/dev isolation this project requires (see `CLAUDE.md`).

4. **Run database migrations**

   ```bash
   pnpm --filter backend run migrate:up
   ```

5. **Seed dummy listings data**

   ```bash
   pnpm --filter backend run seed
   ```

6. **Start the backend** (in one terminal)

   ```bash
   pnpm --filter backend dev
   ```

   Visit `http://localhost:4000/health` — you should see `{"status":"ok","db":"connected"}`.

7. **Start the frontend** (in another terminal)

   ```bash
   pnpm --filter frontend dev
   ```

   Visit `http://localhost:3000` — the page fetches `/health` from the backend on load and displays the result.

## Running ingestion (embeddings)

Listing ingestion is async, via a BullMQ queue backed by Redis (Phase 9). Two separate processes:

```bash
# Enqueues pending listings (one-shot)
pnpm --filter backend run ingest

# Long-running worker that processes the queue — leave running in its own terminal
pnpm --filter backend run ingest:worker
```

## Common Commands

- `docker compose up -d` — start local Postgres (pgvector) + Redis
- `docker compose down` — stop them (add `-v` to also wipe the data volumes)
- `pnpm --filter backend run migrate:up` / `migrate:down` — apply / roll back DB migrations
- `pnpm --filter backend run seed` — seed dummy listings data
- `pnpm --filter backend run ingest` — enqueue listings for ingestion
- `pnpm --filter backend run ingest:worker` — run the ingestion worker (long-running)
- `pnpm --filter backend dev` — run backend in watch mode
- `pnpm --filter frontend dev` — run frontend
- `pnpm --filter backend test` — run backend integration/unit test suite
- `pnpm --filter backend run build` — type-check via `tsc` — **required** before considering any change done (see `CLAUDE.md`)
- `pnpm --filter backend run eval` — run the retrieval/rerank eval harness
- `pnpm --filter backend run loadtest` — run the load test script
- `pnpm lint` — lint all workspaces

Before considering any backend change complete, run all three: `pnpm lint`, `pnpm --filter backend test`, `pnpm --filter backend run build`.

## Repo Structure

```
/frontend           Next.js app
/backend
  /src
    /routes          Express route handlers
    /services
      /search          queryUnderstanding, retrieval, rerank
      /ingestion       extraction, embeddings, BullMQ queue/worker
      /llm             shared Claude API client wrapper
      /redis           Redis client (cache, rate limiter, queue connections)
    /scripts          seed, ingest, ingest-worker, eval, load test, one-off scripts
    /evals            eval harness + test cases
  /migrations        node-pg-migrate SQL migrations
docker-compose.yml   Postgres (pgvector) + Redis, at repo root
/specs               One spec file per phase — source of truth for requirements
```
