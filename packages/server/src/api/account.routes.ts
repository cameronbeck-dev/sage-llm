import { Router } from 'express';
import { createRequire } from 'node:module';
import { requireAuth } from '../auth/middleware.js';
import { mutationLimiter } from '../middleware/rateLimit.js';
import { getPool } from '../db/pool.js';
import { logger } from '../logger.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver') as typeof import('archiver');

export const accountRouter = Router();

accountRouter.post('/export', requireAuth, mutationLimiter, async (req, res) => {
  const userId = req.session!.userId!;
  const pool = getPool();
  const dateStr = new Date().toISOString().slice(0, 10);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="sage-export-${userId}-${dateStr}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    logger.error({ err, requestId: req.id }, 'archive error');
    res.end();
  });

  archive.pipe(res);

  async function appendTable(filename: string, query: string, params: unknown[]) {
    const { rows } = await pool.query(query, params);
    archive.append(JSON.stringify(rows, null, 2), { name: filename });
  }

  try {
    await appendTable('users.json', `SELECT * FROM users WHERE id = $1`, [userId]);
    await appendTable('conversations.json', `SELECT * FROM conversations WHERE user_id = $1`, [userId]);
    await appendTable('messages.json',
      `SELECT m.* FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = $1`,
      [userId]
    );
    await appendTable('memory_docs.json', `SELECT * FROM memory_docs WHERE user_id = $1`, [userId]);
    await appendTable('user_settings.json', `SELECT * FROM user_settings WHERE user_id = $1`, [userId]);
    await appendTable('user_credentials.json',
      `SELECT id, provider, created_at, updated_at FROM user_credentials WHERE user_id = $1`,
      [userId]
    );
    await appendTable('audit_logs.json', `SELECT * FROM audit_logs WHERE user_id = $1`, [userId]);

    // These tables may not exist before migration 011 — guard with a try
    try {
      await appendTable('user_subscriptions.json', `SELECT * FROM user_subscriptions WHERE user_id = $1`, [userId]);
      await appendTable('usage_meters.json', `SELECT * FROM usage_meters WHERE user_id = $1`, [userId]);
    } catch {
      // tables not yet migrated — skip
    }
  } catch (err) {
    logger.error({ err, requestId: req.id }, 'export query error');
    archive.abort();
    return;
  }

  await archive.finalize();
});

accountRouter.delete('/', requireAuth, mutationLimiter, async (req, res, next) => {
  const userId = req.session!.userId!;
  const pool = getPool();

  try {
    await pool.query(
      `INSERT INTO audit_logs (event, resource, user_id, ip_address, user_agent, success)
       VALUES ('account_deleted', 'account', $1, $2, $3, true)`,
      [userId, req.ip, req.get('user-agent') ?? null]
    );

    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

    req.session = null as unknown as typeof req.session;

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
