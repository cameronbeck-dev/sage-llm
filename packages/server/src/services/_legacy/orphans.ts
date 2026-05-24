import { getPool } from '../../db/pool.js';

export interface OrphanRow {
  id: string;
  extractedText: string;
  signalTypes: string[];
}

export async function insertOrphan(opts: {
  userId: string;
  conversationId: string;
  messageId: string | null;
  extractedText: string;
  signalTypes: string[];
  importance: number;
  suggestedTopic: string;
}): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO orphan_extractions
       (user_id, conversation_id, message_id, extracted_text, signal_types, importance, suggested_topic)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      opts.userId,
      opts.conversationId,
      opts.messageId,
      opts.extractedText,
      opts.signalTypes,
      opts.importance,
      opts.suggestedTopic,
    ]
  );
  return rows[0].id;
}

export async function findPendingClusters(
  userId: string
): Promise<Array<{ suggestedTopic: string; count: number }>> {
  const pool = getPool();
  const { rows } = await pool.query<{ suggested_topic: string; count: string }>(
    `SELECT suggested_topic, count(*) AS count
     FROM orphan_extractions
     WHERE user_id = $1 AND consolidated_at IS NULL AND suggested_topic IS NOT NULL
     GROUP BY suggested_topic
     HAVING count(*) >= 5`,
    [userId]
  );
  return rows.map(r => ({ suggestedTopic: r.suggested_topic, count: Number(r.count) }));
}

export async function loadClusterOrphans(
  userId: string,
  suggestedTopic: string
): Promise<OrphanRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; extracted_text: string; signal_types: string[] }>(
    `SELECT id, extracted_text, signal_types
     FROM orphan_extractions
     WHERE user_id = $1 AND suggested_topic = $2 AND consolidated_at IS NULL`,
    [userId, suggestedTopic]
  );
  return rows.map(r => ({ id: r.id, extractedText: r.extracted_text, signalTypes: r.signal_types }));
}

export async function markConsolidated(orphanIds: string[]): Promise<void> {
  if (orphanIds.length === 0) return;
  const pool = getPool();
  await pool.query(
    `UPDATE orphan_extractions SET consolidated_at = now()
     WHERE id = ANY($1)`,
    [orphanIds]
  );
}

export async function getOrphansByIds(orphanIds: string[]): Promise<OrphanRow[]> {
  if (orphanIds.length === 0) return [];
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; extracted_text: string; signal_types: string[] }>(
    `SELECT id, extracted_text, signal_types
     FROM orphan_extractions
     WHERE id = ANY($1)`,
    [orphanIds]
  );
  return rows.map(r => ({ id: r.id, extractedText: r.extracted_text, signalTypes: r.signal_types }));
}
