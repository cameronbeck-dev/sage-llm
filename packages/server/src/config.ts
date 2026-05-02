import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().default('dev-secret-change-in-production'),
  SAGE_ENC_KEY: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  OAUTH_REDIRECT_URI: z.string().optional(),
  DEFAULT_PROVIDER: z.string().default('openai'),
  DEFAULT_MODEL: z.string().default('gpt-4o-mini'),
});

export const config = envSchema.parse(process.env);
export type Config = typeof config;
