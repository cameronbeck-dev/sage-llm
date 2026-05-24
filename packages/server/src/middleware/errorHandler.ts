import type { Request, Response, NextFunction } from 'express';
import { AuthError, RateLimitError, ProviderError } from '../providers/errors.js';
import { MissingCredentialsForRoleError } from '../services/settings/errors.js';
import { logger } from '../logger.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof MissingCredentialsForRoleError) {
    res.status(424).json({
      error: {
        code: 'MISSING_CREDENTIALS_FOR_ROLE',
        role: err.role,
        provider: err.provider,
        message: err.message,
      },
    });
    return;
  }
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

  logger.error({ err, requestId: req.id }, 'unhandled error');
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
}
