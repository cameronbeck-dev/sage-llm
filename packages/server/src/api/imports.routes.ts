import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { requireAuth } from '../auth/middleware.js';
import { importLimiter } from '../middleware/rateLimit.js';
import { getObjectStore } from '../storage/index.js';
import { getPool } from '../db/pool.js';
import { getBoss } from '../jobs/boss.js';

export const importsRouter = Router();

const upload = multer({
  dest: path.join(process.cwd(), 'var', 'uploads'),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const ALLOWED_EXTENSIONS = ['.zip', '.jsonl', '.json'];

function detectSource(filename: string): 'chatgpt' | 'claude' | 'generic' {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.zip') return 'chatgpt';
  if (ext === '.jsonl') return 'claude';
  return 'generic';
}

async function computeFileHash(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

importsRouter.post('/', requireAuth, importLimiter, upload.single('file'), async (req, res, next) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No file uploaded' } });
    return;
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    await fs.unlink(file.path).catch(() => {});
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'File must be .zip, .jsonl, or .json' } });
    return;
  }

  const userId = req.session!.userId!;

  try {
    const fileHash = await computeFileHash(file.path);

    const pool = getPool();
    const existing = await pool.query(
      `SELECT id, status FROM imports WHERE user_id = $1 AND file_hash = $2`,
      [userId, fileHash]
    );
    if (existing.rows.length > 0) {
      await fs.unlink(file.path).catch(() => {});
      const row = existing.rows[0] as { id: string; status: string };
      res.json({ importId: row.id, status: row.status });
      return;
    }

    const importResult = await pool.query<{ id: string }>(
      `INSERT INTO imports (user_id, source, filename, file_hash, status)
       VALUES ($1, $2, $3, $4, 'uploaded')
       RETURNING id`,
      [userId, detectSource(file.originalname), file.originalname, fileHash]
    );
    const importId = importResult.rows[0].id;

    const r2Key = `imports/${userId}/${importId}/${file.originalname}`;
    const { size: contentLength } = await fs.stat(file.path);
    const objectStore = getObjectStore();
    const fileStream = createReadStream(file.path);
    await objectStore.putStream(r2Key, fileStream, contentLength);

    await pool.query(
      `UPDATE imports SET r2_key = $1, updated_at = now() WHERE id = $2`,
      [r2Key, importId]
    );

    const boss = await getBoss();
    await boss.send('import-parse', { importId });

    await fs.unlink(file.path).catch(() => {});

    res.json({ importId, status: 'uploaded' });
  } catch (err) {
    await fs.unlink(file.path).catch(() => {});
    next(err);
  }
});

importsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM imports WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.session!.userId!]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

importsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM imports WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.session!.userId!]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Import not found' } });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

importsRouter.post('/:id/commit', requireAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM imports WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.session!.userId!]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Import not found' } });
      return;
    }
    const row = rows[0] as { id: string; status: string };
    if (row.status !== 'ready') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Import is not ready (status: ${row.status})` } });
      return;
    }

    const { rows: updated } = await pool.query(
      `UPDATE imports SET status = 'committing', updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    const boss = await getBoss();
    await boss.send('import-commit', { importId: req.params.id });

    res.json(updated[0]);
  } catch (err) {
    next(err);
  }
});
