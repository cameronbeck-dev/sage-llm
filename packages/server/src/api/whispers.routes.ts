import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { handleWhisperAction } from '../services/whisper-actions.js';

export const whispersRouter = Router();

whispersRouter.post('/:messageId/actions/:index', requireAuth, async (req, res, next) => {
  try {
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'index must be a non-negative integer' } });
      return;
    }

    const updated = await handleWhisperAction(
      req.session!.userId!,
      req.params.messageId,
      index
    );

    res.json(updated);
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.status) {
      res.status(e.status).json({ error: { code: 'REQUEST_ERROR', message: e.message } });
      return;
    }
    next(err);
  }
});
