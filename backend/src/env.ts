import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required' })
    .min(1, 'DATABASE_URL must not be empty')
    .url('DATABASE_URL must be a valid connection URL'),
  ANTHROPIC_API_KEY: z
    .string({ required_error: 'ANTHROPIC_API_KEY is required' })
    .min(1, 'ANTHROPIC_API_KEY must not be empty'),
  PORT: z
    .string({ required_error: 'PORT is required' })
    .min(1, 'PORT must not be empty')
    .regex(/^\d+$/, 'PORT must be a valid port number')
    .transform(Number)
    .refine((port) => port > 0 && port <= 65535, 'PORT must be between 1 and 65535'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const messages = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${messages.join('\n')}`);
  }

  return result.data;
}
