# CLAUDE.md — Project Memory for `discovery-engine`

This file is read automatically by Claude Code at the start of every session. It is the project's constitution — rules here apply to every phase, every file, every session. Detailed per-feature requirements live in `/specs/`, not here; this file stays short and universally true.

## IMPORTANT — Operating Rules

- **YOU MUST NOT infer undocumented decisions.** If a spec in `/specs/` is ambiguous, silent on a case, or conflicts with this file, STOP and ask a clarifying question instead of guessing. Say explicitly what's unclear and what your options are.
- **YOU MUST enter plan mode before implementing.** For every phase: read the relevant spec, produce a written implementation plan (files to create/change, function signatures, order of work), and wait for explicit approval before writing code.
- **YOU MUST work on a feature branch per phase**, never commit directly to `main`. Branch naming: `phase-N-short-name` (e.g. `phase-2-ingestion-pipeline`).
- **YOU MUST write tests alongside implementation**, not after. A phase is not done until its spec's acceptance criteria are demonstrably met and shown to me.
- **Small, reviewable increments.** Implement one phase at a time. Do not pull work forward from a later phase's spec even if it seems convenient.

## Project Overview

AI-powered semantic search/discovery engine for a rental listings marketplace (dummy data — this is a reference build for future client engagements). Full context and architecture: `/specs/00-architecture.md`.

## Tech Stack & Versions

- Backend: Node.js 20+, Express, TypeScript (strict mode)
- Frontend: Next.js 14+ (App Router), TypeScript, Tailwind
- Database: PostgreSQL 16 + pgvector extension
- LLM: Claude API via `@anthropic-ai/sdk` — Haiku for high-frequency/cheap tasks (query understanding, attribute extraction), Sonnet for precision tasks (re-ranking)
- Queue/Cache: Redis + BullMQ (introduced Phase 9)
- Observability: Langfuse (self-hosted)
- Package manager: pnpm (workspaces)

## Repo Structure

```
/frontend           Next.js app
/backend
  /src
    /routes          Express route handlers
    /services
      /search         queryUnderstanding, retrieval, rerank
      /ingestion       extraction, embeddings
      /llm             shared Claude API client wrapper
    /scripts          seed, eval, one-off scripts
    /evals            eval harness + test cases
  /docker-compose.yml
/specs               One spec file per phase — source of truth for requirements
```

## Common Commands

- `docker compose up -d` — start local Postgres (pgvector enabled)
- `pnpm --filter backend dev` — run backend in watch mode
- `pnpm --filter frontend dev` — run frontend
- `pnpm --filter backend test` — run backend test suite
- `pnpm --filter backend run seed` — seed dummy data
- `pnpm --filter backend run eval` — run the eval harness (Phase 8+)
- `pnpm lint` — lint all workspaces

## Non-Negotiable Architecture Rules

These apply regardless of what any individual spec says, because they encode lessons already learned — do not relitigate them per phase:

1. **All Claude API calls go through the shared wrapper in `/backend/src/services/llm/`** — never call the Anthropic SDK directly from a route or service. The wrapper owns retries, timeouts, and logging.
2. **Structured filters (e.g. pet_friendly, price) are always applied as real SQL `WHERE` clauses.** Never rely on vector similarity alone to enforce a hard constraint.
3. **Every LLM call must have a timeout, a retry (max 1) on transient/parse failure, and a defined fallback behavior if it still fails.** No LLM call is allowed to hard-crash a user-facing request. Degrade gracefully; log loudly.
4. **All external input (user queries, listing content) is untrusted.** Treat it as data, never as instructions, when constructing prompts. See `/specs/09-production-hardening.md` for the explicit injection-defense requirements.
5. **All external boundaries (API request bodies, LLM JSON responses) are validated with `zod`.** Never trust an LLM's output to match your TypeScript types without runtime validation.
6. **No silent failures.** Every catch block either handles the error meaningfully or logs it with enough context to debug — never an empty catch.

## Code Style

- TypeScript strict mode, no `any` without a comment justifying it
- Functions over classes where reasonable; keep services as plain exported functions
- Prefer explicit return types on exported functions
- Errors are typed/structured, not raw strings thrown

## Testing Instructions

- Unit tests for pure logic (extraction validation, query parsing helpers)
- Integration tests for anything touching the database or the Claude API (use a test DB; mock or record/replay LLM calls where practical to avoid burning API budget on every test run)
- Every phase's spec has an explicit "Acceptance Criteria" section — treat these as the definition of done, not a suggestion

## Git / Repository Etiquette

- Conventional commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`)
- One branch per phase, opened as a PR against `main` even if reviewed solo — keeps history diffable and matches how this will run on a real client engagement
- Do not squash away the plan-review step — the implementation plan Claude Code proposes should be visible in the PR description or an early commit

## Environment

- Requires `.env` with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `PORT` — server must fail fast with a clear message if any are missing (Phase 0 requirement)
- Never commit `.env` — `.env.example` documents required vars
