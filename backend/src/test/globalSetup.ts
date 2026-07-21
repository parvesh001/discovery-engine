import { execSync } from 'node:child_process';
import { getTestDatabaseUrl } from './testDb.js';

export default function setup(): void {
  getTestDatabaseUrl();

  execSync('pnpm exec node-pg-migrate up -d TEST_DATABASE_URL', {
    stdio: 'inherit',
    env: process.env,
  });
}
