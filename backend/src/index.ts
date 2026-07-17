import 'dotenv/config';
import { loadEnv, type Env } from './env.js';
import { createPool } from './db.js';
import { createApp } from './app.js';

function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function bootstrap(): void {
  const env = loadEnvOrExit();

  const pool = createPool(env.DATABASE_URL);
  const app = createApp(pool);

  app.listen(env.PORT, () => {
    console.log(`Backend listening on port ${env.PORT}`);
  });
}

bootstrap();
