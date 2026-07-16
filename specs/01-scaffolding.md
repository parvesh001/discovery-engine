# Spec 01 — Phase 0: Project Scaffolding & Infrastructure

**Status:** Ready
**Branch:** `phase-0-scaffolding`
**Depends on:** —

## Context

Nothing exists yet. This phase stands up the repo, tooling, and local database so every later phase has a working foundation. No AI/search logic in this phase.

## Functional Requirements

1. Monorepo using pnpm workspaces with two packages: `/frontend` and `/backend`.
2. `/backend`: Node.js + Express + TypeScript, strict mode enabled in `tsconfig.json`.
3. `/frontend`: Next.js 14+ (App Router), TypeScript, Tailwind configured.
4. `docker-compose.yml` at repo root running PostgreSQL 16 with pgvector enabled on startup (`pgvector/pgvector:pg16` image), exposing the standard Postgres port, with a named volume for persistence.
5. Environment variable validation on backend boot using `zod`: required vars are `DATABASE_URL`, `ANTHROPIC_API_KEY`, `PORT`. If any are missing or malformed, the server must exit immediately with a clear, specific error message (not a generic crash/stack trace).
6. `GET /health` endpoint on backend: checks DB connectivity (a trivial query, e.g. `SELECT 1`) and returns `{status: "ok", db: "connected"}` on success, or a 503 with a descriptive error if the DB is unreachable.
7. Frontend home page fetches `/health` from the backend on load and displays the result, purely to confirm the two services can communicate.
8. ESLint + Prettier configured and shared/consistent across both workspaces.
9. `.env.example` documenting all required environment variables (no real secrets committed).
10. Root `README.md` explaining: prerequisites, how to install, how to start Postgres, how to run both services locally, in a single documented sequence.

## Interfaces

- `GET /health` → `200 {status: "ok", db: "connected"}` | `503 {status: "error", detail: string}`

## Non-Functional Requirements

- `docker compose up -d` must bring Postgres up in a state where pgvector's `CREATE EXTENSION` succeeds without manual intervention.
- Backend boot failure due to missing env vars must happen before any server socket is opened (fail fast, not on first request).

## Explicit Out of Scope

- No database schema/tables yet (that's Phase 1/2's concern) beyond enabling the pgvector extension.
- No authentication.
- No CI/CD (Phase 10).

## Acceptance Criteria

- [ ] `docker compose up -d` starts Postgres with pgvector enabled, verified by connecting and running `CREATE EXTENSION IF NOT EXISTS vector;` successfully.
- [ ] Starting the backend with a required env var unset produces an immediate, clear error naming the missing var, and the process exits non-zero.
- [ ] Starting the backend with valid env vars, `GET /health` returns `200` with the documented shape.
- [ ] Frontend home page, on load, displays the health check result fetched from the backend.
- [ ] `pnpm lint` runs clean across both workspaces from repo root.
- [ ] A developer following only the README, with nothing pre-installed but Node/pnpm/Docker, can get both services running.

## Open Questions Claude Code Should Ask If Unclear

- Node.js version pinning (via `.nvmrc`/`engines` field) — confirm exact version before proceeding if not specified.
- Whether Postgres port should be the default 5432 or a non-standard port to avoid local conflicts.
