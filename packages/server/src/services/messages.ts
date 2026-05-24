import { getPool } from '../db/pool.js';
import type { Message, ContentBlock, WhisperAction } from '@sage/shared';

export function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    role: row.role as 'user' | 'assistant' | 'system' | 'whisper' | 'system_internal',
    content: row.content as ContentBlock[],
    provider: row.provider as string | undefined,
    model: row.model as string | undefined,
    inputTokens: row.prompt_tokens as number | undefined,
    outputTokens: row.completion_tokens as number | undefined,
    costUsd:
      row.cost_usd != null
        ? Number(row.cost_usd)
        : row.cost_cents != null
        ? (row.cost_cents as number) / 100
        : undefined,
    thinking: row.thinking as string ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
    whisperActions: row.whisper_actions != null ? (row.whisper_actions as WhisperAction[]) : undefined,
  };
}

export async function listMessages(
  conversationId: string,
  limit = 100,
  offset = 0
): Promise<Message[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2 OFFSET $3`,
    [conversationId, limit, offset]
  );
  return rows.map(rowToMessage);
}

export async function createMessage(
  conversationId: string,
  role: string,
  content: ContentBlock[],
  provider?: string,
  model?: string,
  usage?: { inputTokens: number; outputTokens: number },
  costUsd?: number,
  thinking?: string,
  whisperActions?: WhisperAction[]
): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO messages
       (conversation_id, role, content, provider, model, prompt_tokens, completion_tokens, cost_cents, cost_usd, thinking, whisper_actions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      conversationId,
      role,
      JSON.stringify(content),
      provider ?? null,
      model ?? null,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
      costUsd != null ? Math.round(costUsd * 100) : null,
      costUsd ?? null,
      thinking ?? null,
      whisperActions != null ? JSON.stringify(whisperActions) : null,
    ]
  );

  await pool.query(
    'UPDATE conversations SET updated_at = now() WHERE id = $1',
    [conversationId]
  );

  return rows[0].id;
}

export async function getMessage(messageId: string, userId: string): Promise<Message | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT m.* FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.id = $1 AND c.user_id = $2`,
    [messageId, userId]
  );
  return rows.length > 0 ? rowToMessage(rows[0]) : null;
}

export async function updateMessageWhisperActions(
  messageId: string,
  whisperActions: WhisperAction[] | null
): Promise<Message | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE messages SET whisper_actions = $1 WHERE id = $2 RETURNING *`,
    [whisperActions != null ? JSON.stringify(whisperActions) : null, messageId]
  );
  return rows.length > 0 ? rowToMessage(rows[0]) : null;
}

export async function appendMessageWhisperActions(
  messageId: string,
  newActions: WhisperAction[]
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ whisper_actions: WhisperAction[] | null }>(
      `SELECT whisper_actions FROM messages WHERE id = $1 FOR UPDATE`,
      [messageId]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn('[appendMessageWhisperActions] message not found:', messageId);
      return;
    }
    const existing = rows[0].whisper_actions ?? [];
    const merged = [...existing, ...newActions];
    await client.query(
      `UPDATE messages SET whisper_actions = $1 WHERE id = $2`,
      [JSON.stringify(merged), messageId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateMessageContent(
  messageId: string,
  content: ContentBlock[]
): Promise<Message | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE messages SET content = $1 WHERE id = $2 RETURNING *`,
    [JSON.stringify(content), messageId]
  );
  return rows.length > 0 ? rowToMessage(rows[0]) : null;
}
