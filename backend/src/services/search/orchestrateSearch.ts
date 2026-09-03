import type pg from 'pg';
import type { Redis } from 'ioredis';
import { understandQuery, QUERY_MODEL, type QueryIntent } from './queryUnderstanding.js';
import { retrieveCandidates, type Listing } from './retrieval.js';
import { rerank, RERANK_MODEL } from './rerank.js';
import { EMBEDDING_MODEL } from '../ingestion/embeddings.js';
import type { SearchLogEntry } from './searchLogs.js';
import { startSearchTrace } from '../observability/langfuse.js';
import { sanitizeQuery } from './querySanitization.js';
import { getCachedSearch, setCachedSearch } from '../cache/searchCache.js';

export type SearchResponse = {
  results: Array<Listing & { relevanceScore: number | null }>;
  degraded: boolean;
  filtersRelaxed: boolean;
  timing: { understanding_ms: number; retrieval_ms: number; rerank_ms: number; total_ms: number };
};

const FALLBACK_FILTERS: QueryIntent['filters'] = {
  pet_friendly: null,
  property_type: null,
  location: null,
  min_bedrooms: null,
  max_price: null,
};

/**
 * Thrown only when retrieveCandidates fails — the one pipeline stage with no fallback
 * (spec 07). Carries a best-effort SearchLogEntry built from whatever ran before the
 * failure, so the route can still write a search_logs row for the failed request instead
 * of silently missing exactly the requests most worth investigating later.
 */
export class SearchRetrievalError extends Error {
  constructor(
    public readonly cause: unknown,
    public readonly partialLogEntry: SearchLogEntry,
  ) {
    super('retrieveCandidates failed');
    this.name = 'SearchRetrievalError';
  }
}

/**
 * Orchestrates understandQuery -> retrieveCandidates -> rerank (spec 07), degrading
 * per-stage rather than failing the whole request:
 *  - understandQuery failure: fall back to the raw query as semantic_query with all
 *    filters null, and continue.
 *  - retrieveCandidates failure: no fallback exists for this stage — rejects with
 *    SearchRetrievalError so the route can return the one allowed non-200 response.
 *  - rerank failure: already handled inside rerank() itself, which never throws and
 *    returns { results, degraded: true } instead.
 *
 * A single Langfuse trace (spec 09) spans the whole request: query_understanding is a
 * real Claude generation, embedding and rerank are Voyage spans — all three attached as
 * children of `trace` so they show up nested under one search in the Langfuse dashboard.
 *
 * `destination` (spec 12) is an optional, pre-validated demo scope slug. When present it
 * namespaces the cache key and is passed to retrieveCandidates as an authoritative,
 * non-relaxable SQL filter. Absent → today's global behaviour, unchanged (the eval
 * harness and any other caller that omits it are unaffected).
 */
export async function runSearch(
  pool: pg.Pool,
  rawQuery: string,
  redis: Redis,
  destination?: string,
): Promise<{ response: SearchResponse; logEntry: SearchLogEntry }> {
  const totalStart = Date.now();

  // Checked before anything else — including before sanitizeQuery/understandQuery — so a
  // hit skips Claude *and* Voyage entirely (spec 10, requirement 3's NFR: a cache hit must
  // reduce LLM API cost, not just latency). See the spec's Post-Merge Amendment (cache key
  // scope) for why the key is normalized query text alone.
  const cached = await getCachedSearch(redis, rawQuery, destination);
  if (cached) {
    const total_ms = Date.now() - totalStart;
    const resultIds = cached.response.results.map((r) => r.id);
    const response: SearchResponse = {
      ...cached.response,
      // The cached timing reflects whatever run originally populated this entry — replaced
      // here with this request's actual (near-zero) latency, not stale numbers.
      timing: { understanding_ms: 0, retrieval_ms: 0, rerank_ms: 0, total_ms },
    };
    const logEntry: SearchLogEntry = {
      raw_query: rawQuery,
      extracted_intent: cached.intent,
      candidate_ids: resultIds,
      ranked_ids: resultIds,
      latency_ms: total_ms,
      model_calls: {
        query_understanding: { model: QUERY_MODEL, succeeded: true, usage: null },
        embedding: null,
        rerank: null,
        cache: { hit: true },
      },
    };
    return { response, logEntry };
  }

  const trace = startSearchTrace(rawQuery);

  // Sanitized once, at this single choke point, before the query reaches any LLM call
  // (CLAUDE.md rule #4 / spec 10) — including the understandQuery failure fallback below,
  // which otherwise passes the raw string straight through as semantic_query. `rawQuery`
  // itself is left untouched for logging/response fidelity; only `sanitizedQuery` feeds
  // Claude/Voyage from here on.
  const { sanitized: sanitizedQuery } = sanitizeQuery(rawQuery);

  const understandingStart = Date.now();
  let intent: QueryIntent;
  let understandingSucceeded: boolean;
  let understandingUsage: { inputTokens: number; outputTokens: number } | null;
  try {
    const result = await understandQuery(sanitizedQuery, trace);
    intent = result.intent;
    understandingUsage = result.usage;
    understandingSucceeded = true;
  } catch (error) {
    console.error('[search] understandQuery failed, falling back to raw query as semantic_query:', error);
    intent = { filters: { ...FALLBACK_FILTERS }, semantic_query: sanitizedQuery };
    understandingUsage = null;
    understandingSucceeded = false;
  }
  const understanding_ms = Date.now() - understandingStart;

  const retrievalStart = Date.now();
  let retrieval: Awaited<ReturnType<typeof retrieveCandidates>>;
  try {
    retrieval = await retrieveCandidates(pool, intent, trace, destination);
  } catch (error) {
    console.error('[search] retrieveCandidates failed:', error);
    const partialLogEntry: SearchLogEntry = {
      raw_query: rawQuery,
      extracted_intent: intent,
      candidate_ids: [],
      ranked_ids: [],
      latency_ms: Date.now() - totalStart,
      model_calls: {
        query_understanding: { model: QUERY_MODEL, succeeded: understandingSucceeded, usage: understandingUsage },
        embedding: null,
        rerank: null,
        failure: { stage: 'retrieval', error: true },
        cache: { hit: false },
      },
    };
    throw new SearchRetrievalError(error, partialLogEntry);
  }
  const retrieval_ms = Date.now() - retrievalStart;

  const rerankStart = Date.now();
  const rerankOutcome = await rerank(intent.semantic_query, retrieval.candidates, trace);
  const rerank_ms = Date.now() - rerankStart;

  const results = rerankOutcome.results.map(({ similarityScore: _similarityScore, ...rest }) => rest);
  const total_ms = Date.now() - totalStart;

  const response: SearchResponse = {
    results,
    degraded: rerankOutcome.degraded,
    filtersRelaxed: retrieval.filtersRelaxed,
    timing: { understanding_ms, retrieval_ms, rerank_ms, total_ms },
  };

  const logEntry: SearchLogEntry = {
    raw_query: rawQuery,
    extracted_intent: intent,
    candidate_ids: retrieval.candidates.map((c) => c.id),
    ranked_ids: rerankOutcome.results.map((c) => c.id),
    latency_ms: total_ms,
    model_calls: {
      query_understanding: { model: QUERY_MODEL, succeeded: understandingSucceeded, usage: understandingUsage },
      embedding: { model: EMBEDDING_MODEL, tokens: retrieval.embeddingTokens },
      rerank: { model: RERANK_MODEL, degraded: rerankOutcome.degraded, tokens: rerankOutcome.tokens },
      cache: { hit: false },
    },
  };

  // Only a clean success is cached — a degraded rerank or a fallen-back understanding
  // stage reflects a transient failure, and caching that for 10 minutes would replay it to
  // every repeated query in that window instead of letting the next request retry cleanly.
  if (understandingSucceeded && !rerankOutcome.degraded) {
    await setCachedSearch(redis, rawQuery, { response, intent }, destination);
  }

  return { response, logEntry };
}
