import { getPool } from '../db/pool.js';
import type { Conversation } from '@sage/shared';

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    archivedAt: row.archived ? (row.updated_at as string) : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
    preferredProvider: (row.preferred_provider as string | null) ?? null,
    preferredModel: (row.preferred_model as string | null) ?? null,
    importId: (row.import_id as string | null) ?? null,
    knowledgePackId: (row.knowledge_pack_id as string | null) ?? null,
    attachedPackIds: Array.isArray(row.attached_pack_ids)
      ? (row.attached_pack_ids as string[]).filter(Boolean)
      : [],
  };
}

export async function listConversations(
  userId: string,
  limit = 50,
  offset = 0,
  includeArchived = false
): Promise<Conversation[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT c.*,
       array_agg(ckp.pack_id) FILTER (WHERE ckp.pack_id IS NOT NULL) AS attached_pack_ids
     FROM conversations c
     LEFT JOIN conversation_knowledge_packs ckp ON ckp.conversation_id = c.id
     WHERE c.user_id = $1 ${includeArchived ? '' : 'AND c.archived = false'}
     GROUP BY c.id
     ORDER BY c.updated_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows.map(rowToConversation);
}

export async function getConversation(
  userId: string,
  conversationId: string
): Promise<Conversation | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT c.*,
       array_agg(ckp.pack_id) FILTER (WHERE ckp.pack_id IS NOT NULL) AS attached_pack_ids
     FROM conversations c
     LEFT JOIN conversation_knowledge_packs ckp ON ckp.conversation_id = c.id
     WHERE c.id = $1 AND c.user_id = $2
     GROUP BY c.id`,
    [conversationId, userId]
  );
  if (rows.length === 0) return null;
  return rowToConversation(rows[0]);
}

export async function createConversation(
  userId: string,
  title = 'New conversation',
  knowledgePackId?: string | null
): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO conversations (user_id, title, knowledge_pack_id) VALUES ($1, $2, $3) RETURNING id',
    [userId, title, knowledgePackId ?? null]
  );
  return rows[0].id;
}

export async function updateConversation(
  userId: string,
  conversationId: string,
  updates: {
    title?: string;
    archived?: boolean;
    preferredProvider?: string | null;
    preferredModel?: string | null;
    knowledgePackId?: string | null;
  }
): Promise<void> {
  const pool = getPool();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.title !== undefined) {
    fields.push(`title = $${idx++}`);
    values.push(updates.title);
  }
  if (updates.archived !== undefined) {
    fields.push(`archived = $${idx++}`);
    values.push(updates.archived);
  }
  if (updates.preferredProvider !== undefined) {
    fields.push(`preferred_provider = $${idx++}`);
    values.push(updates.preferredProvider);
  }
  if (updates.preferredModel !== undefined) {
    fields.push(`preferred_model = $${idx++}`);
    values.push(updates.preferredModel);
  }
  if (updates.knowledgePackId !== undefined) {
    fields.push(`knowledge_pack_id = $${idx++}`);
    values.push(updates.knowledgePackId);
  }
  if (fields.length === 0) return;

  fields.push(`updated_at = now()`);
  values.push(conversationId, userId);

  await pool.query(
    `UPDATE conversations SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx}`,
    values
  );
}

export async function deleteConversation(
  userId: string,
  conversationId: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    'DELETE FROM conversations WHERE id = $1 AND user_id = $2',
    [conversationId, userId]
  );
}
