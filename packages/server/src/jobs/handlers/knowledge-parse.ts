import type { Job } from 'pg-boss';
import { getPool } from '../../db/pool.js';
import { getObjectStore } from '../../storage/index.js';
import { chunkText, insertChunks } from '../../services/knowledge-chunker.js';
import { logger } from '../../logger.js';

export const KNOWLEDGE_PARSE_JOB = 'knowledge-parse';

interface KnowledgeParseData {
  fileId: string;
}

async function parseBuffer(buffer: Buffer, filename: string, mimeType: string | null): Promise<string> {
  const lowerName = filename.toLowerCase();
  const dotIdx = lowerName.lastIndexOf('.');
  const ext = dotIdx >= 0 ? lowerName.slice(dotIdx) : '';

  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    return result.text;
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  return buffer.toString('utf-8');
}

export async function knowledgeParseHandler(jobs: Job<KnowledgeParseData>[]): Promise<void> {
  for (const job of jobs) {
    const { fileId } = job.data;
    const pool = getPool();

    try {
      const { rows } = await pool.query(
        `SELECT * FROM knowledge_files WHERE id = $1`,
        [fileId]
      );
      if (rows.length === 0) {
        logger.warn({ fileId }, 'knowledge-parse: file not found');
        continue;
      }
      const row = rows[0] as {
        id: string;
        pack_id: string;
        filename: string;
        mime_type: string | null;
        r2_key: string | null;
        status: string;
      };

      if (row.status === 'ready') continue;

      await pool.query(
        `UPDATE knowledge_files SET status = 'parsing' WHERE id = $1`,
        [fileId]
      );

      if (!row.r2_key) throw new Error('No r2_key on knowledge_files row');

      const objectStore = getObjectStore();
      const buffer = await objectStore.get(row.r2_key);

      const rawText = await parseBuffer(buffer, row.filename, row.mime_type);
      const chunks = chunkText(rawText, row.mime_type ?? '', row.filename);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE knowledge_files SET status = 'ready', raw_text = $1 WHERE id = $2`,
          [rawText, fileId]
        );
        await insertChunks(client, fileId, row.pack_id, chunks);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      logger.error({ err, fileId }, 'knowledge-parse failed');
      await pool.query(
        `UPDATE knowledge_files SET status = 'failed', error_msg = $1 WHERE id = $2`,
        [(err as Error).message, fileId]
      ).catch(() => {});
    }
  }
}
