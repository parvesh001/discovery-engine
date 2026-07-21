import 'dotenv/config';

export function getTestDatabaseUrl(): string {
  const testUrl = process.env.TEST_DATABASE_URL;

  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests must run against a dedicated test database, ' +
        'never DATABASE_URL — see backend/.env.example.',
    );
  }

  if (testUrl === process.env.DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL must not be the same as DATABASE_URL — refusing to run destructive tests ' +
        'against what looks like the dev database.',
    );
  }

  return testUrl;
}
