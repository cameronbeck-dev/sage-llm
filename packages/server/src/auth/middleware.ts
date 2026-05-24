import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/auth/tokens.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.session?.userId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const rawToken = authHeader.slice(7);
        const result = await verifyToken(rawToken);
        if (result) {
          req.session!.userId = result.userId;
        }
      }
    }
  } catch {
    // fall through to session check
  }

  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }
  next();
}
