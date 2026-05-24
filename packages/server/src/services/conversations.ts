import { getPool } from '../db/pool.js';
import type { Conversation, AttachedPack } from '@sage/shared';

function rowToConversation(row: Record<string, unknown>): Conversation {
  let attachedPacks: AttachedPack[] = [];
  if (Array.isArray(row.attached_packs_json)) {
    attachedPacks = (row.attached_packs_json as Array<{ pack_id: string; auto_extract: boolean } | null>)
      .filter((r): r is { pack_id: string; auto_extract: boolean } => r != null && typeof r.pack_id === 'string')
      .map(r => ({ packId: r.pack_id, autoExtract: r.auto_extract }));
  }

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
    attachedPackIds: attachedPacks.map(p => p.packId),
    attachedPacks,
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
       jsonb_agg(jsonb_build_object('pack_id', ckp.pack_id, 'auto_extract', ckp.auto_extract)) FILTER (WHERE ckp.pack_id IS NOT NULL) AS attached_packs_json
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
       jsonb_agg(jsonb_build_object('pack_id', ckp.pack_id, 'auto_extract', ckp.auto_extract)) FILTER (WHERE ckp.pack_id IS NOT NULL) AS attached_packs_json
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
  seedFromPackId?: string | null
): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id',
    [userId, title]
  );
  const conversationId = rows[0].id;

  if (seedFromPackId) {
    const { attachPackToConversation } = await import('./_legacy/knowledge.js');
    await attachPackToConversation(userId, conversationId, seedFromPackId, { autoExtract: true });

    const { buildPackOpener } = await import('../prompts/pack-opener.js');
    const { createMessage } = await import('./messages.js');
    const opener = await buildPackOpener(userId, seedFromPackId, conversationId).catch(err => {
      console.error('[opener] failed', err);
      return null;
    });
    if (opener) {
      await createMessage(conversationId, 'assistant', [{ type: 'text', text: opener }]);
    }
  }

  return conversationId;
}

export async function updateConversation(
  userId: string,
  conversationId: string,
  updates: {
    title?: string;
    archived?: boolean;
    preferredProvider?: string | null;
    preferredModel?: string | null;
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
