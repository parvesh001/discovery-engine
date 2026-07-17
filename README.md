# Discovery Engine

AI-powered semantic search/discovery engine for a rental listings marketplace (reference build, dummy data).

See [`specs/00-architecture.md`](specs/00-architecture.md) for the full architecture and data model, and [`CLAUDE.md`](CLAUDE.md) for project rules.

## Prerequisites

- Node.js 20.x (see `.nvmrc` — run `nvm use` if you use nvm)
- [pnpm](https://pnpm.io/installation) (v9+)
- [Docker](https://www.docker.com/products/docker-desktop/) with Docker Compose

## Setup

Run these in order from the repo root.

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Start Postgres (with pgvector)**

   ```bash
   docker compose up -d
   ```

   This starts Postgres 16 with the pgvector extension available, on port `5432`, with data persisted in a named Docker volume. To verify pgvector is working:

   ```bash
   docker compose exec postgres psql -U postgres -d discovery_engine -c "CREATE EXTENSION IF NOT EXISTS vector;"
   ```

3. **Configure backend environment variables**

   ```bash
   cp backend/.env.example backend/.env
   ```

   Edit `backend/.env` and set `ANTHROPIC_API_KEY` to a real key. The defaults for `DATABASE_URL` and `PORT` match the Docker Compose setup above and don't need to change for local dev.

4. **Start the backend** (in one terminal)

   ```bash
   pnpm --filter backend dev
   ```

   Visit `http://localhost:4000/health` — you should see `{"status":"ok","db":"connected"}`.

5. **Start the frontend** (in another terminal)

   ```bash
   pnpm --filter frontend dev
   ```

   Visit `http://localhost:3000` — the page fetches `/health` from the backend on load and displays the result.

## Common Commands

- `docker compose up -d` — start local Postgres (pgvector enabled)
- `pnpm --filter backend dev` — run backend in watch mode
- `pnpm --filter frontend dev` — run frontend
- `pnpm --filter backend test` — run backend test suite
- `pnpm lint` — lint all workspaces

## Repo Structure

```
/frontend           Next.js app
/backend
  /src
    /routes          Express route handlers
    /services         search + ingestion services (later phases)
  /docker-compose.yml
/specs               One spec file per phase — source of truth for requirements
```
