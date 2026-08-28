// Mirrors testDb.ts's getTestDatabaseUrl(): integration tests must run against a
// dedicated Redis logical DB, never REDIS_URL — same "fail loudly, not silently fall
// back" lesson CLAUDE.md documents for TEST_DATABASE_URL, applied to this new external
// dependency (Phase 9).
import 'dotenv/config';

export function getTestRedisUrl(): string {
  const testUrl = process.env.TEST_REDIS_URL;

  if (!testUrl) {
    throw new Error(
      'TEST_REDIS_URL is not set. Integration tests must run against a dedicated Redis ' +
        'logical DB, never REDIS_URL — see backend/.env.example.',
    );
  }

  if (testUrl === process.env.REDIS_URL) {
    throw new Error(
      'TEST_REDIS_URL must not be the same as REDIS_URL — refusing to run tests that ' +
        'FLUSHDB against what looks like the dev Redis instance.',
    );
  }

  return testUrl;
}
