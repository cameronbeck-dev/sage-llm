/**
 * Sage facts store — custom Postgres implementation.
 *
 * mem0ai v3.0.3's built-in pgvector adapter requires separate host/user/pass
 * params, creates its own pg.Client, and attempts to create/switch databases —
 * none of which are compatible with Sage's single-database, connection-URL
 * setup.  We therefore own the SQL layer directly (using the same schema from
 * migration 024_mem0_schema.sql) and expose the clean interface the rest of
 * Sage depends on.  mem0ai remains installed for its LLM-extraction utilities
 * (Phase 4 will wire in resolveRoleModel + use Memory.add for intelligent
 * deduplication).
 */

import { randomUUID } from 'node:crypto';
import { getPool } from '../../db/pool.js';
import { emit } from './events.js';

export interface FactRecord {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface SearchResult extends FactRecord {
  score: number;
}

export async function addFact(
  userId: string,
  text: string,
  metadata: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const pool = getPool();
  const id = randomUUID();
  const payload = { memory: text, user_id: userId, ...metadata, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };

  await pool.query(
    `INSERT INTO memories (id, payload) VALUES ($1, $2::jsonb)`,
    [id, JSON.stringify(payload)],
  );

  await pool.query(
    `INSERT INTO memory_history (memory_id, new_memory, event) VALUES ($1, $2, 'ADD')`,
    [id, text],
  );

  emit({ kind: 'fact_added', userId, factId: id, text });
  return { id };
}

export async function searchFacts(
  userId: string,
  query: string,
  k = 10,
): Promise<SearchResult[]> {
  const pool = getPool();
  // Full-text search via Postgres ts_rank since embeddings require the vector
  // extension which may not be enabled yet.  Phase 4 will upgrade to cosine ANN
  // once the embedding model is wired in.
  const { rows } = await pool.query<{ id: string; payload: Record<string, unknown>; rank: number }>(
    `SELECT id,
            payload,
            ts_rank(to_tsvector('simple', payload->>'memory'), plainto_tsquery('simple', $1)) AS rank
     FROM   memories
     WHERE  payload->>'user_id' = $2
       AND  to_tsvector('simple', payload->>'memory') @@ plainto_tsquery('simple', $1)
     ORDER  BY rank DESC
     LIMIT  $3`,
    [query, userId, k],
  );
  return rows.map(r => ({
    id: r.id,
    text: String(r.payload['memory'] ?? ''),
    score: Number(r.rank),
    metadata: r.payload,
    createdAt: new Date(String(r.payload['created_at'] ?? '')),
  }));
}

export async function listFacts(
  userId: string,
  filter: { limit?: number; offset?: number } = {},
): Promise<FactRecord[]> {
  const pool = getPool();
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  const { rows } = await pool.query<{ id: string; payload: Record<string, unknown> }>(
    `SELECT id, payload
     FROM   memories
     WHERE  payload->>'user_id' = $1
     ORDER  BY payload->>'created_at' DESC
     LIMIT  $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return rows.map(r => ({
    id: r.id,
    text: String(r.payload['memory'] ?? ''),
    metadata: r.payload,
    createdAt: new Date(String(r.payload['created_at'] ?? '')),
  }));
}

export async function getFact(factId: string): Promise<(FactRecord & { userId: string }) | null> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; payload: Record<string, unknown> }>(
    `SELECT id, payload FROM memories WHERE id = $1`,
    [factId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    text: String(r.payload['memory'] ?? ''),
    metadata: r.payload,
    createdAt: new Date(String(r.payload['created_at'] ?? '')),
    userId: String(r.payload['user_id'] ?? ''),
  };
}

export async function updateFact(factId: string, text: string): Promise<void> {
  const pool = getPool();
  const fact = await getFact(factId);
  if (!fact) return;

  const updated = { ...fact.metadata, memory: text, updated_at: new Date().toISOString() };
  await pool.query(
    `UPDATE memories SET payload = $1::jsonb WHERE id = $2`,
    [JSON.stringify(updated), factId],
  );

  await pool.query(
    `INSERT INTO memory_history (memory_id, old_memory, new_memory, event) VALUES ($1, $2, $3, 'UPDATE')`,
    [factId, fact.text, text],
  );

  emit({ kind: 'fact_updated', userId: fact.userId, factId });
}

export async function deleteFact(factId: string): Promise<void> {
  const pool = getPool();
  const fact = await getFact(factId);
  if (!fact) return;

  await pool.query(`DELETE FROM memories WHERE id = $1`, [factId]);

  await pool.query(
    `INSERT INTO memory_history (memory_id, old_memory, event, is_deleted) VALUES ($1, $2, 'DELETE', 1)`,
    [factId, fact.text],
  );

  emit({ kind: 'fact_deleted', userId: fact.userId, factId });
}
