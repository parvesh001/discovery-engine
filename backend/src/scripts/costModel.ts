import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { loadEnv, type Env } from '../env.js';
import { writeReportSection } from '../evals/reportWriter.js';

const REPORT_PATH = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../EVAL_REPORT.md');

// How many recent rows to sample per table. Recent-N rather than a time window so the
// model stays meaningful on a lightly-trafficked dev/demo dataset.
const SAMPLE_SIZE = 500;

/**
 * Anthropic Claude Haiku 4.5 pricing (model claude-haiku-4-5-20251001, used for both
 * extraction and query_understanding) — confirmed via the claude-api skill's cached
 * model table on 2026-07-28 (table itself dated 2026-06-24). Re-check
 * https://platform.claude.com/docs/en/pricing before trusting this if it's been a while.
 */
const HAIKU_INPUT_PRICE_PER_MILLION = 1.0;
const HAIKU_OUTPUT_PRICE_PER_MILLION = 5.0;

/**
 * Voyage AI pricing (voyage-4 embeddings, rerank-2.5) — NOT independently verified
 * against a live source for this phase; no Voyage-pricing skill or API was available.
 * These are approximate figures and MUST be checked against
 * https://docs.voyageai.com/docs/pricing before this cost model is treated as
 * authoritative — same "verify against the provider's dashboard" discipline CLAUDE.md
 * already calls out for VOYAGE_MAX_REQUESTS_PER_MINUTE.
 */
const VOYAGE_EMBEDDING_PRICE_PER_MILLION = 0.06; // voyage-4
const VOYAGE_RERANK_PRICE_PER_MILLION = 0.05; // rerank-2.5

const TRAFFIC_TIERS_PER_DAY = [100, 1_000, 10_000];

type SearchLogRow = {
  created_at: Date;
  model_calls: {
    query_understanding: { usage: { inputTokens: number; outputTokens: number } | null };
    embedding: { tokens: number | null } | null;
    rerank: { tokens: number | null } | null;
  };
};

type IngestionLogRow = {
  created_at: Date;
  extraction_input_tokens: number | null;
  extraction_output_tokens: number | null;
  embedding_tokens: number | null;
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function haikuCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * HAIKU_INPUT_PRICE_PER_MILLION +
    (outputTokens / 1_000_000) * HAIKU_OUTPUT_PRICE_PER_MILLION
  );
}

export function costPerQuery(avgUnderstandingInput: number, avgUnderstandingOutput: number, avgEmbeddingTokens: number, avgRerankTokens: number): number {
  const understandingCost = haikuCost(avgUnderstandingInput, avgUnderstandingOutput);
  const embeddingCost = (avgEmbeddingTokens / 1_000_000) * VOYAGE_EMBEDDING_PRICE_PER_MILLION;
  const rerankCost = (avgRerankTokens / 1_000_000) * VOYAGE_RERANK_PRICE_PER_MILLION;
  return understandingCost + embeddingCost + rerankCost;
}

export function costPerListingIngested(avgExtractionInput: number, avgExtractionOutput: number, avgEmbeddingTokens: number): number {
  const extractionCost = haikuCost(avgExtractionInput, avgExtractionOutput);
  const embeddingCost = (avgEmbeddingTokens / 1_000_000) * VOYAGE_EMBEDDING_PRICE_PER_MILLION;
  return extractionCost + embeddingCost;
}

function formatUsd(amount: number): string {
  if (amount === 0) {
    return '$0.00';
  }
  return amount < 0.01 ? `$${amount.toFixed(6)}` : `$${amount.toFixed(4)}`;
}

async function fetchSearchLogStats(pool: pg.Pool): Promise<{
  rowCount: number;
  dateRange: { earliest: Date; latest: Date } | null;
  avgUnderstandingInput: number;
  avgUnderstandingOutput: number;
  avgEmbeddingTokens: number;
  avgRerankTokens: number;
}> {
  const { rows } = await pool.query<SearchLogRow>(
    `SELECT created_at, model_calls FROM search_logs ORDER BY created_at DESC LIMIT $1`,
    [SAMPLE_SIZE],
  );

  const understandingInputs = rows
    .map((r) => r.model_calls.query_understanding?.usage?.inputTokens)
    .filter((v): v is number => typeof v === 'number');
  const understandingOutputs = rows
    .map((r) => r.model_calls.query_understanding?.usage?.outputTokens)
    .filter((v): v is number => typeof v === 'number');
  const embeddingTokens = rows
    .map((r) => r.model_calls.embedding?.tokens)
    .filter((v): v is number => typeof v === 'number');
  const rerankTokens = rows
    .map((r) => r.model_calls.rerank?.tokens)
    .filter((v): v is number => typeof v === 'number');

  const dateRange =
    rows.length > 0
      ? { earliest: rows[rows.length - 1]!.created_at, latest: rows[0]!.created_at }
      : null;

  return {
    rowCount: rows.length,
    dateRange,
    avgUnderstandingInput: average(understandingInputs),
    avgUnderstandingOutput: average(understandingOutputs),
    avgEmbeddingTokens: average(embeddingTokens),
    avgRerankTokens: average(rerankTokens),
  };
}

async function fetchIngestionLogStats(pool: pg.Pool): Promise<{
  rowCount: number;
  dateRange: { earliest: Date; latest: Date } | null;
  avgExtractionInput: number;
  avgExtractionOutput: number;
  avgEmbeddingTokens: number;
}> {
  const { rows } = await pool.query<IngestionLogRow>(
    `SELECT created_at, extraction_input_tokens, extraction_output_tokens, embedding_tokens
     FROM ingestion_logs ORDER BY created_at DESC LIMIT $1`,
    [SAMPLE_SIZE],
  );

  const dateRange =
    rows.length > 0
      ? { earliest: rows[rows.length - 1]!.created_at, latest: rows[0]!.created_at }
      : null;

  return {
    rowCount: rows.length,
    dateRange,
    avgExtractionInput: average(rows.map((r) => r.extraction_input_tokens).filter((v): v is number => typeof v === 'number')),
    avgExtractionOutput: average(rows.map((r) => r.extraction_output_tokens).filter((v): v is number => typeof v === 'number')),
    avgEmbeddingTokens: average(rows.map((r) => r.embedding_tokens).filter((v): v is number => typeof v === 'number')),
  };
}

function buildReportBody(
  searchStats: Awaited<ReturnType<typeof fetchSearchLogStats>>,
  ingestionStats: Awaited<ReturnType<typeof fetchIngestionLogStats>>,
): string {
  const perQuery = costPerQuery(
    searchStats.avgUnderstandingInput,
    searchStats.avgUnderstandingOutput,
    searchStats.avgEmbeddingTokens,
    searchStats.avgRerankTokens,
  );

  const lines: string[] = [];
  lines.push(`Generated by \`pnpm --filter backend run cost-model\` on ${new Date().toISOString()}.`);
  lines.push('');
  lines.push('### Data source');
  lines.push('');
  lines.push(
    `- **Search-time stages** (query_understanding, embedding, rerank): averaged over the ${searchStats.rowCount} most recent \`search_logs\` rows` +
      (searchStats.dateRange
        ? ` (${searchStats.dateRange.earliest.toISOString()} to ${searchStats.dateRange.latest.toISOString()}).`
        : ' (no rows found — run some searches first).'),
  );
  lines.push(
    `- **Ingestion-time stages** (extraction, embedding): averaged over the ${ingestionStats.rowCount} most recent \`ingestion_logs\` rows` +
      (ingestionStats.dateRange
        ? ` (${ingestionStats.dateRange.earliest.toISOString()} to ${ingestionStats.dateRange.latest.toISOString()}).`
        : ' (no rows found — run ingestion first).'),
  );
  lines.push(
    `- Pricing: Anthropic Claude Haiku 4.5 confirmed 2026-07-28 (see source comment in costModel.ts); Voyage AI (voyage-4, rerank-2.5) **not independently verified this phase** — check https://docs.voyageai.com/docs/pricing before treating these numbers as authoritative.`,
  );
  lines.push('');
  lines.push('### $/query and $/1000-searches (search-time pipeline only)');
  lines.push('');
  lines.push(
    `Search-time cost per query = query_understanding (avg ${searchStats.avgUnderstandingInput.toFixed(0)} in / ${searchStats.avgUnderstandingOutput.toFixed(0)} out tokens, Haiku) + embedding (avg ${searchStats.avgEmbeddingTokens.toFixed(0)} tokens, voyage-4) + rerank (avg ${searchStats.avgRerankTokens.toFixed(0)} tokens, rerank-2.5). Does not include ingestion cost, which is a one-time per-listing cost, not a per-query cost — see the separate table below.`,
  );
  lines.push('');
  lines.push(`**$/query: ${formatUsd(perQuery)}**`);
  lines.push('');
  lines.push('| Traffic tier | Searches/day | $/1000-searches | Est. $/day |');
  lines.push('|---|---|---|---|');
  for (const perDay of TRAFFIC_TIERS_PER_DAY) {
    const per1000 = perQuery * 1000;
    const perDayCost = perQuery * perDay;
    lines.push(`| ${perDay}/day | ${perDay} | ${formatUsd(per1000)} | ${formatUsd(perDayCost)} |`);
  }
  lines.push('');
  lines.push('### Per-listing ingestion cost (informational — not part of $/query)');
  lines.push('');
  const perListing = costPerListingIngested(
    ingestionStats.avgExtractionInput,
    ingestionStats.avgExtractionOutput,
    ingestionStats.avgEmbeddingTokens,
  );
  lines.push(
    `Extraction (avg ${ingestionStats.avgExtractionInput.toFixed(0)} in / ${ingestionStats.avgExtractionOutput.toFixed(0)} out tokens, Haiku) + embedding (avg ${ingestionStats.avgEmbeddingTokens.toFixed(0)} tokens, voyage-4) = **${formatUsd(perListing)}/listing ingested**, a one-time cost independent of search traffic.`,
  );

  return lines.join('\n');
}

function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await import('dotenv/config');
  const env = loadEnvOrExit();
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

  try {
    const [searchStats, ingestionStats] = await Promise.all([fetchSearchLogStats(pool), fetchIngestionLogStats(pool)]);

    const body = buildReportBody(searchStats, ingestionStats);
    await writeReportSection(REPORT_PATH, 'COST_MODEL', body);

    console.log(body);
    console.log(`\nWrote cost model to ${REPORT_PATH}`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
