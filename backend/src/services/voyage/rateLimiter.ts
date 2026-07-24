// Voyage's rate limits are account-wide across all models/endpoints (confirmed via their
// docs), not per-endpoint — the free tier's 3 requests/minute cap without a payment method
// is shared by embeddings and reranking alike. So every call to any Voyage endpoint, across
// all callers (embeddings.ts, rerank.ts) and including retries, is serialized through this
// single global slot queue spaced to stay under that ceiling. Override via
// VOYAGE_MAX_REQUESTS_PER_MINUTE once a payment method raises the account's real limit; no
// code change needed.
function getMinIntervalMs(): number {
  const maxRequestsPerMinute = Number(process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE ?? 3);
  return Math.ceil(60_000 / maxRequestsPerMinute);
}

let nextSlotAt = 0;
let slotChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function reserveSlot(): Promise<void> {
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
