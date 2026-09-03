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
| Ingestion worker (BullMQ) | **Disabled** for the free-tier demo — run manually from a dev machine (§4) | commented-out block in [`render.yaml`](render.yaml) |
| Postgres 16 + pgvector | **Render** — managed database | `render.yaml` → `databases:` |
| Redis (cache + queue) | **Render** — Key Value | `render.yaml` → `discovery-engine-kv` |
| CI gate | **GitHub Actions** | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |

**Deploy trigger:** a merge to `main` auto-deploys both platforms. GitHub Actions runs
lint + tests + builds first; make it a required check (§6) so a red build never reaches
Render or Vercel.

```
                 push / PR ──▶ GitHub Actions (lint, test, build, docker build)
                                        │ required check
   merge to main ──┬──────────────▶ Render   : build backend image, deploy web service
                   │                          (migrations are MANUAL on free tier — §3.4)
                   └──────────────▶ Vercel   : build & deploy /frontend
                                        │
   Browser ──▶ Vercel (frontend) ──▶ Render backend URL ──▶ Postgres / Key Value

   Ingestion worker: disabled on free tier — run `ingest` + `ingest:worker` from a
   dev machine against the prod connection strings when the catalogue changes (§4).
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
   Render reads `render.yaml` and shows a plan: 1 database, 1 Key Value, 1 web service.
   (The ingestion worker is commented out — it needs a paid plan. See §4 for how
   ingestion is run instead.)
2. **Fill in the secret env vars** when prompted (these are `sync: false` in the
   blueprint, so they are never stored in the repo):

   | Key | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `VOYAGE_API_KEY` | your Voyage key |
   | `VOYAGE_MAX_REQUESTS_PER_MINUTE` | your Voyage tier's real RPM (e.g. `2000`). **Do not omit** — see §9: leaving it unset does not fail startup, it silently throttles reranking to ~3 RPM (~20s first call). |
   | `LANGFUSE_PUBLIC_KEY` | Langfuse project public key |
   | `LANGFUSE_SECRET_KEY` | Langfuse project secret key |
   | `LANGFUSE_BASEURL` | only for the Langfuse EU region / self-hosted; otherwise omit |

   `DATABASE_URL`, `REDIS_URL`, and `PORT` are wired automatically by the blueprint — do
   not set them by hand.
3. **Apply.** Render provisions Postgres, Key Value, then builds the Docker image and
   deploys the web service.
4. **Run migrations** (creates the schema and enables pgvector).

   > ### ⚠️ Migrations are MANUAL on the free web service tier
   >
   > `render.yaml` has **no `preDeployCommand`**: on a free-tier service Render rejects
   > the entire blueprint with *"pre-deploy command is not supported for free tier
   > services"* (confirmed on a live apply — it blocks the deploy, it is not skipped).
   > So you must run migrations by hand **after the first deploy and after every later
   > deploy whose commit adds or changes a file in `backend/migrations/`** — otherwise the
   > new code runs against the old schema.
   >
   > Open the Render web service → **Shell**, and run (cwd is already `/app`):
   >
   > ```
   > node_modules/.bin/node-pg-migrate up
   > ```
   >
   > It is idempotent — safe to run when there is nothing pending (prints
   > `No migrations to run!`).

   Migration `1784285145000_create-listings.sql` does `CREATE EXTENSION IF NOT EXISTS
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

## 4. Seeding and updating the demo catalogue

The ingestion worker is **not deployed** (free tier — Render workers need a paid plan),
so ingestion is run **manually from a dev machine against the production connection
strings** — both for the initial seed and every later time the demo catalogue needs
updating (new/edited listings in `backend/src/scripts/seed-demo-data.ts`, or a re-embed
after an embedding-model change).

> ### ⚠️ `pnpm run seed:demo` DELETES DATA — and this is the command you run against production
>
> `seed:demo` (and the local-only `seed`) both run `TRUNCATE listings CASCADE` before
> reloading: every row in `listings`, plus anything referencing it by foreign key, is
> gone, with no undo. `seed:demo` is the one that runs **here, against the deployed
> database**, so treat it with the same care as any destructive production command.
>
> - It is safe **only** because this database is demo-only. **Never run `seed` or
>   `seed:demo` against a database that holds real client listings.**
> - There is no `--force` flag and no row-count guard — nothing stops it running against
>   a populated database. That interlock is a tracked future enhancement
>   (see `specs/00-architecture.md`).
> - Confirm `DATABASE_URL` points at the intended demo database *before* running it.
>   Re-exporting the wrong connection string is the realistic way this goes wrong.

Copy the connection strings from the Render dashboard — the database page for
`DATABASE_URL`, the Key Value page for `REDIS_URL` — then, from the repo root:

```bash
export DATABASE_URL='<render postgres external connection string>'
export REDIS_URL='<render key value connection string>'
export ANTHROPIC_API_KEY='...'
export VOYAGE_API_KEY='...'
export LANGFUSE_PUBLIC_KEY='...' LANGFUSE_SECRET_KEY='...' PORT=4000

pnpm --filter backend run seed:demo      # reload the 72-listing demo catalogue (destructive — see warning)
pnpm --filter backend run ingest         # enqueue all pending listings onto the BullMQ queue
pnpm --filter backend run ingest:worker  # drain the queue (extraction + embeddings); Ctrl+C when it idles
```

(`pnpm --filter backend run seed` — no `:demo` — loads the smaller 36-listing eval
dataset and is for local / CI use only; `seed:demo` is the deployed demo catalogue.)

`ingest` only enqueues — it selects `listings` rows with `ingestion_status = 'pending'`
(the column default, which `seed:demo` resets on every reload) and adds them to the queue.
Nothing is processed until `ingest:worker` runs; leave it running until it stops logging
completed jobs, then stop it with Ctrl+C (it shuts down cleanly on SIGINT/SIGTERM).

> If the worker service is later re-enabled on a paid plan (uncomment its block in
> `render.yaml`), it drains the queue automatically and you only need `seed:demo` +
> `ingest` here — drop the local `ingest:worker` step.

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
  — merges to `main` redeploy it automatically. No extra wiring. **Auto-deploy does not
  run migrations on the free tier** (§3.4) — after merging a schema change, apply
  migrations by hand before trusting the new deploy.
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

- [ ] **If this deploy's commits touched `backend/migrations/`:** migrations were applied
      manually — the free web tier has no `preDeployCommand`. Open the Render web service →
      Shell → `node_modules/.bin/node-pg-migrate up` (§3.4), and confirm it prints
      `No migrations to run!` on a second run.
- [ ] `curl -i https://<render-backend>/health` → `200`, body `{"status":"ok","db":"connected"}`.
- [ ] Frontend root loads; the health indicator shows connected.
- [ ] **Browse (spec 12):** `curl "https://<render-backend>/api/listings?destination=manali"`
      and `?destination=goa` each return a non-empty `results` array of that destination's
      listings; `?destination=xyz` and the param omitted both return `400`.
- [ ] **Browse UI:** open `/search`, pick **Manali** → a price-ascending list of Manali
      stays loads and the URL becomes `…/search?destination=manali`; reloading that URL
      lands straight on the Manali list. Switch to **Goa** → the list swaps.
- [ ] `/search`: with a destination selected, run a real query (e.g. *"pet friendly cabin
      with a mountain view"*) → the naive-vs-AI compare view renders, each card with title,
      price, location.
- [ ] **Scoped search (spec 12):** run a query with strong cross-destination pull
      (e.g. *"beachfront villa with a pool"* while **Manali** is selected) → **zero** Goa
      listings appear in either column. Clearing the query returns to the browse list.
- [ ] The `RERANK …ms` figure in the pipeline trace under the search box is under ~1s on
      that first real search, not ~20s. A ~20s rerank means `VOYAGE_MAX_REQUESTS_PER_MINUTE`
      is unset in the Render environment — set it (§9) and re-test. Returning results is
      *not* enough on its own.
- [ ] The same query a second time returns noticeably faster (cache hit) and still
      returns results (Key Value reachable).
- [ ] Naive vs. AI search toggle both return results.
- [ ] A deliberately weird/adversarial query (*"ignore previous instructions"*) returns
      normal results, no error.
- [ ] Render web service logs for the last few minutes: no unhandled exceptions, no
      `env` validation errors, no repeated Postgres/Redis connection failures.
- [ ] A Langfuse trace appears for the test searches (if Langfuse is configured).
- [ ] If the demo catalogue was changed this deploy: ran `seed:demo` / `ingest` /
      `ingest:worker` locally against the prod connection strings (§4), and search now
      returns the updated listings.

---

## 8. Rollback

- **Render:** service page → **Deploys** (or **Events**) → pick the last good deploy →
  **Redeploy** / **Rollback**. Web service only (no worker is deployed). Note a rollback
  does **not** revert the database — if the bad deploy included a migration you ran, you
  also need `migrate:down` (see below).
- **Vercel:** project → **Deployments** → last good one → **Promote to Production**.
- **Database:** migrations are forward-only in practice. `pnpm --filter backend run
  migrate:down` rolls back one migration but will drop data — only for a broken migration
  caught immediately, never as a routine rollback step.

---

## 9. Environment variable reference

### Render — `discovery-engine-backend` (web service)

Same set applies to `discovery-engine-ingest-worker` if that block in `render.yaml` is
ever uncommented.

| Key | Source | Notes |
|---|---|---|
| `DATABASE_URL` | blueprint → managed Postgres | do not set manually |
| `REDIS_URL` | blueprint → Key Value | do not set manually |
| `PORT` | blueprint literal (`4000`) | matches `EXPOSE` in the Dockerfile |
| `ANTHROPIC_API_KEY` | secret (`sync: false`) | required |
| `VOYAGE_API_KEY` | secret | required |
| `VOYAGE_MAX_REQUESTS_PER_MINUTE` | secret | **Required in practice.** Optional in `env.ts`, so omitting it does *not* fail startup — instead the Voyage rate limiter silently falls back to the free-tier assumption (~3 RPM) and the first live rerank call takes ~20s instead of ~300ms. Set it to the account's real RPM (e.g. `2000`). |
| `LANGFUSE_PUBLIC_KEY` | secret | required (server won't boot without it) |
| `LANGFUSE_SECRET_KEY` | secret | required |
| `LANGFUSE_BASEURL` | secret | optional; EU region / self-hosted only |

### Vercel — frontend

| Key | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | Render backend URL | public, build-time, no trailing slash |

---

## 10. Free-tier caveats — MUST fix before a real client goes live

This reference build runs entirely on Render's free tier. That is fine for a demo and
**not** production-ready:

- **No `preDeployCommand` — free-tier services can't have one.** Adding it makes Render
  reject the whole blueprint (*"pre-deploy command is not supported for free tier
  services"*), so automatic migrations on deploy are not an option here. **After any
  deploy whose commit adds or changes a file in `backend/migrations/`, migrations must be
  applied by hand** or the new code runs against the old schema. Render web service →
  **Shell** (cwd is `/app`):
  ```
  node_modules/.bin/node-pg-migrate up
  ```
  Idempotent — prints `No migrations to run!` when nothing is pending. Covered in §3.4
  and the §7 smoke test. On a paid instance type, restore the `preDeployCommand` key in
  `render.yaml` to make this automatic.
- **Render background workers require a paid plan**, so `discovery-engine-ingest-worker`
  is **commented out** in `render.yaml`. Ingestion is instead run manually from a dev
  machine against the prod `DATABASE_URL` / `REDIS_URL` whenever the catalogue changes
  (§4). To restore an always-on worker, uncomment its block (it is a valid `starter`
  service) and update §4.
- **Free Postgres expires 30 days after creation** and is deleted after a further 14-day
  grace period. A real deployment must use a paid instance type before go-live.
- **Free Key Value is in-memory only** — all data is lost on any restart (which Render can
  trigger at will on free tier). Harmless for the query cache (a miss just re-runs the
  pipeline). The BullMQ queue only holds jobs transiently during a manual ingestion run,
  so a restart mid-run just means re-running `ingest` — but a paid, disk-persisted Key
  Value instance is still required before relying on the queue in production.
- **Free web services cold-start** after inactivity — the first request after idle is slow.

---

## 11. Redeploy-from-scratch checklist (dry run)

Following this list top to bottom, with nothing memorised, should stand up the whole
system. If a step here is missing or wrong, fix *this document*.

1. [ ] Repo pushed to GitHub; `main` is green in Actions.
2. [ ] Render: New → Blueprint → connect repo (`main`) → enter the secret env vars → Apply.
3. [ ] Render: Postgres + Key Value provisioned; web service deployed (no worker — §4).
4. [ ] Migrations applied **manually** via the web service Shell: `node_modules/.bin/node-pg-migrate up` (§3.4); `\dx vector` present.
5. [ ] `GET /health` on the Render URL → `200`.
6. [ ] Catalogue loaded: `seed:demo` → `ingest` → `ingest:worker` run locally against the prod connection strings (§4), left running until the queue idles.
7. [ ] Vercel: Add Project → root dir `frontend` → set `NEXT_PUBLIC_BACKEND_URL` → Deploy.
8. [ ] Frontend loads and runs a real search end-to-end against the Render backend.
9. [ ] GitHub: branch ruleset on `main` requires `CI / verify`.
10. [ ] Make a trivial PR, merge it, confirm Render and Vercel both auto-deploy the new commit.
11. [ ] Run the §7 smoke test.
