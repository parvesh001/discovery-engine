import type pg from 'pg';
import type { QueryIntent } from './queryUnderstanding.js';

export type ModelCallsLog = {
  query_understanding: { model: string; succeeded: boolean };
  embedding: { model: string } | null;
  rerank: { model: string; degraded: boolean } | null;
  failure?: { stage: 'retrieval'; error: true };
};

export type SearchLogEntry = {
  raw_query: string;
  extracted_intent: QueryIntent;
  candidate_ids: string[];
  ranked_ids: string[];
  latency_ms: number;
  model_calls: ModelCallsLog;
};

/**
 * Fire-and-forget from the route (spec 07: must not add latency to the response the user
 * waits on). Never rejects — any failure is logged here and swallowed, same pattern as
 * runIngestion.ts's markFailed, so a broken log write can never surface as an unhandled
 * rejection from a call site that doesn't await it.
 */
export async function logSearch(pool: pg.Pool, entry: SearchLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO search_logs (raw_query, extracted_intent, candidate_ids, ranked_ids, latency_ms, model_calls)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.raw_query,
        JSON.stringify(entry.extracted_intent),
        entry.candidate_ids,
        entry.ranked_ids,
        entry.latency_ms,
        JSON.stringify(entry.model_calls),
      ],
    );
  } catch (error) {
    console.error('[search] failed to write search_logs entry:', error);
  }
}
