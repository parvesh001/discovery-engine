import type { ExtractedAttributes } from './extraction.js';

const VOYAGE_EMBEDDINGS_URL = 'https://api.voyageai.com/v1/embeddings';
const EMBEDDING_MODEL = 'voyage-4';
const EMBEDDING_DIMENSION = 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

// Voyage's default free tier (no payment method on file) caps requests at 3/minute
// regardless of our own ingestion concurrency, so every call — across all concurrent
// listings, including retries — is serialized through a single global slot queue
// spaced to stay under that ceiling. Override via VOYAGE_MAX_REQUESTS_PER_MINUTE once
// a payment method raises the account's real limit; no code change needed.
function getMinIntervalMs(): number {
  const maxRequestsPerMinute = Number(process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE ?? 3);
  return Math.ceil(60_000 / maxRequestsPerMinute);
}

let nextSlotAt = 0;
let slotChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reserveSlot(): Promise<void> {
  const reserved = slotChain.then(async () => {
    const waitMs = Math.max(0, nextSlotAt - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    nextSlotAt = Date.now() + getMinIntervalMs();
  });
  slotChain = reserved;
  return reserved;
}

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/**
 * Deterministic concatenation fed to the embedding model. Format matters for
 * retrieval quality, so keep this in sync with anything that documents it
 * (specs/03-ingestion-pipeline.md).
 *
 *   Title: {title}
 *   Description: {rawDescription}
 *   Property type: {attributes.property_type}
 *   Pet friendly: yes | no | unknown
 *   View: {attributes.view_type} | 'none mentioned'
 *   Amenities: {comma-joined list} | 'none listed'
 *   Bedrooms mentioned: {attributes.bedrooms_mentioned} | 'not specified'
 */
export function buildEmbeddingInput(title: string, rawDescription: string, attributes: ExtractedAttributes): string {
  const petFriendly = attributes.pet_friendly === null ? 'unknown' : attributes.pet_friendly ? 'yes' : 'no';

  return [
    `Title: ${title}`,
    `Description: ${rawDescription}`,
    `Property type: ${attributes.property_type}`,
    `Pet friendly: ${petFriendly}`,
    `View: ${attributes.view_type ?? 'none mentioned'}`,
    `Amenities: ${attributes.amenities.length > 0 ? attributes.amenities.join(', ') : 'none listed'}`,
    `Bedrooms mentioned: ${attributes.bedrooms_mentioned ?? 'not specified'}`,
  ].join('\n');
}

type VoyageEmbeddingsResponse = {
  data: { embedding: number[] }[];
};

function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

async function callVoyageOnce(text: string, timeoutMs: number): Promise<number[]> {
  await reserveSlot();

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(VOYAGE_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: [text],
        output_dimension: EMBEDDING_DIMENSION,
        input_type: 'document',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new EmbeddingError(`Voyage embeddings request failed with status ${response.status}: ${body}`);
      (error as EmbeddingError & { status?: number }).status = response.status;
      throw error;
    }

    const json = (await response.json()) as VoyageEmbeddingsResponse;
    const embedding = json.data[0]?.embedding;
    if (!embedding) {
      throw new EmbeddingError('Voyage embeddings response contained no embedding data');
    }
    return embedding;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new EmbeddingError(`Voyage embeddings call timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function isTransientError(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  if (typeof status === 'number') {
    return isTransientStatus(status);
  }
  // Timeouts, network errors, and anything unrecognized get the one retry too.
  return true;
}

export async function generateEmbedding(text: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<number[]> {
  try {
    const embedding = await callVoyageOnce(text, timeoutMs);
    console.log('[embeddings] voyage call succeeded');
    return embedding;
  } catch (firstError) {
    console.error('[embeddings] voyage call failed (attempt 1):', firstError);

    if (!isTransientError(firstError)) {
      throw firstError instanceof EmbeddingError ? firstError : new EmbeddingError(String(firstError));
    }

    try {
      const embedding = await callVoyageOnce(text, timeoutMs);
      console.log('[embeddings] voyage call succeeded on retry');
      return embedding;
    } catch (secondError) {
      console.error('[embeddings] voyage call failed (attempt 2, giving up):', secondError);
      throw secondError instanceof EmbeddingError ? secondError : new EmbeddingError(String(secondError));
    }
  }
}
