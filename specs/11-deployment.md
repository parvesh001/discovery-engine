# Spec 11 — Phase 10: Deployment

**Status:** Ready
**Branch:** `phase-10-deployment`
**Depends on:** Phase 9

## Context

Get the system onto real infrastructure with a documented, repeatable process — this is also the template for how future client projects get deployed.

## Confirmed Platform Decisions

- **Source control:** GitHub (repo already hosts the code; GitHub Actions used for CI).
- **Frontend hosting:** Vercel.
- **Backend + database hosting:** Render (Web Service for the Express backend + Render managed PostgreSQL with the pgvector extension enabled).

## Functional Requirements

1. Production `Dockerfile` for `/backend`: multi-stage build, non-root user, minimal final image size. Render can build from this Dockerfile directly (Render's Docker-based Web Service) rather than a buildpack.
2. Render deployment config: a Render Web Service (backend, built from the Dockerfile) + a Render managed PostgreSQL instance with the pgvector extension enabled. Document the exact required environment variables (`DATABASE_URL` — supplied by Render's Postgres instance, `ANTHROPIC_API_KEY`, `PORT`, plus any added in Phase 9 for Redis — Render Key Value or an external Redis add-on) in a `render.yaml` (Render's infra-as-code blueprint) where practical, so the service topology is reproducible from the repo rather than manual dashboard clicking.
3. Vercel deployment config for `/frontend` — backend API URL supplied via a Vercel environment variable pointing at the deployed Render backend URL, never hardcoded.
4. GitHub repository connected to both Vercel (auto-deploy `/frontend` on push to `main`) and Render (auto-deploy `/backend` on push to `main`), so merges to `main` are the deploy trigger for both — confirm this is the desired trigger before wiring it, since it means every merged PR ships automatically.
5. `DEPLOYMENT.md`: step-by-step deployment process for both platforms, environment variables required on each, how the two are connected via GitHub, and a manual smoke-test checklist to run after every deploy.
6. GitHub Actions workflow running lint + tests on every push/PR, as a required check before merge — this is the CI gate that runs *before* the Vercel/Render auto-deploy triggers on merge, so a broken build shouldn't reach either platform.

## Interfaces

- No new application-level interfaces; this phase is infra/config only.

## Non-Functional Requirements

- Final backend Docker image should be reasonably minimal (multi-stage build, no dev dependencies in the final layer).

## Explicit Out of Scope

- No auto-deploy-on-merge pipeline (manual deploy trigger is acceptable for this phase).
- No blue/green or zero-downtime deployment strategy (acceptable for a reference/demo project).

## Acceptance Criteria

- [ ] Backend deployed on Render (from the Dockerfile) and reachable; `GET /health` returns `200` against the deployed Render URL, confirming DB connectivity to Render's managed Postgres.
- [ ] Render Postgres instance has the pgvector extension successfully enabled and the schema/migrations applied.
- [ ] Frontend deployed on Vercel, successfully calling the deployed Render backend (not localhost) via the environment-variable-configured URL.
- [ ] Full search flow (a real query, real results) works end-to-end against the deployed system.
- [ ] Pushing a merge to `main` on GitHub correctly triggers auto-deploy on both Vercel and Render, and both reflect the new version without manual intervention.
- [ ] `DEPLOYMENT.md` followed literally by re-deploying from scratch (or a dry run of the documented steps) confirms nothing is missing from the instructions.
- [ ] GitHub Actions workflow runs on a test push/PR and correctly fails on an intentionally broken test, blocking merge, and passes when fixed.

## Additional Confirmed Decisions

- **Infra-as-code:** the Render service topology (backend Web Service + Postgres) is defined in a committed `render.yaml` (Render Blueprint), not set up manually via the dashboard. This is the reproducibility mechanism referenced in requirement #2.
- **Redis provider:** Render Key Value (same vendor as the backend — lower latency via private network, single dashboard/bill). Used for both query caching and the BullMQ queue from Phase 9 onward.
  - **Known limitation, accepted for now:** on Render's free instance type, Key Value is in-memory only and data is lost on any restart (which Render can trigger at any time on free tier). This is harmless for the query cache (a cache miss just falls back to the full pipeline) but means queued-but-unprocessed BullMQ ingestion jobs could be lost on a free-tier restart.
  - **Hard requirement:** before this system is deployed for an actual client with real traffic (i.e. beyond this reference/demo build), the Key Value instance must be upgraded to a paid Render instance type, which persists data to disk. Do not treat the free tier as production-ready for the job queue. Flag this explicitly in `DEPLOYMENT.md`.
  - Same caveat applies to Render's free Postgres (expires 30 days after creation, deleted after a 14-day grace period if not upgraded) — the free tier is fine for this reference build, but `DEPLOYMENT.md` must call out that a real client deployment requires the paid instance type before go-live.

## Open Questions Claude Code Should Ask If Unclear

*(none currently — both prior open questions have been resolved above; if new platform-specific ambiguity comes up during implementation, surface it the same way rather than guessing)*
