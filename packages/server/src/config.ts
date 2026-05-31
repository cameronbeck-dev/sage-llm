import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().default('dev-secret-change-in-production'),
  // Encryption key for credentials at rest.
  // Required in production (use Heroku Secrets, AWS Secrets Manager, etc).
  // Optional in development — if omitted, credential operations will fail at runtime.
  SAGE_ENC_KEY: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  OAUTH_REDIRECT_URI: z.string().optional(),
  CLIENT_URL: z.string().default(''),
  DEFAULT_PROVIDER: z.string().default('openai'),
  DEFAULT_MODEL: z.string().default('gpt-4o-mini'),
  SENTRY_DSN: z.string().optional(),
  SAGE_WIKI_ENABLED: z.string().default('false').transform(v => v === 'true'),
  SEARXNG_URL: z.string().default('http://localhost:8080'),
  WEB_FETCH_USER_AGENT: z.string().default('Sage/1.0 (+https://sage.local)'),
  WEB_FETCH_TIMEOUT_MS: z.coerce.number().default(10000),
  WEB_FETCH_MAX_BYTES: z.coerce.number().default(5000000),
});

export const config = envSchema.parse(process.env);

// SAGE_ENC_KEY is optional in dev/test but required in production:
// it backs credential encryption and HMAC signing of storage URLs.
// Without it, signStorageToken would HMAC with an empty secret — forgeable.
if (config.NODE_ENV === 'production' && !config.SAGE_ENC_KEY) {
  throw new Error('SAGE_ENC_KEY is required in production. Set it via your secrets manager (Heroku Secrets, AWS Secrets Manager, etc).');
}

export type Config = typeof config;
