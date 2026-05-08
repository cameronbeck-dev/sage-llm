import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { logger } from './logger.js';

type ErrorMiddleware = (err: unknown, req: Request, res: Response, next: NextFunction) => void;
type Middleware = (req: Request, res: Response, next: NextFunction) => void;

const passthroughError: ErrorMiddleware = (_err, _req, _res, next) => next(_err);

let captureExceptionFn: ((err: unknown) => void) | null = null;

export function initSentry(): void {
  if (!config.SENTRY_DSN) return;
  import('@sentry/node').then(({ init, captureException }) => {
    init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
    captureExceptionFn = captureException;
  }).catch((err) => logger.error({ err }, '[sentry] failed to load @sentry/node'));
}

export function sentryErrorHandler(): ErrorMiddleware {
  if (!config.SENTRY_DSN) return passthroughError;
  return (err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    captureExceptionFn?.(err);
    next(err);
  };
}
