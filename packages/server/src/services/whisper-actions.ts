import { getPool } from '../db/pool.js';
import { createPack, attachPackToConversation } from './knowledge.js';
import { insertPackChunk } from './extraction.js';
import { getOrphansByIds } from './orphans.js';
import type { Message, WhisperAction } from '@sage/shared';
import { rowToMessage } from './messages.js';

export async function handleWhisperAction(
  userId: string,
  messageId: string,
  actionIndex: number
): Promise<Message> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: lockRows } = await client.query<Record<string, unknown>>(
      `SELECT * FROM messages WHERE id = $1 FOR UPDATE`,
      [messageId]
    );

    if (lockRows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Message not found') as Error & { status?: number };
      err.status = 404;
      throw err;
    }

    const lockedMessage = rowToMessage(lockRows[0]);

    const { rows: ownerRows } = await client.query<{ user_id: string }>(
      `SELECT user_id FROM conversations WHERE id = $1`,
      [lockedMessage.conversationId]
    );
    if (ownerRows.length === 0 || ownerRows[0].user_id !== userId) {
      await client.query('ROLLBACK');
      const err = new Error('Message not found') as Error & { status?: number };
      err.status = 404;
      throw err;
    }

    const actions = lockedMessage.whisperActions as WhisperAction[] | undefined;

    if (!actions) {
      await client.query('ROLLBACK');
      return lockedMessage;
    }

    if (!Array.isArray(actions) || actionIndex >= actions.length) {
      await client.query('ROLLBACK');
      const err = new Error('No action at that index') as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    const action: WhisperAction = actions[actionIndex];

    switch (action.kind) {
      case 'add_to_pack': {
        // chunk was pre-inserted; this is a no-op confirmation
        break;
      }

      case 'create_pack': {
        const orphans = await getOrphansByIds(action.orphanIds);
        const pack = await createPack(userId, action.suggestedName, action.suggestedDescription || undefined);

        for (const orphan of orphans) {
          await insertPackChunk(userId, pack.id, lockedMessage.conversationId, null, orphan.extractedText);
        }

        await attachPackToConversation(userId, lockedMessage.conversationId, pack.id, { autoExtract: false });
        break;
      }

      case 'always_extract_to_pack': {
        await client.query(
          `INSERT INTO conversation_knowledge_packs (conversation_id, pack_id, auto_extract)
           VALUES ($1, $2, true)
           ON CONFLICT (conversation_id, pack_id)
           DO UPDATE SET auto_extract = true`,
          [lockedMessage.conversationId, action.packId]
        );
        break;
      }

      case 'undo_extraction': {
        const { rows: chunkRows } = await client.query<{ file_id: string }>(
          `SELECT file_id FROM knowledge_chunks WHERE id = $1`,
          [action.chunkId]
        );
        if (chunkRows.length > 0) {
          const fileId = chunkRows[0].file_id;
          await client.query(`DELETE FROM knowledge_chunks WHERE id = $1`, [action.chunkId]);
          await client.query(`DELETE FROM knowledge_files WHERE id = $1`, [fileId]);
        }
        break;
      }

      case 'undo_memory': {
        await client.query(
          `UPDATE memory_entries SET deleted_at = now()
           WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
          [action.entryId, userId]
        );
        break;
      }

      case 'undo_orphan': {
        await client.query(
          `DELETE FROM orphan_extractions WHERE id = $1 AND user_id = $2`,
          [action.orphanId, userId]
        );
        break;
      }

      case 'dismiss': {
        // Mark all actions consumed below
        break;
      }

      case 'view_entry': {
        // Handled client-side; no server state change needed
        break;
      }

      default: {
        await client.query('ROLLBACK');
        const err = new Error('Unknown action kind') as Error & { status?: number };
        err.status = 400;
        throw err;
      }
    }

    // Mutate whisper_actions: set consumedAt on the triggered action (or all for dismiss)
    const updatedActions: WhisperAction[] = actions.map((a, i) => {
      if (action.kind === 'dismiss' || i === actionIndex) {
        return { ...a, consumedAt: new Date().toISOString() };
      }
      return a;
    });

    const { rows: updatedRows } = await client.query<Record<string, unknown>>(
      `UPDATE messages SET whisper_actions = $1::jsonb WHERE id = $2 RETURNING *`,
      [JSON.stringify(updatedActions), messageId]
    );
    await client.query('COMMIT');
    return updatedRows.length > 0 ? rowToMessage(updatedRows[0]) : lockedMessage;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore rollback error if already rolled back */ }
    throw err;
  } finally {
    client.release();
  }
}
