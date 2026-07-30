import { Langfuse } from 'langfuse';
import type { LangfuseSpanClient, LangfuseTraceClient } from 'langfuse';

/**
 * Anything a generation or span can be attached to. `end()` on the returned observation is
 * always the caller's responsibility — this module only ever hands back freshly-started
 * (unstarted-end) clients.
 */
export type LangfuseParent = LangfuseTraceClient | LangfuseSpanClient;

let client: Langfuse | null | undefined;

/**
 * Missing keys degrade to "tracing is off," not a startup failure — env.ts already makes
 * LANGFUSE_PUBLIC_KEY/SECRET_KEY required for the real server and scripts (CLAUDE.md-style
 * fail-fast), but plenty of test/script contexts never call loadEnv() at all and must still
 * be able to import and exercise this pipeline untraced.
 */
function getLangfuseClient(): Langfuse | null {
  if (client !== undefined) {
    return client;
  }
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    client = null;
    return client;
  }
  client = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASEURL,
  });
  return client;
}

/**
 * Tracing must never be a new way to fail a search or an ingestion run (same spirit as
 * CLAUDE.md rule #3, applied to observability instead of LLM calls) — every function below
 * catches and logs internally rather than throwing, and callers get `null` back on any
 * failure so they can simply skip attaching child observations.
 */
export function startSearchTrace(rawQuery: string): LangfuseTraceClient | null {
  const langfuse = getLangfuseClient();
  if (!langfuse) {
    return null;
  }
  try {
    return langfuse.trace({ name: 'search', input: { rawQuery }, tags: ['search'] });
  } catch (error) {
    console.error('[observability] failed to start search trace:', error);
    return null;
  }
}

export function startIngestionTrace(listingId: string): LangfuseTraceClient | null {
  const langfuse = getLangfuseClient();
  if (!langfuse) {
    return null;
  }
  try {
    return langfuse.trace({ name: 'ingestion', input: { listingId }, tags: ['ingestion'], metadata: { listingId } });
  } catch (error) {
    console.error('[observability] failed to start ingestion trace:', error);
    return null;
  }
}

export type GenerationUsage = { inputTokens: number; outputTokens: number };

/**
 * Starts and immediately ends a Langfuse **generation** — for the two real Claude call
 * sites (extraction, query_understanding). `parent` is whatever trace/span the caller is
 * currently inside; `null` (tracing off, or the parent itself failed to start) is a no-op.
 */
export function recordGeneration(
  parent: LangfuseParent | null,
  opts: { name: string; model: string; input: unknown; output: string; usage: GenerationUsage; startTime: Date },
): void {
  if (!parent) {
    return;
  }
  try {
    parent
      .generation({
        name: opts.name,
        model: opts.model,
        input: opts.input,
        startTime: opts.startTime,
      })
      .end({
        output: opts.output,
        usage: { input: opts.usage.inputTokens, output: opts.usage.outputTokens, unit: 'TOKENS' },
      });
  } catch (error) {
    console.error(`[observability] failed to record Langfuse generation (${opts.name}):`, error);
  }
}

/**
 * Starts and immediately ends a Langfuse **span** — for the Voyage call sites (embedding,
 * rerank), which are real AI calls but not Claude generations, so they don't get token-cost
 * generation semantics from Langfuse, just latency/input/output visibility.
 */
export function recordSpan(
  parent: LangfuseParent | null,
  opts: { name: string; input: unknown; output: unknown; metadata?: Record<string, unknown>; startTime: Date },
): void {
  if (!parent) {
    return;
  }
  try {
    parent
      .span({ name: opts.name, input: opts.input, startTime: opts.startTime, metadata: opts.metadata })
      .end({ output: opts.output });
  } catch (error) {
    console.error(`[observability] failed to record Langfuse span (${opts.name}):`, error);
  }
}

/**
 * Ensures batched events are actually sent before a one-off script's process exits (the
 * long-running server flushes on its own timer instead). Never rejects.
 */
export async function flushLangfuse(): Promise<void> {
  const langfuse = getLangfuseClient();
  if (!langfuse) {
    return;
  }
  try {
    await langfuse.flushAsync();
  } catch (error) {
    console.error('[observability] failed to flush Langfuse events:', error);
  }
}
