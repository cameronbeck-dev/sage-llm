import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env from repo root (three levels up from src or dist)
loadEnv({ path: join(__dirname, '..', '..', '..', '.env') });
// Fallback: also load from cwd if a local .env exists
loadEnv();
