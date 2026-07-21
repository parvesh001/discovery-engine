import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    globalSetup: './src/test/globalSetup.ts',
    // Integration tests share one test database and isolate via TRUNCATE in
    // beforeEach, which only works if test files run one at a time.
    fileParallelism: false,
  },
});
