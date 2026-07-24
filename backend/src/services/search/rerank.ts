import { z } from 'zod';
import { reserveSlot } from '../voyage/rateLimiter.js';
import type { RankedCandidate } from './retrieval.js';

/**
 * `relevanceScore` is nullable: candidates beyond the 20-item cap sent to Voyage are
 * appended after the reranked set, in their original incoming order, unscored — a
 * cost-driven cap (20) should not silently shrink the candidate set Phase 4 already did
 * real work assembling. Nullable (rather than a fabricated number) lets downstream
 * consumers (Phase 6, Phase 7's UI) tell "scored low" apart from "never scored" — the UI
 * must omit a score indicator for null, never render it as 0.
 */
export type RerankedCandidate = RankedCandidate & { relevanceScore: number | null };

export type RerankOutcome = {
  results: RerankedCandidate[];
  degraded: boolean;
};

const VOYAGE_RERANK_URL = 'https://api.voyageai.com/v1/rerank';
const RERANK_MODEL = 'rerank-2.5';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CANDIDATES_TO_MODEL = 20;

const voyageRerankResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int(),
      relevance_score: z.number(),
    }),
  ),
});

type VoyageRerankResult = z.infer<typeof voyageRerankResponseSchema>['data'][number];

export class RerankError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'RerankError';
    this.status = status;
  }
}

/**
 * Text fed to Voyage's cross-encoder per candidate. Same spirit as
 * `buildEmbeddingInput` (ingestion/embeddings.ts) but not required to match it —
 * includes structured fields (price, bedrooms, location) that reranking, unlike
 * embedding, can usefully condition on directly.
 */
export function buildRerankDocument(candidate: RankedCandidate): string {
  const attrs = candidate.extracted_attributes;
  const petFriendly = attrs === null || attrs.pet_friendly === null ? 'unknown' : attrs.pet_friendly ? 'yes' : 'no';

  return [
    `Title: ${candidate.title}`,
    `Description: ${candidate.raw_description}`,
    `Property type: ${attrs?.property_type ?? 'unknown'}`,
    `Pet friendly: ${petFriendly}`,
    `View: ${attrs?.view_type ?? 'none mentioned'}`,
    `Amenities: ${attrs && attrs.amenities.length > 0 ? attrs.amenities.join(', ') : 'none listed'}`,
    `Bedrooms: ${candidate.bedrooms ?? 'not specified'}`,
    `Price per night: ${candidate.price_per_night ?? 'not specified'}`,
    `Location: ${candidate.location ?? 'not specified'}`,
  ].join('\n');
}

function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function isTransientError(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  if (typeof status === 'number') {
    return isTransientStatus(status);
  }
  // Timeouts, network errors, and malformed/invalid responses (no status attached)
  // get the one retry too — a fresh call, not a correction prompt, since this is a
  // structured API, not a conversational model.
  return true;
}

/**
 * Cross-checks the response's index set against exactly the document positions sent
 * (0..documents.length-1, each present once) — zod only confirms shape, not that Voyage
 * actually scored what we sent.
 */
function validateIndexSet(data: VoyageRerankResult[], documentCount: number): void {
  if (data.length !== documentCount) {
    throw new RerankError(`Voyage rerank response returned ${data.length} results, expected ${documentCount}`);
  }
  const seen = new Set<number>();
  for (const item of data) {
    if (item.index < 0 || item.index >= documentCount) {
      throw new RerankError(`Voyage rerank response contained out-of-range index ${item.index}`);
    }
    if (seen.has(item.index)) {
      throw new RerankError(`Voyage rerank response contained duplicate index ${item.index}`);
    }
    seen.add(item.index);
  }
}

async function callVoyageRerankOnce(
  query: string,
  documents: string[],
  timeoutMs: number,
): Promise<VoyageRerankResult[]> {
  await reserveSlot();

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(VOYAGE_RERANK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        model: RERANK_MODEL,
        query,
        documents,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new RerankError(`Voyage rerank request failed with status ${response.status}: ${body}`, response.status);
    }

    const json: unknown = await response.json();
    const parsed = voyageRerankResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new RerankError(`Voyage rerank response failed validation: ${parsed.error.message}`);
    }

    validateIndexSet(parsed.data.data, documents.length);
    return parsed.data.data;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new RerankError(`Voyage rerank call timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function rerankViaVoyage(
  query: string,
  documents: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<VoyageRerankResult[]> {
  try {
    const result = await callVoyageRerankOnce(query, documents, timeoutMs);
    console.log('[rerank] voyage call succeeded');
    return result;
  } catch (firstError) {
    console.error('[rerank] voyage call failed (attempt 1):', firstError);

    if (!isTransientError(firstError)) {
      throw firstError instanceof RerankError ? firstError : new RerankError(String(firstError));
    }

    try {
      const result = await callVoyageRerankOnce(query, documents, timeoutMs);
      console.log('[rerank] voyage call succeeded on retry');
      return result;
    } catch (secondError) {
      console.error('[rerank] voyage call failed (attempt 2, giving up):', secondError);
      throw secondError instanceof RerankError ? secondError : new RerankError(String(secondError));
    }
  }
}

/**
 * Spec 06: cap the candidate set sent to Voyage at 20, taking the top 20 by incoming
 * similarityScore if more were passed in. Does not re-sort when already within budget —
 * only the over-budget case is defined behavior.
 */
export function selectTopCandidates(
  candidates: RankedCandidate[],
  limit: number = MAX_CANDIDATES_TO_MODEL,
): RankedCandidate[] {
  if (candidates.length <= limit) {
    return candidates;
  }
  return [...candidates].sort((a, b) => b.similarityScore - a.similarityScore).slice(0, limit);
}

function toFallback(candidates: RankedCandidate[]): RerankOutcome {
  return {
    results: candidates.map((c) => ({ ...c, relevanceScore: null })),
    degraded: true,
  };
}

function logLatency(startedAt: number, candidateCount: number, degraded: boolean): void {
  const latencyMs = Date.now() - startedAt;
  console.log(`[rerank] latency_ms=${latencyMs} candidate_count=${candidateCount} degraded=${degraded}`);
}

/**
 * Re-ranks retrieval candidates using Voyage's rerank-2.5 cross-encoder (spec 06),
 * spending a small amount of extra compute on a capped candidate set to get precision
 * right where embedding similarity alone is weak (subjective/implied intent). Never
 * throws (CLAUDE.md rule #3): any failure — network, timeout, malformed response, bad
 * index set — degrades to the original incoming candidate order, unmodified, with
 * degraded: true.
 */
export async function rerank(query: string, candidates: RankedCandidate[]): Promise<RerankOutcome> {
  const startedAt = Date.now();
  const sentCandidates = selectTopCandidates(candidates);
  const documents = sentCandidates.map(buildRerankDocument);

  try {
    const scored = await rerankViaVoyage(query, documents);

    const scoreByIndex = new Map(scored.map((item) => [item.index, item.relevance_score]));
    const rerankedTop: RerankedCandidate[] = sentCandidates
      .map((candidate, index) => {
        const relevanceScore = scoreByIndex.get(index);
        if (relevanceScore === undefined) {
          // Unreachable: validateIndexSet already confirmed every sent index got a score.
          // Thrown (not silently defaulted) so it's caught below and still degrades safely,
          // rather than masquerading as a legitimate "beyond the cap" unscored candidate.
          throw new RerankError(`Missing relevance score for document index ${index}`);
        }
        return { ...candidate, relevanceScore };
      })
      .sort((a, b) => b.relevanceScore! - a.relevanceScore!);

    const sentIds = new Set(sentCandidates.map((c) => c.id));
    const unscoredTail: RerankedCandidate[] = candidates
      .filter((c) => !sentIds.has(c.id))
      .map((c) => ({ ...c, relevanceScore: null }));

    logLatency(startedAt, candidates.length, false);
    return { results: [...rerankedTop, ...unscoredTail], degraded: false };
  } catch (error) {
    console.warn('[rerank] falling back to original order:', error);
    logLatency(startedAt, candidates.length, true);
    return toFallback(candidates);
  }
}
