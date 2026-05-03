import { Router } from 'express';
import { fetch } from 'undici';
import { config } from '../config.js';
import { getPool } from '../db/pool.js';

export const githubAuthRouter = Router();

githubAuthRouter.get('/github', (_req, res) => {
  if (!config.GITHUB_CLIENT_ID) {
    res.status(500).json({ error: { code: 'MISCONFIGURED', message: 'GitHub OAuth not configured' } });
    return;
  }
  const params = new URLSearchParams({
    client_id: config.GITHUB_CLIENT_ID,
    redirect_uri: config.OAUTH_REDIRECT_URI ?? '',
    scope: 'read:user user:email',
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

githubAuthRouter.get('/github/callback', async (req, res) => {
  const { code } = req.query as { code?: string };
  if (!code) {
    res.redirect(`${config.CLIENT_URL}/login?error=missing_code`);
    return;
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: config.GITHUB_CLIENT_ID,
        client_secret: config.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: config.OAUTH_REDIRECT_URI,
      }),
    });

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      res.redirect(`${config.CLIENT_URL}/login?error=token_exchange_failed`);
      return;
    }

    const profileRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'sage-app',
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const profile = (await profileRes.json()) as {
      id: number;
      login: string;
      name?: string;
      email?: string;
      avatar_url: string;
    };

    const pool = getPool();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (github_id, github_login, email, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (github_id) DO UPDATE
         SET github_login = EXCLUDED.github_login,
             email = EXCLUDED.email,
             avatar_url = EXCLUDED.avatar_url,
             updated_at = now()
       RETURNING id`,
      [profile.id, profile.login, profile.email ?? null, profile.avatar_url]
    );

    const userId = rows[0].id;

    await pool.query(
      `INSERT INTO user_settings (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    req.session!.userId = userId;
    req.session!.github = {
      id: profile.id,
      login: profile.login,
      avatar_url: profile.avatar_url,
    };

    res.redirect(`${config.CLIENT_URL}/`);
  } catch (err) {
    console.error('[auth] github callback error', err);
    res.redirect(`${config.CLIENT_URL}/login?error=server_error`);
  }
});
