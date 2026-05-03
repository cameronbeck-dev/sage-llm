import type { Request, Response, NextFunction } from 'express';
import { AuthError, RateLimitError, ProviderError } from '../providers/errors.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AuthError) {
    res.status(401).json({ error: { code: 'AUTH_ERROR', message: err.message, retryable: false } });
    return;
  }
  if (err instanceof RateLimitError) {
    res.status(429).json({
      error: { code: 'RATE_LIMIT', message: err.message, retryable: true, retryAfter: err.retryAfter },
    });
    return;
  }
  if (err instanceof ProviderError) {
    res.status(502).json({
      error: { code: 'PROVIDER_ERROR', message: err.message, retryable: err.retryable },
    });
    return;
  }

  console.error('[error]', err);
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
}
