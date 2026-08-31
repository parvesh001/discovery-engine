# syntax=docker/dockerfile:1
#
# Production image for the Express backend. Built by Render directly from this file
# (Docker-based Web Service) and by CI as a build smoke test.
#
# Build context is the REPO ROOT (see render.yaml `dockerContext: .`), because this is a
# pnpm workspace and the install needs the root lockfile + workspace manifests.
#
#   docker build -f backend/Dockerfile -t discovery-backend .

# ---------------------------------------------------------------------------
# Stage 1 — install workspace deps (incl. dev) and compile the backend
# ---------------------------------------------------------------------------
FROM node:20-slim AS build

# Install pnpm directly rather than via corepack: the corepack bundled with Node 20
# can't verify signatures for current pnpm releases. Version tracks the root
# package.json `packageManager` field.
RUN npm install -g pnpm@10.30.3

WORKDIR /repo

# Manifests first so the dependency layer is cached until they change. All workspace
# package.json files are copied so `--frozen-lockfile` can validate the whole lockfile.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile --filter backend...

# Backend source, then the real tsc compile (src -> dist). tsconfig deliberately keeps
# *.test.ts in the type-check scope (it's the project's type gate), so the compile also
# emits compiled test files — strip them and the test-only helpers from the runtime dist.
COPY backend/ backend/
RUN pnpm --filter backend run build \
 && find backend/dist -name '*.test.js' -o -name '*.test.js.map' | xargs rm -f \
 && rm -rf backend/dist/test

# Prune to a self-contained production dependency tree (no devDeps, no workspace
# symlinks). We take only node_modules + package.json from this; dist and migrations
# are copied explicitly below so the image contents don't depend on `deploy`'s file
# selection rules.
RUN pnpm --filter backend --prod --legacy deploy /repo/bundle

# ---------------------------------------------------------------------------
# Stage 2 — minimal runtime image
# ---------------------------------------------------------------------------
FROM node:20-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# node:20-slim already ships an unprivileged `node` user (uid 1000).
COPY --from=build --chown=node:node /repo/bundle/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/bundle/package.json ./package.json
COPY --from=build --chown=node:node /repo/backend/dist ./dist
# Needed by Render's preDeployCommand: `node_modules/.bin/node-pg-migrate up`
COPY --from=build --chown=node:node /repo/backend/migrations ./migrations

USER node

# Documented default; Render injects its own PORT, which env.ts reads.
EXPOSE 4000

# The web service. The ingestion worker overrides this via render.yaml `dockerCommand`
# with `node dist/scripts/ingest-worker.js`.
CMD ["node", "dist/index.js"]
