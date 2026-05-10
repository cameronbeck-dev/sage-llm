import { getPool } from '../db/pool.js';
import type { Message, ContentBlock } from '@sage/shared';

function rowToMessage(row: Record<string, unknown>): Message {
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
  thinking?: string
): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO messages
       (conversation_id, role, content, provider, model, prompt_tokens, completion_tokens, cost_cents, cost_usd, thinking)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
    ]
  );

  await pool.query(
    'UPDATE conversations SET updated_at = now() WHERE id = $1',
    [conversationId]
  );

  return rows[0].id;
}
