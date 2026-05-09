import type { Job } from 'pg-boss';
import { getPool } from '../../db/pool.js';
import { getObjectStore } from '../../storage/index.js';
import { parseImport } from '../../services/imports.js';
import { logger } from '../../logger.js';

export const IMPORT_PARSE_JOB = 'import-parse';

interface ImportParseData {
  importId: string;
}

export async function importParseHandler(jobs: Job<ImportParseData>[]): Promise<void> {
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
        logger.warn({ importId }, 'import-parse: import not found');
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
      r2Key = row.r2_key;

      await pool.query(
        `UPDATE imports SET status = 'parsing', updated_at = now() WHERE id = $1`,
        [importId]
      );

      if (!r2Key) throw new Error('No r2_key on import row');

      const objectStore = getObjectStore();
      const buffer = await objectStore.get(r2Key);

      const parsed = parseImport(buffer, row.filename, row.source);

      const messageCount = parsed.conversations.reduce((sum, c) => sum + c.messages.length, 0);

      await pool.query(
        `UPDATE imports SET status = 'ready', source = $1, stats = $2, updated_at = now() WHERE id = $3`,
        [
          parsed.source,
          JSON.stringify({
            conversationCount: parsed.conversations.length,
            messageCount,
            skipped: parsed.skipped,
            errors: parsed.errors.slice(0, 10),
            source: parsed.source,
          }),
          importId,
        ]
      );
    } catch (err) {
      logger.error({ err, importId }, 'import-parse failed');
      await pool.query(
        `UPDATE imports SET status = 'failed', error_msg = $1, updated_at = now() WHERE id = $2`,
        [(err as Error).message, importId]
      ).catch(() => {});
      if (r2Key) {
        const objectStore = getObjectStore();
        await objectStore.delete(r2Key).catch(() => {});
      }
    }
  }
}
