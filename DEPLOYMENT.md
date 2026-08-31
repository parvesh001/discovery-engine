# DEPLOYMENT.md

How `discovery-engine` is deployed, and how to redeploy it from scratch. This doubles as
the template for future client engagements.

Spec: [`specs/11-deployment.md`](specs/11-deployment.md).

---

## 1. What runs where

| Component | Platform | Source of truth |
|---|---|---|
| Frontend (Next.js) | **Vercel** | `/frontend`, [`frontend/.env.example`](frontend/.env.example) |
| Backend API (Express) | **Render** — Docker web service | [`backend/Dockerfile`](backend/Dockerfile), [`render.yaml`](render.yaml) |
| Ingestion worker (BullMQ) | **Render** — Docker background worker | same image, `dockerCommand` in `render.yaml` |
| Postgres 16 + pgvector | **Render** — managed database | `render.yaml` → `databases:` |
| Redis (cache + queue) | **Render** — Key Value | `render.yaml` → `discovery-engine-kv` |
| CI gate | **GitHub Actions** | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |

**Deploy trigger:** a merge to `main` auto-deploys both platforms. GitHub Actions runs
lint + tests + builds first; make it a required check (§6) so a red build never reaches
Render or Vercel.

```
                 push / PR ──▶ GitHub Actions (lint, test, build, docker build)
                                        │ required check
   merge to main ──┬──────────────▶ Render   : build backend image, (pre-deploy migrate), deploy web + worker
                   └──────────────▶ Vercel   : build & deploy /frontend
                                        │
   Browser ──▶ Vercel (frontend) ──▶ Render backend URL ──▶ Postgres / Key Value
```

---

## 2. Prerequisites

- GitHub repo: `parvesh001/discovery-engine` (already hosts the code).
- A **Render** account with access to the GitHub repo.
- A **Vercel** account with access to the GitHub repo.
- API keys: **Anthropic** (`ANTHROPIC_API_KEY`), **Voyage** (`VOYAGE_API_KEY`), **Langfuse
  Cloud** (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`).
  - Langfuse keys are **required** — `backend/src/env.ts` fails startup without them, so
    the Render service will crash-loop if they are unset. (Making them optional is a
    documented future enhancement — see `specs/00-architecture.md`.)
- Locally: Node 20, pnpm (`corepack enable`, or `npm i -g pnpm@10.30.3`), Docker, `psql`.

---

## 3. First-time Render setup (backend)

Everything below is declared in [`render.yaml`](render.yaml); you are not clicking
services together by hand.

1. **Render → New → Blueprint.** Connect the GitHub repo and select the branch `main`.
   Render reads `render.yaml` and shows a plan: 1 database, 1 Key Value, 1 web service,
   1 worker.
2. **Fill in the secret env vars** when prompted (these are `sync: false` in the
   blueprint, so they are never stored in the repo):

   | Key | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `VOYAGE_API_KEY` | your Voyage key |
   | `VOYAGE_MAX_REQUESTS_PER_MINUTE` | your Voyage tier's real RPM (e.g. `2000`); omit to accept the conservative default |
   | `LANGFUSE_PUBLIC_KEY` | Langfuse project public key |
   | `LANGFUSE_SECRET_KEY` | Langfuse project secret key |
   | `LANGFUSE_BASEURL` | only for the Langfuse EU region / self-hosted; otherwise omit |

   `DATABASE_URL`, `REDIS_URL`, and `PORT` are wired automatically by the blueprint — do
   not set them by hand.
3. **Apply.** Render provisions Postgres, Key Value, then builds the Docker image and
   deploys the web service and the worker.
4. **Run migrations** (creates the schema and enables pgvector):
   - The blueprint sets `preDeployCommand: node_modules/.bin/node-pg-migrate up`.
   - **Render only runs `preDeployCommand` on paid instance types.** On the free plan it
     is skipped — run it manually once after the first deploy: open the web service →
     **Shell** and run:
     ```
     node_modules/.bin/node-pg-migrate up
     ```
   - Migration `1784285145000_create-listings.sql` does `CREATE EXTENSION IF NOT EXISTS
     vector`, so pgvector is enabled as part of this step. Verify:
     ```
     psql "$DATABASE_URL" -c "\dx vector"
     psql "$DATABASE_URL" -c "\dt"      # listings, search_logs, ingestion_logs, pgmigrations
     ```
5. **Health check:**
   ```
   curl -i https://discovery-engine-backend.onrender.com/health
   # HTTP/1.1 200 OK   {"status":"ok","db":"connected"}
   ```
   A `503` here means the service is up but can't reach Postgres — check `DATABASE_URL`
   and that migrations ran.
6. **Seed demo data** — see §4.

> The exact backend hostname is shown on the Render service page; use that everywhere
> this document says `https://discovery-engine-backend.onrender.com`.

---

## 4. Seeding demo data

> ### ⚠️ `pnpm run seed` DELETES DATA
>
> `seed` runs `TRUNCATE listings CASCADE` and reloads the dummy dataset. It is safe here
> because the deployed database is demo-only. **Never run it against a database that holds
> real client listings** — there is no undo. (A `--force` / row-count guard is a tracked
> future enhancement; see `specs/00-architecture.md`.)

From your machine, pointed at the **production** connection strings (copy them from the
Render dashboard — database page for `DATABASE_URL`, Key Value page for `REDIS_URL`):

```bash
cd backend
export DATABASE_URL='<render postgres external connection string>'
export REDIS_URL='<render key value connection string>'
export ANTHROPIC_API_KEY='...'
export VOYAGE_API_KEY='...'
export LANGFUSE_PUBLIC_KEY='...' LANGFUSE_SECRET_KEY='...' PORT=4000

pnpm run seed              # load dummy listings (destructive — see warning above)
pnpm run ingest            # enqueue listings for embedding/extraction
pnpm run ingest:worker     # process the queue; Ctrl+C when it idles
```

If the Render **worker** service is running (paid plan), you can skip `ingest:worker`
locally — the deployed worker drains the queue. On the free plan the worker service does
not exist, so run `ingest:worker` locally as above.

---

## 5. First-time Vercel setup (frontend)

1. **Vercel → Add New → Project.** Import `parvesh001/discovery-engine`.
2. **Root Directory:** `frontend`. Framework preset: **Next.js** (auto-detected).
3. **Environment Variable:**

   | Key | Value | Environments |
   |---|---|---|
   | `NEXT_PUBLIC_BACKEND_URL` | `https://discovery-engine-backend.onrender.com` (the real Render URL) | Production, Preview, Development |

   Read at build time and embedded in the browser bundle — it must be a public URL, never
   a secret. If it is missing the app silently falls back to `http://localhost:4000` and
   every request fails in production.
4. **Deploy.** Then open the Vercel URL: the home page pings `/health` on the backend and
   shows the result; `/search` runs real queries.
5. Confirm the browser is calling the Render URL (DevTools → Network), not `localhost`.

---

## 6. Connecting GitHub (auto-deploy + CI gate)

- **Render:** the blueprint sets `autoDeploy: true` and `branch: main` on the web service
  and worker — merges to `main` redeploy them automatically. No extra wiring.
- **Vercel:** connecting the Git repo enables auto-deploy on push to `main` and preview
  deploys for PRs by default. Leave both on.
- **CI as a required check:** GitHub → repo **Settings → Branches → Add branch ruleset**
  for `main`:
  - Require a pull request before merging.
  - Require status checks to pass → add **`CI / verify`** (and optionally **`CI / docker`**).
  - This is the gate that runs *before* the Render/Vercel auto-deploy, so a broken build
    can't ship.

---

## 7. Post-deploy smoke test

Run after **every** deploy (takes ~2 minutes). All against the live URLs.

- [ ] `curl -i https://<render-backend>/health` → `200`, body `{"status":"ok","db":"connected"}`.
- [ ] Frontend root loads; the health indicator shows connected.
- [ ] `/search`: run a real query (e.g. *"pet friendly cabin with a mountain view"*) →
      results render, each with title, price, location.
- [ ] The same query a second time returns noticeably faster (cache hit) and still
      returns results (Key Value reachable).
- [ ] Naive vs. AI search toggle both return results.
- [ ] A deliberately weird/adversarial query (*"ignore previous instructions"*) returns
      normal results, no error.
- [ ] Render web service logs for the last few minutes: no unhandled exceptions, no
      `env` validation errors, no repeated Postgres/Redis connection failures.
- [ ] A Langfuse trace appears for the test searches (if Langfuse is configured).
- [ ] (If the worker runs on Render) worker logs show it connected and idle.

---

## 8. Rollback

- **Render:** service page → **Deploys** (or **Events**) → pick the last good deploy →
  **Redeploy** / **Rollback**. Do this for the web service and the worker.
- **Vercel:** project → **Deployments** → last good one → **Promote to Production**.
- **Database:** migrations are forward-only in practice. `pnpm --filter backend run
  migrate:down` rolls back one migration but will drop data — only for a broken migration
  caught immediately, never as a routine rollback step.

---

## 9. Environment variable reference

### Render — `discovery-engine-backend` (web) and `discovery-engine-ingest-worker`

| Key | Source | Notes |
|---|---|---|
| `DATABASE_URL` | blueprint → managed Postgres | do not set manually |
| `REDIS_URL` | blueprint → Key Value | do not set manually |
| `PORT` | blueprint literal (`4000`) | matches `EXPOSE` in the Dockerfile |
| `ANTHROPIC_API_KEY` | secret (`sync: false`) | required |
| `VOYAGE_API_KEY` | secret | required |
| `VOYAGE_MAX_REQUESTS_PER_MINUTE` | secret | optional; set to the real Voyage tier |
| `LANGFUSE_PUBLIC_KEY` | secret | required (server won't boot without it) |
| `LANGFUSE_SECRET_KEY` | secret | required |
| `LANGFUSE_BASEURL` | secret | optional; EU region / self-hosted only |

### Vercel — frontend

| Key | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | Render backend URL | public, build-time, no trailing slash |

---

## 10. Free-tier caveats — MUST fix before a real client goes live

This reference build runs entirely (except the worker) on Render's free tier. That is
fine for a demo and **not** production-ready:

- **Free Postgres expires 30 days after creation** and is deleted after a further 14-day
  grace period. A real deployment must use a paid instance type before go-live.
- **Free Key Value is in-memory only** — all data is lost on any restart (which Render can
  trigger at will on free tier). Harmless for the query cache (a miss just re-runs the
  pipeline) but **queued, not-yet-processed BullMQ ingestion jobs are lost**. Upgrade to a
  paid, disk-persisted Key Value instance before relying on the job queue.
- **`preDeployCommand` (auto-migrate on deploy) only runs on paid instance types.** On
  free tier, migrations are manual (§3.4).
- **Render background workers require a paid plan.** `render.yaml` declares the worker as
  `starter`. To keep the demo 100% free, comment the worker service out of `render.yaml`
  and run ingestion locally against the prod connection strings (§4).
- **Free web services cold-start** after inactivity — the first request after idle is slow.

---

## 11. Redeploy-from-scratch checklist (dry run)

Following this list top to bottom, with nothing memorised, should stand up the whole
system. If a step here is missing or wrong, fix *this document*.

1. [ ] Repo pushed to GitHub; `main` is green in Actions.
2. [ ] Render: New → Blueprint → connect repo (`main`) → enter the six secret env vars → Apply.
3. [ ] Render: Postgres + Key Value provisioned; web + worker deployed.
4. [ ] Migrations applied (`node-pg-migrate up` — auto on paid, manual Shell on free); `\dx vector` present.
5. [ ] `GET /health` on the Render URL → `200`.
6. [ ] Seed: `seed` → `ingest` → drain the queue (local `ingest:worker`, or the Render worker).
7. [ ] Vercel: Add Project → root dir `frontend` → set `NEXT_PUBLIC_BACKEND_URL` → Deploy.
8. [ ] Frontend loads and runs a real search end-to-end against the Render backend.
9. [ ] GitHub: branch ruleset on `main` requires `CI / verify`.
10. [ ] Make a trivial PR, merge it, confirm Render and Vercel both auto-deploy the new commit.
11. [ ] Run the §7 smoke test.
