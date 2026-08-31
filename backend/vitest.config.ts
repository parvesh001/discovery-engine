import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    globalSetup: './src/test/globalSetup.ts',
    // Blocks unmocked `fetch` so a test that forgets to stub a real outbound call fails
    // loudly instead of hitting a live API (or spending API budget). See the file header.
    setupFiles: ['./src/test/noNetwork.ts'],
    // Integration tests share one test database and isolate via TRUNCATE in
    // beforeEach, which only works if test files run one at a time.
    fileParallelism: false,
    // Vitest auto-loads .env into process.env. Several tests assert a deterministic
    // `null` Langfuse trace/parent (tracing off) — that must hold regardless of whatever
    // real LANGFUSE_* keys happen to be sitting in a developer's .env, both for hermetic,
    // reproducible tests and so a test run never fires real requests at Langfuse Cloud
    // using real credentials. Same isolation principle as getTestDatabaseUrl() for the DB.
    env: {
      LANGFUSE_PUBLIC_KEY: '',
      LANGFUSE_SECRET_KEY: '',
    },
  },
});
