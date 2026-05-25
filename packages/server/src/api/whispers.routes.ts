import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { handleWhisperAction } from '../services/whisper-actions.js';
import { getPool } from '../db/pool.js';

export const whispersRouter = Router();

function rowToWhisperEvent(row: Record<string, unknown>) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind,
    payload: row.payload,
    displaySummary: row.display_summary,
    actions: row.actions,
    createdAt: row.created_at,
  };
}

whispersRouter.get('/stream', requireAuth, async (req, res) => {
  const userId = req.session!.userId!;
  const conversationId = req.query.conversationId as string | undefined;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 25_000);

  let lastSeenAt = new Date();
  const poll = setInterval(async () => {
    try {
      const pool = getPool();
      const params: unknown[] = [userId, lastSeenAt];
      let where = 'user_id = $1 AND created_at > $2 AND dismissed_at IS NULL';
      if (conversationId) {
        params.push(conversationId);
        where += ` AND conversation_id = $${params.length}`;
      }
      const { rows } = await pool.query<Record<string, unknown>>(
        `SELECT id, conversation_id, kind, payload, display_summary, actions, created_at
         FROM whisper_feed
         WHERE ${where}
         ORDER BY created_at ASC
         LIMIT 50`,
        params
      );
      for (const row of rows) {
        res.write(`data: ${JSON.stringify(rowToWhisperEvent(row))}\n\n`);
        lastSeenAt = row.created_at as Date;
      }
    } catch (err) {
      console.error('[whispers/stream] poll error:', err);
    }
  }, 1500);

  req.on('close', () => {
    clearInterval(keepalive);
    clearInterval(poll);
    res.end();
  });
});

whispersRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const sinceParam = req.query.since as string | undefined;
    const conversationId = req.query.conversationId as string | undefined;
    const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 60_000);

    const pool = getPool();
    const params: unknown[] = [userId, since];
    let where = 'user_id = $1 AND created_at > $2 AND dismissed_at IS NULL';
    if (conversationId) {
      params.push(conversationId);
      where += ` AND conversation_id = $${params.length}`;
    }

    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT id, conversation_id, kind, payload, display_summary, actions, created_at
       FROM whisper_feed
       WHERE ${where}
       ORDER BY created_at ASC
       LIMIT 100`,
      params
    );

    res.json({ whispers: rows.map(rowToWhisperEvent) });
  } catch (err) {
    next(err);
  }
});

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
