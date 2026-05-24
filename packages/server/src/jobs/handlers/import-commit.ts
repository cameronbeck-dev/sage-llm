import type { Job } from 'pg-boss';
import { getPool } from '../../db/pool.js';
import { getObjectStore } from '../../storage/index.js';
import { parseImport } from '../../services/imports.js';
import { summarizeConversation, writeSummaryEntry, extractFactsFromSummaries, applyMemoryOps } from '../../services/_legacy/memory.js';
import { logger } from '../../logger.js';

export const IMPORT_COMMIT_JOB = 'import-commit';

interface ImportCommitData {
  importId: string;
}

export async function importCommitHandler(jobs: Job<ImportCommitData>[]): Promise<void> {
  for (const job of jobs) {
    const { importId } = job.data;
    const pool = getPool();

    let r2Key: string | null = null;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM imports WHERE id = $1`,
        [importId]
      );
      if (rows.length === 0) {
        logger.warn({ importId }, 'import-commit: import not found');
        continue;
      }
      const row = rows[0] as {
        id: string;
        user_id: string;
        source: 'chatgpt' | 'claude' | 'generic';
        filename: string;
        r2_key: string | null;
        status: string;
      };

      if (row.status !== 'committing') {
        logger.warn({ importId, status: row.status }, 'import-commit: unexpected status');
        continue;
      }
      r2Key = row.r2_key;

      if (!r2Key) throw new Error('No r2_key on import row');

      const objectStore = getObjectStore();
      const buffer = await objectStore.get(r2Key);
      const parsed = parseImport(buffer, row.filename, row.source);

      const userId = row.user_id;
      const newConversationIds: string[] = [];

      for (const conv of parsed.conversations) {
        try {
          const { rows: convRows } = await pool.query<{ id: string }>(
            `INSERT INTO conversations (user_id, title, archived, import_id, created_at, updated_at)
             VALUES ($1, $2, true, $3, $4, $4)
             RETURNING id`,
            [userId, conv.title, importId, conv.createdAt]
          );
          const convId = convRows[0].id;
          newConversationIds.push(convId);

          for (const msg of conv.messages) {
            await pool.query(
              `INSERT INTO messages (conversation_id, role, content, created_at)
               VALUES ($1, $2, $3, $4)`,
              [convId, msg.role, JSON.stringify([{ type: 'text', text: msg.content }]), msg.createdAt]
            );
          }

          const result = await summarizeConversation(userId, convId, conv.title);
          if (result) {
            const lastMsg = conv.messages[conv.messages.length - 1];
            await writeSummaryEntry(userId, convId, result.title, result.summary, lastMsg?.createdAt?.toISOString());
          }
        } catch (err) {
          logger.error({ err, importId, convTitle: conv.title }, 'import-commit: conversation failed');
        }
      }

      if (newConversationIds.length > 0) {
        const { rows: summaryRows } = await pool.query(
          `SELECT * FROM summary_entries
           WHERE user_id = $1 AND conversation_id = ANY($2) AND deleted_at IS NULL`,
          [userId, newConversationIds]
        );

        if (summaryRows.length > 0) {
          const summaries = summaryRows.map((r: Record<string, unknown>) => ({
            id: r.id as string,
            userId: r.user_id as string,
            conversationId: r.conversation_id as string | null,
            conversationTitle: r.conversation_title as string,
            summary: r.summary as string,
            lastMessageAt: r.last_message_at ? (r.last_message_at as Date).toISOString() : null,
            createdAt: (r.created_at as Date).toISOString(),
            deletedAt: null,
          }));

          try {
            const ops = await extractFactsFromSummaries(userId, summaries, 'fresh-import');
            await applyMemoryOps(userId, ops, null as unknown as string, null);
          } catch (err) {
            logger.error({ err, importId }, 'import-commit: extractFactsFromSummaries failed');
          }
        }
      }

      await pool.query(
        `UPDATE imports SET status = 'done', updated_at = now() WHERE id = $1`,
        [importId]
      );

      await objectStore.delete(r2Key).catch(() => {});
    } catch (err) {
      logger.error({ err, importId }, 'import-commit failed');
      await pool.query(
        `UPDATE imports SET status = 'failed', error_msg = $1, updated_at = now() WHERE id = $2`,
        [(err as Error).message, importId]
      ).catch(() => {});
    }
  }
}
