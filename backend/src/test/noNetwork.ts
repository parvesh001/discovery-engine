// Test-suite network guard. Registered as a vitest setupFile (see vitest.config.ts).
//
// The unit suite mocks every real outbound call: the Anthropic SDK is `vi.mock`-ed, and
// `fetch` is swapped per-test for Voyage's embeddings/rerank endpoints (see
// services/ingestion/embeddings.test.ts and services/search/rerank.test.ts). Those files
// capture `global.fetch` at module-eval time and restore it in `afterEach`, so without
// this guard a *future* test that calls `rerank()` / `generateEmbedding()` and forgets to
// install its own mock would fall through to the live Voyage API — passing locally (real
// key in .env) but failing in CI on the dummy key, or silently spending API budget.
//
// Replacing the default with a throwing stub turns that mistake into an immediate failure
// that names the URL. Tests that legitimately need `fetch` still assign their own mock;
// real-socket clients (pg, ioredis, BullMQ) never go through `fetch` and are unaffected.
import { beforeEach } from 'vitest';

function blockedFetch(input: unknown): never {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : String(input);
  throw new Error(
    `Unmocked network call in test: fetch(${url}). Tests must not make real network requests — ` +
      'install a mock (e.g. `global.fetch = fetchMock`) in this test.',
  );
}

// Assign now for any module-eval-time captures and pre-test code, and re-assert before
// every test so a test that installs its own mock without restoring it can't leak that
// mock (or a live `fetch`) into the next test. This setup file's `beforeEach` is
// registered before any test file's own hooks, so it runs first — a test's `beforeEach`
// that sets `global.fetch = fetchMock` still wins for that test.
global.fetch = blockedFetch as unknown as typeof fetch;

beforeEach(() => {
  global.fetch = blockedFetch as unknown as typeof fetch;
});
