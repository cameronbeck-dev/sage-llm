import { randomBytes, createHash } from 'node:crypto';
import { getPool } from '../../db/pool.js';

const TOKEN_PREFIX = 'sage_pat_';

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function isValidTokenFormat(raw: string): boolean {
  return raw.startsWith(TOKEN_PREFIX) && raw.length > TOKEN_PREFIX.length;
}

export async function issueToken(
  userId: string,
  name: string
): Promise<{ id: string; rawToken: string; createdAt: Date }> {
  const suffix = randomBytes(32).toString('base64url');
  const rawToken = TOKEN_PREFIX + suffix;
  const tokenHash = hashToken(rawToken);

  const pool = getPool();
  const { rows } = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO personal_access_tokens (user_id, name, token_hash)
     VALUES ($1, $2, $3)
     RETURNING id, created_at`,
    [userId, name, tokenHash]
  );

  const row = rows[0];
  return { id: row.id, rawToken, createdAt: row.created_at };
}

export async function verifyToken(
  rawToken: string
): Promise<{ userId: string; tokenId: string } | null> {
  if (!isValidTokenFormat(rawToken)) return null;

  const tokenHash = hashToken(rawToken);
  const pool = getPool();

  const { rows } = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM personal_access_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );

  if (rows.length === 0) return null;

  const row = rows[0];

  pool
    .query(
      `UPDATE personal_access_tokens SET last_used_at = NOW() WHERE id = $1`,
      [row.id]
    )
    .catch(() => {});

  return { userId: row.user_id, tokenId: row.id };
}

export async function listTokens(userId: string): Promise<
  Array<{ id: string; name: string; lastUsedAt: Date | null; createdAt: Date }>
> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    name: string;
    last_used_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, name, last_used_at, created_at
     FROM personal_access_tokens
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [userId]
  );

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
  }));
}

export async function revokeToken(userId: string, tokenId: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE personal_access_tokens
     SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tokenId, userId]
  );
  return (rowCount ?? 0) > 0;
}
