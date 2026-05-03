import { getPool } from '../db/pool.js';
import { encrypt, decrypt, type EncryptedEnvelope } from '../crypto/encryption.js';
import { getProvider } from '../providers/registry.js';
import { logAudit } from './audit.js';
import type { AuditEvent } from './audit.js';

const MIN_KEY_LENGTH = 16;

export class CredentialNotFoundError extends Error {
  constructor(provider: string) {
    super(`No credentials found for provider: ${provider}`);
    this.name = 'CredentialNotFoundError';
  }
}

export class CredentialValidationError extends Error {
  constructor(provider: string, message: string) {
    super(message);
    this.name = 'CredentialValidationError';
  }
}

/**
 * Validate an API key against the real provider by attempting to list models.
 * Throws CredentialValidationError if the key is rejected.
 */
async function validateKey(providerId: string, apiKey: string): Promise<void> {
  try {
    const provider = getProvider(providerId);
    await provider.listModels({ apiKey });
  } catch (err) {
    const msg = (err as Error).message;
    // Map to human-readable message without leaking what the provider said
    if (msg.includes('401') || msg.includes('auth') || msg.includes('invalid')) {
      throw new CredentialValidationError(providerId, 'Invalid API key');
    }
    if (msg.includes('429') || msg.includes('rate limit')) {
      throw new CredentialValidationError(providerId, 'Rate limit — try again shortly');
    }
    throw new CredentialValidationError(providerId, 'Could not reach provider');
  }
}

function auditEvent(userId: string, action: AuditEvent, provider: string, success: boolean, errorMsg?: string) {
  logAudit({
    event: action,
    resource: provider,
    success,
    errorMsg,
    userId,
  });
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

export async function getDecryptedCredential(
  userId: string,
  providerId: string
): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT encrypted FROM user_credentials WHERE user_id = $1 AND provider = $2`,
    [userId, providerId]
  );

  if (rows.length === 0) {
    throw new CredentialNotFoundError(providerId);
  }

  const envelope = rows[0].encrypted as EncryptedEnvelope;
  return decrypt(envelope);
}

export async function storeCredential(
  userId: string,
  providerId: string,
  apiKey: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  if (apiKey.length < MIN_KEY_LENGTH) {
    throw new CredentialValidationError(providerId, `API key must be at least ${MIN_KEY_LENGTH} characters`);
  }

  // Pre-store validation against real provider
  await validateKey(providerId, apiKey);

  const envelope = encrypt(apiKey);
  const pool = getPool();

  await pool.query(
    `INSERT INTO user_credentials (user_id, provider, encrypted, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, provider)
     DO UPDATE SET encrypted = $3, updated_at = now()`,
    [userId, providerId, JSON.stringify(envelope)]
  );

  auditEvent(userId, 'credential_created', providerId, true);
}

export async function deleteCredential(
  userId: string,
  providerId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `DELETE FROM user_credentials WHERE user_id = $1 AND provider = $2`,
    [userId, providerId]
  );

  auditEvent(userId, 'credential_deleted', providerId, true);
}

export async function hasCredential(userId: string, providerId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT 1 FROM user_credentials WHERE user_id = $1 AND provider = $2`,
    [userId, providerId]
  );
  return rows.length > 0;
}

export async function listCredentials(userId: string): Promise<Record<string, { hasKey: boolean; updatedAt: string | null }>> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT provider, updated_at FROM user_credentials WHERE user_id = $1`,
    [userId]
  );
  const result: Record<string, { hasKey: boolean; updatedAt: string | null }> = {};
  for (const row of rows) {
    result[row.provider as string] = { hasKey: true, updatedAt: row.updated_at };
  }
  return result;
}