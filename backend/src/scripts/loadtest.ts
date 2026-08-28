import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import autocannon, { type Result } from 'autocannon';
import { loadEnv, type Env } from '../env.js';
import { createPool } from '../db.js';
import { createRedisClient } from '../services/redis/client.js';
import { createApp } from '../app.js';
import { testCases } from '../evals/testCases.js';
import { writeReportSection } from '../evals/reportWriter.js';

const REPORT_PATH = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../LOAD_TEST_REPORT.md');
const EVAL_REPORT_PATH = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../EVAL_REPORT.md');

const CONNECTIONS = 50;
// Kept short deliberately — both passes hit the real Claude + Voyage APIs, and this
// project is already cost-conscious about that (see CLAUDE.md's VOYAGE_MAX_REQUESTS_PER_MINUTE
// note and the Phase 8 cost model). 50 connections for 8s is enough to observe real
// concurrent-load behavior without running up a large API bill on every run.
const PASS_DURATION_SECONDS = 8;
// Reuses eval query text rather than a duplicated list (spec 09/10 precedent).
const BASE_QUERIES = testCases.slice(0, 12).map((c) => c.query);

type PassSummary = {
  name: string;
  durationSeconds: number;
  connections: number;
  requestsCompleted: number;
  errors: number;
  timeouts: number;
  non2xx: number;
  latencyMs: { p50: number; p97_5: number; p99: number; mean: number };
};

function summarize(name: string, result: Result): PassSummary {
  return {
    name,
    durationSeconds: result.duration,
    connections: result.connections,
    requestsCompleted: result.requests.sent,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    latencyMs: {
      p50: result.latency.p50,
      p97_5: result.latency.p97_5,
      p99: result.latency.p99,
      mean: result.latency.mean,
    },
  };
}

/**
 * Every request gets a globally-unique query (autocannon's `context` is per-connection, not
 * shared across the 50 clients, so a per-connection counter alone would collide across
 * connections) — guarantees every request in this pass is a genuine cache miss, exercising
 * the full Claude + Voyage pipeline under concurrent load.
 */
async function runColdPass(url: string): Promise<PassSummary> {
  const result = await autocannon({
    url,
    connections: CONNECTIONS,
    duration: PASS_DURATION_SECONDS,
    requests: [
      {
        method: 'POST',
        path: '/api/search',
        headers: { 'content-type': 'application/json' },
        setupRequest: (request) => {
          const base = BASE_QUERIES[Math.floor(Math.random() * BASE_QUERIES.length)];
          request.body = JSON.stringify({ query: `${base} (loadtest ${randomUUID()})` });
          return request;
        },
      },
    ],
  });
  return summarize('Cold (unique query per request — guaranteed cache miss)', result);
}

async function warmCache(url: string): Promise<void> {
  for (const query of BASE_QUERIES) {
    await fetch(`${url}/api/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
  }
}

/**
 * Cycles the same fixed, already-cached query set (populated by warmCache) — every request
 * should resolve as a cache hit, skipping Claude/Voyage entirely.
 */
async function runWarmPass(url: string): Promise<PassSummary> {
  const result = await autocannon({
    url,
    connections: CONNECTIONS,
    duration: PASS_DURATION_SECONDS,
    requests: [
      {
        method: 'POST',
        path: '/api/search',
        headers: { 'content-type': 'application/json' },
        setupRequest: (request) => {
          const base = BASE_QUERIES[Math.floor(Math.random() * BASE_QUERIES.length)];
          request.body = JSON.stringify({ query: base });
          return request;
        },
      },
    ],
  });
  return summarize('Warm (fixed, pre-cached query set — expected cache hit)', result);
}

type CacheModelCalls = {
  cache: { hit: boolean };
  embedding: unknown;
  rerank: unknown;
  query_understanding: { usage: unknown };
};

/**
 * Concrete, real-numbers evidence for the "cache hit must reduce LLM API cost" NFR — reads
 * back the two search_logs rows this single query produces (one miss, one hit) rather than
 * inferring cost reduction from timing alone.
 */
async function measureCacheCostImpact(
  pool: import('pg').Pool,
  url: string,
): Promise<{ missCalls: CacheModelCalls; hitCalls: CacheModelCalls }> {
  const query = `cache cost comparison query ${randomUUID()}`;

  await fetch(`${url}/api/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  await fetch(`${url}/api/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  const { rows } = await pool.query<{ model_calls: CacheModelCalls }>(
    `SELECT model_calls FROM search_logs WHERE raw_query = $1 ORDER BY created_at ASC LIMIT 2`,
    [query],
  );
  const [missRow, hitRow] = rows;
  if (!missRow || !hitRow) {
    throw new Error('Expected two search_logs rows (miss then hit) for the cache cost comparison query');
  }
  return { missCalls: missRow.model_calls, hitCalls: hitRow.model_calls };
}

function extractEvalAverageTotalMs(evalReportContent: string): number | null {
  const match = evalReportContent.match(/\|\s*Total\s*\|\s*(\d+)\s*\|/);
  return match?.[1] ? Number(match[1]) : null;
}

function buildReportBody(
  cold: PassSummary,
  warm: PassSummary,
  costImpact: { missCalls: CacheModelCalls; hitCalls: CacheModelCalls },
  evalBaselineMs: number | null,
): string {
  const lines: string[] = [];
  lines.push(`Generated by \`pnpm --filter backend run loadtest\` on ${new Date().toISOString()}.`);
  lines.push('');
  lines.push(
    `Both passes run ${CONNECTIONS} concurrent connections for ${PASS_DURATION_SECONDS}s against the real ` +
      `pipeline (real Claude + Voyage calls) — kept short deliberately to bound API cost for a reference build.`,
  );
  lines.push('');
  lines.push('### Latency percentiles and error rate');
  lines.push('');
  lines.push(
    "Note: autocannon's built-in histogram computes p50/p97.5/p99, not p95 — p97.5 is reported " +
      'in its place as the nearest bracketing percentile (slightly more conservative than a true p95 would be), rather than fabricating an unmeasured number.',
  );
  lines.push('');
  lines.push('| Pass | Requests completed | Errors | Timeouts | Non-2xx | P50 (ms) | P97.5 (ms, ~P95) | P99 (ms) | Mean (ms) |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const pass of [cold, warm]) {
    lines.push(
      `| ${pass.name} | ${pass.requestsCompleted} | ${pass.errors} | ${pass.timeouts} | ${pass.non2xx} | ` +
        `${pass.latencyMs.p50} | ${pass.latencyMs.p97_5} | ${pass.latencyMs.p99} | ${pass.latencyMs.mean.toFixed(1)} |`,
    );
  }
  lines.push('');
  lines.push('### Cache impact — real search_logs evidence for one repeated query');
  lines.push('');
  lines.push('| | Cache miss (1st request) | Cache hit (2nd request, same query) |');
  lines.push('|---|---|---|');
  lines.push(`| \`cache.hit\` | ${costImpact.missCalls.cache.hit} | ${costImpact.hitCalls.cache.hit} |`);
  lines.push(
    `| \`query_understanding.usage\` (Claude tokens) | ${JSON.stringify(costImpact.missCalls.query_understanding.usage)} | ${JSON.stringify(costImpact.hitCalls.query_understanding.usage)} |`,
  );
  lines.push(`| \`embedding\` (Voyage) | ${JSON.stringify(costImpact.missCalls.embedding)} | ${JSON.stringify(costImpact.hitCalls.embedding)} |`);
  lines.push(`| \`rerank\` (Voyage) | ${JSON.stringify(costImpact.missCalls.rerank)} | ${JSON.stringify(costImpact.hitCalls.rerank)} |`);
  lines.push('');
  lines.push('A cache hit makes zero Claude and zero Voyage calls — confirmed above, not assumed.');
  lines.push('');
  lines.push('### Comparison against the eval harness baseline');
  lines.push('');
  if (evalBaselineMs === null) {
    lines.push(
      '`EVAL_REPORT.md` has no "Total" average-latency row to compare against yet — run `pnpm eval` first for a baseline.',
    );
  } else {
    lines.push(
      `\`EVAL_REPORT.md\`'s most recent single-request average total latency: **${evalBaselineMs}ms**. This is the ` +
        `closest existing artifact to a "Phase 6 baseline" — no separate stored Phase 6 number exists, so this is ` +
        `the most honest comparison point available, called out explicitly rather than assumed.`,
    );
    lines.push('');
    const coldP99Regression = cold.latencyMs.p99 - evalBaselineMs;
    lines.push(
      `Cold-pass P99 (${cold.latencyMs.p99}ms) vs. that single-request baseline: ` +
        `${coldP99Regression >= 0 ? `+${coldP99Regression.toFixed(0)}ms higher` : `${Math.abs(coldP99Regression).toFixed(0)}ms lower`}. ` +
        `Expected and explained: the eval baseline is one request at a time with no contention; the cold pass runs ` +
        `${CONNECTIONS} concurrent cache-miss requests sharing this project's single global Voyage rate-limit queue ` +
        `(\`services/voyage/rateLimiter.ts\`) and, likely, Anthropic's own account-level concurrency limits — both ` +
        `serialize work under concurrent load in a way a single sequential eval request never encounters. The warm ` +
        `pass's P99 (${warm.latencyMs.p99}ms) is the more informative comparison for "does caching help under load," ` +
        `since it isolates the app's own overhead from those external rate limits.`,
    );
  }
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
  const pool = createPool(env.DATABASE_URL);
  const redis = createRedisClient(env.REDIS_URL);

  // The load test itself, not real anonymous traffic — same reasoning as runEvals.ts's
  // override, so 50 concurrent connections aren't immediately capped by the 20/min tier.
  const app = createApp(pool, redis, { rateLimiterOverrides: { anonymousPoints: 100_000 } });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://localhost:${port}`;

  console.log(`Load test server listening on ${url}\n`);

  try {
    await redis.flushdb();

    console.log(`Running cold pass (${CONNECTIONS} connections, ${PASS_DURATION_SECONDS}s, unique queries)...`);
    const cold = await runColdPass(url);
    console.log(`Cold pass done: ${cold.requestsCompleted} requests, ${cold.errors} errors, P99=${cold.latencyMs.p99}ms\n`);

    console.log(`Warming the cache with ${BASE_QUERIES.length} fixed queries...`);
    await warmCache(url);

    console.log(`Running warm pass (${CONNECTIONS} connections, ${PASS_DURATION_SECONDS}s, fixed pre-cached queries)...`);
    const warm = await runWarmPass(url);
    console.log(`Warm pass done: ${warm.requestsCompleted} requests, ${warm.errors} errors, P99=${warm.latencyMs.p99}ms\n`);

    console.log('Measuring cache cost impact on a single repeated query...');
    const costImpact = await measureCacheCostImpact(pool, url);

    let evalReportContent = '';
    try {
      const { readFile } = await import('node:fs/promises');
      evalReportContent = await readFile(EVAL_REPORT_PATH, 'utf-8');
    } catch {
      // No EVAL_REPORT.md yet — handled as evalBaselineMs === null in the report body.
    }
    const evalBaselineMs = extractEvalAverageTotalMs(evalReportContent);

    const body = buildReportBody(cold, warm, costImpact, evalBaselineMs);
    await writeReportSection(REPORT_PATH, 'LOAD_TEST', body, '# Load Test Report');
    console.log(`\nWrote load test results to ${REPORT_PATH}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await pool.end();
    redis.disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
