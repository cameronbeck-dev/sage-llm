import pg from 'pg';
import { config } from '../config.js';

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    if (!config.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 5, // Heroku Basic has a 20-connection budget; leave headroom for pg-boss
    });
  }
  return pool;
}
