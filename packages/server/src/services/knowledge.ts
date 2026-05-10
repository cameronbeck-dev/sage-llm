import { getPool } from '../db/pool.js';
import { getObjectStore } from '../storage/index.js';
import type { KnowledgePack, KnowledgeFile } from '@sage/shared';

function rowToPack(row: Record<string, unknown>): KnowledgePack {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

function rowToFile(row: Record<string, unknown>): KnowledgeFile {
  return {
    id: row.id as string,
    packId: row.pack_id as string,
    filename: row.filename as string,
    mimeType: (row.mime_type as string | null) ?? null,
    sizeBytes: (row.size_bytes as number | null) ?? null,
    sourceKind: row.source_kind as 'upload' | 'chat_extracted',
    status: row.status as KnowledgeFile['status'],
    errorMsg: (row.error_msg as string | null) ?? null,
    r2Key: (row.r2_key as string | null) ?? null,
    fileHash: (row.file_hash as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function listPacks(userId: string): Promise<KnowledgePack[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM knowledge_packs WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map(rowToPack);
}

export async function getPack(userId: string, packId: string): Promise<KnowledgePack | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM knowledge_packs WHERE id = $1 AND user_id = $2`,
    [packId, userId]
  );
  if (rows.length === 0) return null;
  return rowToPack(rows[0]);
}

export async function createPack(userId: string, name: string, description?: string): Promise<KnowledgePack> {
  const pool = getPool();
  const { rows } = await pool.query<Record<string, unknown>>(
    `INSERT INTO knowledge_packs (user_id, name, description) VALUES ($1, $2, $3) RETURNING *`,
    [userId, name, description ?? null]
  );
  return rowToPack(rows[0]);
}

export async function updatePack(
  userId: string,
  packId: string,
  updates: { name?: string; description?: string | null }
): Promise<KnowledgePack | null> {
  const pool = getPool();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(updates.description);
  }
  if (fields.length === 0) return getPack(userId, packId);

  fields.push(`updated_at = now()`);
  values.push(packId, userId);

  const { rows } = await pool.query<Record<string, unknown>>(
    `UPDATE knowledge_packs SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
    values
  );
  if (rows.length === 0) return null;
  return rowToPack(rows[0]);
}

export async function deletePack(userId: string, packId: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT r2_key FROM knowledge_files WHERE pack_id = $1 AND r2_key IS NOT NULL`,
    [packId]
  );
  const objectStore = getObjectStore();
  await Promise.all(
    rows.map((r: Record<string, unknown>) =>
      objectStore.delete(r.r2_key as string).catch(() => {})
    )
  );
  await pool.query(
    `DELETE FROM knowledge_packs WHERE id = $1 AND user_id = $2`,
    [packId, userId]
  );
}

export async function listFiles(userId: string, packId: string): Promise<KnowledgeFile[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT kf.* FROM knowledge_files kf
     JOIN knowledge_packs kp ON kp.id = kf.pack_id
     WHERE kf.pack_id = $1 AND kp.user_id = $2
     ORDER BY kf.created_at DESC`,
    [packId, userId]
  );
  return rows.map(rowToFile);
}

export async function getFile(userId: string, fileId: string): Promise<KnowledgeFile | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT kf.* FROM knowledge_files kf
     JOIN knowledge_packs kp ON kp.id = kf.pack_id
     WHERE kf.id = $1 AND kp.user_id = $2`,
    [fileId, userId]
  );
  if (rows.length === 0) return null;
  return rowToFile(rows[0]);
}

export interface ChunkResult {
  chunkId: string;
  packId: string;
  fileId: string;
  filename: string;
  chunkIndex: number;
  text: string;
  rank: number;
}

export async function searchChunks(
  packIds: string[],
  query: string,
  limit = 8
): Promise<ChunkResult[]> {
  if (packIds.length === 0) return [];
  if (!query || !query.trim()) return [];

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       kc.id AS chunk_id,
       kc.pack_id,
       kc.file_id,
       kf.filename,
       kc.chunk_index,
       kc.text,
       ts_rank(kc.tsv, websearch_to_tsquery('english', $1)) AS rank
     FROM knowledge_chunks kc
     JOIN knowledge_files kf ON kf.id = kc.file_id
     WHERE kc.pack_id = ANY($2)
       AND kc.tsv @@ websearch_to_tsquery('english', $1)
     ORDER BY rank DESC
     LIMIT $3`,
    [query, packIds, limit]
  );
  return rows.map((r: Record<string, unknown>) => ({
    chunkId: r.chunk_id as string,
    packId: r.pack_id as string,
    fileId: r.file_id as string,
    filename: r.filename as string,
    chunkIndex: r.chunk_index as number,
    text: r.text as string,
    rank: Number(r.rank),
  }));
}

export async function attachPackToConversation(
  userId: string,
  conversationId: string,
  packId: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO conversation_knowledge_packs (conversation_id, pack_id)
     SELECT $1, $2
     WHERE EXISTS (
       SELECT 1 FROM conversations WHERE id = $1 AND user_id = $3
     ) AND EXISTS (
       SELECT 1 FROM knowledge_packs WHERE id = $2 AND user_id = $3
     )
     ON CONFLICT DO NOTHING`,
    [conversationId, packId, userId]
  );
}

export async function detachPackFromConversation(
  userId: string,
  conversationId: string,
  packId: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `DELETE FROM conversation_knowledge_packs ckp
     USING conversations c
     WHERE ckp.conversation_id = c.id
       AND c.user_id = $3
       AND ckp.conversation_id = $1
       AND ckp.pack_id = $2`,
    [conversationId, packId, userId]
  );
}

export async function getAttachedPackIds(conversationId: string): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT pack_id FROM conversation_knowledge_packs WHERE conversation_id = $1`,
    [conversationId]
  );
  return rows.map((r: Record<string, unknown>) => r.pack_id as string);
}
