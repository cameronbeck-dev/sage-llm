import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { Store, IncrementResponse, Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { getPool } from '../db/pool.js';

class PostgresStore implements Store {
  windowMs = 60_000;

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const pool = getPool();
    const expiry = new Date(Date.now() + this.windowMs);

    const { rows } = await pool.query<{ hits: number; expiry: Date }>(
      `INSERT INTO rate_limit_hits (key, hits, expiry)
       VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN rate_limit_hits.expiry < now() THEN 1 ELSE rate_limit_hits.hits + 1 END,
         expiry = CASE WHEN rate_limit_hits.expiry < now() THEN $2 ELSE rate_limit_hits.expiry END
       RETURNING hits, expiry`,
      [key, expiry]
    );

    return {
      totalHits: rows[0].hits,
      resetTime: rows[0].expiry,
    };
  }

  async decrement(key: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE rate_limit_hits SET hits = GREATEST(0, hits - 1) WHERE key = $1`,
      [key]
    );
  }

  async resetKey(key: string): Promise<void> {
    const pool = getPool();
    await pool.query(`DELETE FROM rate_limit_hits WHERE key = $1`, [key]);
  }
}

function makeStore() {
  return new PostgresStore();
}

function keyByUserId(req: Request): string {
  return req.session?.userId
    ? `user:${req.session.userId}`
    : `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

function keyByIp(req: Request): string {
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

function onLimitReached(_req: Request, res: Response): void {
  const retryAfter = res.getHeader('Retry-After');
  res.status(429).json({
    error: {
      code: 'RATE_LIMIT',
      message: 'Too many requests, please try again later.',
      retryAfter: retryAfter ? Number(retryAfter) : 60,
    },
  });
}

export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: keyByUserId,
  store: makeStore(),
  handler: onLimitReached,
  skipFailedRequests: false,
});

export const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: keyByUserId,
  store: makeStore(),
  handler: onLimitReached,
  skipFailedRequests: false,
});

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: keyByIp,
  store: makeStore(),
  handler: onLimitReached,
  skipFailedRequests: false,
});

export const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: keyByIp,
  store: makeStore(),
  handler: onLimitReached,
  skipFailedRequests: false,
});
