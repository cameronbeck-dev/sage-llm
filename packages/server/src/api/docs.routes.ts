import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getDoc, updateDoc } from '../services/docs.js';
import { getPool } from '../db/pool.js';

export const docsRouter = Router();

// System routes (must come before /:filename to avoid conflict)
docsRouter.get('/system/welcome-template', requireAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT content FROM welcome_templates ORDER BY created_at ASC LIMIT 1'
    );
    if (rows.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Welcome template not found' } });
      return;
    }
    res.json({ content: rows[0].content });
  } catch (err) {
    next(err);
  }
});

docsRouter.get('/:filename', requireAuth, async (req, res, next) => {
  try {
    const doc = await getDoc(req.session!.userId!, req.params.filename);
    if (!doc) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Doc not found' } });
      return;
    }
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

docsRouter.put('/:filename', requireAuth, async (req, res, next) => {
  try {
    // Only AGENTS.md is user-editable
    if (req.params.filename !== 'AGENTS.md') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only AGENTS.md is editable' } });
      return;
    }
    const { content } = req.body as { content?: string };
    if (content === undefined) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'content required' } });
      return;
    }
    await updateDoc(req.session!.userId!, req.params.filename, content);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});