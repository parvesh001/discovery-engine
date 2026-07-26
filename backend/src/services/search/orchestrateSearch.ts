import type pg from 'pg';
import { understandQuery, QUERY_MODEL, type QueryIntent } from './queryUnderstanding.js';
import { retrieveCandidates, type Listing } from './retrieval.js';
import { rerank, RERANK_MODEL } from './rerank.js';
import { EMBEDDING_MODEL } from '../ingestion/embeddings.js';
import type { SearchLogEntry } from './searchLogs.js';

export type SearchResponse = {
  results: Array<Listing & { relevanceScore: number | null }>;
  degraded: boolean;
  filtersRelaxed: boolean;
  timing: { understanding_ms: number; retrieval_ms: number; rerank_ms: number; total_ms: number };
};

const FALLBACK_FILTERS: QueryIntent['filters'] = {
  pet_friendly: null,
  property_type: null,
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
 */
export async function runSearch(
  pool: pg.Pool,
  rawQuery: string,
): Promise<{ response: SearchResponse; logEntry: SearchLogEntry }> {
  const totalStart = Date.now();

  const understandingStart = Date.now();
  let intent: QueryIntent;
  let understandingSucceeded: boolean;
  try {
    intent = await understandQuery(rawQuery);
    understandingSucceeded = true;
  } catch (error) {
    console.error('[search] understandQuery failed, falling back to raw query as semantic_query:', error);
    intent = { filters: { ...FALLBACK_FILTERS }, semantic_query: rawQuery };
    understandingSucceeded = false;
  }
  const understanding_ms = Date.now() - understandingStart;

  const retrievalStart = Date.now();
  let retrieval: Awaited<ReturnType<typeof retrieveCandidates>>;
  try {
    retrieval = await retrieveCandidates(pool, intent);
  } catch (error) {
    console.error('[search] retrieveCandidates failed:', error);
    const partialLogEntry: SearchLogEntry = {
      raw_query: rawQuery,
      extracted_intent: intent,
      candidate_ids: [],
      ranked_ids: [],
      latency_ms: Date.now() - totalStart,
      model_calls: {
        query_understanding: { model: QUERY_MODEL, succeeded: understandingSucceeded },
        embedding: null,
        rerank: null,
        failure: { stage: 'retrieval', error: true },
      },
    };
    throw new SearchRetrievalError(error, partialLogEntry);
  }
  const retrieval_ms = Date.now() - retrievalStart;

  const rerankStart = Date.now();
  const rerankOutcome = await rerank(intent.semantic_query, retrieval.candidates);
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
      query_understanding: { model: QUERY_MODEL, succeeded: understandingSucceeded },
      embedding: { model: EMBEDDING_MODEL },
      rerank: { model: RERANK_MODEL, degraded: rerankOutcome.degraded },
    },
  };

  return { response, logEntry };
}
