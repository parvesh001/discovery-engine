# Spec 10 — Phase 9: Production Hardening

**Status:** Ready
**Branch:** `phase-9-production-hardening`
**Depends on:** Phase 8

## Context

The line between a demo and something a paying client can put in front of real users. Covers the security, resilience, and performance work that's easy to skip and expensive to skip.

## Functional Requirements

1. **Prompt injection defense:**
   - Sanitize/validate search query input before it reaches any LLM call — neutralize obvious injection patterns (e.g. "ignore previous instructions").
   - Every system prompt in the pipeline explicitly states that listing content and user queries are data, not instructions.
   - Re-seed one test listing with adversarial text embedded in its description (e.g. an instruction trying to manipulate the re-ranker) and write a test confirming it doesn't alter re-ranker behavior for unrelated listings.
2. **Rate limiting:** replace the Phase 6 placeholder with a Redis-backed limiter (e.g. `rate-limiter-flexible`), backed by **Render Key Value** (confirmed provider — see `specs/11-deployment.md`), tiered — e.g. 60/min authenticated, 20/min anonymous (stub the auth check if no auth system exists yet; document the stub explicitly).
3. **Caching:** Redis cache (Render Key Value) in front of the search pipeline, keyed on normalized query text + filter combination, sensible TTL (e.g. 10 minutes). Log cache hit/miss rate. The free-tier in-memory-only behavior (data lost on restart) is acceptable here since a cache miss simply falls back to the full pipeline — no correctness impact.
4. **Async ingestion:** move the Phase 2 ingestion pipeline onto a BullMQ queue backed by Render Key Value — listing ingestion becomes a background job rather than a blocking synchronous script. **Note:** on Render's free Key Value tier, queued jobs can be lost on a restart (see `specs/11-deployment.md` for the accepted-limitation/upgrade-trigger policy). Acceptable for this reference build; must be upgraded to a paid instance before any real client deployment.
5. **Error hygiene:** all client-facing error responses are structured and generic (no stack traces or internal details leaked); full details still logged server-side.
6. **Load test:** a script (e.g. using `autocannon`) simulating 50 concurrent users hitting `/api/search`, producing a report of latency percentiles and error rate.

## Interfaces

- No new public interfaces beyond what Phase 6 already exposes — this phase hardens existing behavior.
- New internal: BullMQ queue for ingestion jobs, Redis cache client, Redis-backed rate limiter middleware.

## Non-Functional Requirements

- Cache hit must measurably reduce both latency and LLM API cost for repeated queries — quantify both in the load test report.
- Load test report must include P50/P95/P99 latency and error rate at 50 concurrent users.

## Explicit Out of Scope

- No full auth system (rate limiter tiering is stubbed if auth doesn't exist yet — flagged as an open question below).
- No WAF/infra-level DDoS protection (out of application scope).

## Acceptance Criteria

- [ ] The adversarial-listing test confirms injected instructions in listing content do not alter re-ranker output for other listings.
- [ ] Redis-backed rate limiter correctly enforces documented tiers, verified by test.
- [ ] Repeated identical queries show a measurable latency and API-call reduction on cache hit vs. cache miss (documented with real numbers, not assumed).
- [ ] Ingestion jobs run via BullMQ, confirmed by triggering an ingestion job and observing it processed asynchronously without blocking the triggering request.
- [ ] A forced internal error (e.g. simulated DB failure) results in a generic client-facing error message with no leaked internals, while the full error is present in server logs.
- [ ] Load test report produced and reviewed — any P95 latency regression vs. the Phase 6 baseline is explained.

## Open Questions Claude Code Should Ask If Unclear

- ~~Since no auth system exists yet, confirm how the "authenticated vs anonymous" rate limit tier should be stubbed (e.g. treat all traffic as anonymous for now) rather than silently inventing a fake auth check.~~ **Resolved:** treat all traffic as anonymous (20/min). The authenticated tier (60/min) is implemented and unit-tested but nothing in the app currently triggers it — dormant until a real auth phase exists.

## Post-Merge Amendment (decided during Phase 9's own implementation planning — cache key scope)

**Gap:** requirement 3 specifies the cache is "keyed on normalized query text + filter combination." In this architecture `filters` is not an independent input — the `/api/search` request body is just `{ query: string }` (`backend/src/routes/search.ts`'s `searchRequestSchema`); filters are derived *from* the query text by `understandQuery()` (a Claude call), never supplied alongside it. So there are exactly two points a cache check could sit:

- **Before `understandQuery` runs** — the only key material that exists yet is the raw query text. This is also the only point where a hit skips the Claude call entirely.
- **After `understandQuery` runs** — `filters` would be available to key on too, but the Claude call has already been paid for, so a hit would only save Voyage/retrieval cost.

The non-functional requirement ("cache hit must measurably reduce both latency **and LLM API cost**") only holds if the cache check happens *before* understanding runs — which means there is no separate `filters` value in scope to key on at that point, by construction of this architecture, not by omission.

**Fix:** cache key is `search:v1:<normalizeQuery(rawQuery)>` — normalized query text only, checked before `understandQuery` is called. No separate filter component today.

**Trade-off accepted:** since `filters` is currently a deterministic function of the query text (no independent filter input exists), "same query text, different filter combination" cannot occur yet, so this loses no real cache correctness today. If a later phase adds a client-settable filter input independent of free text (e.g. a UI facet sidebar), the cache key must be revisited then, since only at that point would two requests share query text but differ in filters.

## Acceptance Criteria (amendment)

- [ ] Cache key derivation (`normalizeQuery` + `search:v1:` prefix) documented and implemented as the sole key, with no separate filters component — confirmed this matches the reasoning above, not an unreviewed simplification.

## Post-Merge Amendment (decided during Phase 9's own implementation review — job-level retries)

**Gap:** requirement 4's `worker.ts` correctly re-throws when `ingestListing` reports `'failed'`, so BullMQ classifies the job as failed rather than completed — but nothing configured how many times BullMQ should *attempt* the job. BullMQ's own default (confirmed against the installed `bullmq` source, not assumed) is effectively one attempt, no retry, regardless of whether the failure was permanent or transient. So a Claude timeout or a brief Voyage outage during ingestion got exactly the same one-shot treatment as a genuinely bad listing — the re-throw made the failure visible to BullMQ, but nothing was done with that visibility.

**Fix:** `createIngestionQueue` (`backend/src/services/ingestion/queue.ts`) now sets `defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5000 } }` on the `Queue` itself, so every job added via `enqueuePendingListings` inherits it without each call site needing to repeat it. This is a *slower* safety net than the retry already inside `callClaude`/`generateEmbedding` (CLAUDE.md rule #3) — those retry near-instantly within a single call; this retries the whole job again ~5s later, which is a more realistic window for a provider outage to actually clear.

**Retry-stacking, stated explicitly so "attempts: 2" isn't misread as "tried twice":** each BullMQ attempt runs `ingestListing`, which internally already gives extraction (Claude) and embedding (Voyage) their own up-to-2-attempts each. So the true worst-case call count before a listing is permanently marked failed is 2 (BullMQ attempts) × 4 (2 Claude + 2 Voyage attempts per `ingestListing` call) = up to 8 real API calls, not 2. Same layered-retry shape as any retry-wrapping-a-retry design — worth stating plainly rather than leaving "attempts: 2" to imply something smaller than what actually happens.

**Trade-off accepted:** `attempts: 2` (one retry) rather than higher — a listing that fails twice in a row, ~5s apart, is more likely a genuinely bad listing (e.g. empty/malformed description) than a still-recovering outage, and retrying indefinitely would delay `ingestion_status = 'failed'` from ever becoming visible for those genuine failures. Revisit if real usage shows outages routinely outlasting single-digit seconds.

## Acceptance Criteria (amendment)

- [ ] A job whose processor fails once and succeeds on the next attempt ends up `completed` in BullMQ (and, in the real pipeline, `ingestion_status = 'processed'` in Postgres) — not stuck failed after a single try. Verified by test (`queue.test.ts`).
