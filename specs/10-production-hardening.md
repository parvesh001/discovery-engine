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
