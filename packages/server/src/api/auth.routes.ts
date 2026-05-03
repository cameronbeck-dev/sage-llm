import { Router } from 'express';
import { githubAuthRouter } from '../auth/github.js';
import { requireAuth } from '../auth/middleware.js';
import { getPool } from '../db/pool.js';
import { getUserSettings } from '../services/settings.js';

export const authRouter = Router();

authRouter.use('/auth', githubAuthRouter);

authRouter.post('/auth/logout', (req, res) => {
  req.session = null as unknown as typeof req.session;
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT id, github_id, github_login, email, avatar_url, created_at FROM users WHERE id = $1',
      [req.session!.userId]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
      return;
    }
    const user = rows[0];
    const settings = await getUserSettings(req.session!.userId!);
    res.json({
      user: {
        id: user.id,
        githubId: user.github_id,
        login: user.github_login,
        email: user.email,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at,
      },
      settings,
    });
  } catch (err) {
    next(err);
  }
});
