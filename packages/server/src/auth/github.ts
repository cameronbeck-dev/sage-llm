import { Router } from 'express';
import { fetch } from 'undici';
import { config } from '../config.js';
import { getPool } from '../db/pool.js';

async function seedWelcomeConversation(userId: string): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rowCount } = await client.query(
      `UPDATE users SET welcomed_at = now() WHERE id = $1 AND welcomed_at IS NULL`,
      [userId]
    );

    if (!rowCount) {
      await client.query('ROLLBACK');
      return;
    }

    const { rows: convoRows } = await client.query<{ id: string }>(
      `INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id`,
      [userId, 'Welcome']
    );
    const convoId = convoRows[0].id;

    const { rows: templateRows } = await client.query<{ content: string }>(
      'SELECT content FROM welcome_templates ORDER BY created_at ASC LIMIT 1'
    );

    if (templateRows.length > 0) {
      await client.query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
        [convoId, JSON.stringify([{ type: 'text', text: templateRows[0].content }])]
      );
    }

    await client.query(
      `INSERT INTO memory_docs (user_id, filename, content) VALUES
       ($1, 'AGENTS.md', '# Agents\n\nYou are a helpful AI assistant.'),
       ($1, 'MEMORY.md', '# Memory\n\n'),
       ($1, 'SUMMARIES.json', '{"entries": []}')
      ON CONFLICT (user_id, filename) DO NOTHING`,
      [userId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[auth] failed to seed welcome conversation', err);
  } finally {
    client.release();
  }
}

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

    // Seed welcome conversation and memory docs
    await seedWelcomeConversation(userId);

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
