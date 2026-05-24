import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { requireAuth } from '../auth/middleware.js';
import { getObjectStore } from '../storage/index.js';
import { getPool } from '../db/pool.js';
import { getBoss } from '../jobs/boss.js';
import { KNOWLEDGE_PARSE_JOB } from '../jobs/handlers/knowledge-parse.js';
import {
  listPacks,
  getPack,
  createPack,
  updatePack,
  deletePack,
  listFiles,
  getFile,
  attachPackToConversation,
  detachPackFromConversation,
  getAttachedPackIds,
} from '../services/knowledge.js';

export const knowledgeRouter = Router();

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.md', '.txt', '.docx', '.csv', '.json',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs',
  '.java', '.cpp', '.c', '.rb', '.swift',
]);

const upload = multer({
  dest: path.join(process.cwd(), 'var', 'uploads'),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${ext}`));
    }
  },
});

async function computeFileHash(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ─── Pack CRUD ────────────────────────────────────────────────────────────────

knowledgeRouter.get('/packs', requireAuth, async (req, res, next) => {
  try {
    const packs = await listPacks(req.session!.userId!);
    res.json(packs);
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.post('/packs', requireAuth, async (req, res, next) => {
  try {
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name || !name.trim()) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'name is required' } });
      return;
    }
    const pack = await createPack(req.session!.userId!, name.trim(), description);
    res.status(201).json(pack);
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.get('/packs/:packId', requireAuth, async (req, res, next) => {
  try {
    const pack = await getPack(req.session!.userId!, req.params.packId);
    if (!pack) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack not found' } });
      return;
    }
    res.json(pack);
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.patch('/packs/:packId', requireAuth, async (req, res, next) => {
  try {
    const { name, description } = req.body as { name?: string; description?: string | null };
    const pack = await updatePack(req.session!.userId!, req.params.packId, { name, description });
    if (!pack) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack not found' } });
      return;
    }
    res.json(pack);
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.delete('/packs/:packId', requireAuth, async (req, res, next) => {
  try {
    const pack = await getPack(req.session!.userId!, req.params.packId);
    if (!pack) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack not found' } });
      return;
    }
    await deletePack(req.session!.userId!, req.params.packId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ─── File upload ──────────────────────────────────────────────────────────────

knowledgeRouter.post('/packs/:packId/files', requireAuth, upload.single('file'), async (req, res, next) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No file uploaded' } });
    return;
  }

  const userId = req.session!.userId!;
  const { packId } = req.params;

  try {
    const pack = await getPack(userId, packId);
    if (!pack) {
      await fs.unlink(file.path).catch(() => {});
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack not found' } });
      return;
    }

    const fileHash = await computeFileHash(file.path);
    const pool = getPool();

    const existing = await pool.query(
      `SELECT id, status FROM knowledge_files WHERE pack_id = $1 AND file_hash = $2`,
      [packId, fileHash]
    );
    if (existing.rows.length > 0) {
      await fs.unlink(file.path).catch(() => {});
      res.json(existing.rows[0]);
      return;
    }

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO knowledge_files (pack_id, filename, mime_type, size_bytes, file_hash, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id`,
      [packId, file.originalname, file.mimetype || null, file.size, fileHash]
    );
    const fileId = rows[0].id;

    const r2Key = `knowledge/${userId}/${packId}/${fileId}/${file.originalname}`;
    const { size: contentLength } = await fs.stat(file.path);
    const objectStore = getObjectStore();
    const fileStream = createReadStream(file.path);
    await objectStore.putStream(r2Key, fileStream, contentLength);

    await pool.query(
      `UPDATE knowledge_files SET r2_key = $1 WHERE id = $2`,
      [r2Key, fileId]
    );

    const boss = await getBoss();
    await boss.send(KNOWLEDGE_PARSE_JOB, { fileId });

    await fs.unlink(file.path).catch(() => {});

    res.status(201).json({ fileId, status: 'pending' });
  } catch (err) {
    await fs.unlink(file.path).catch(() => {});
    next(err);
  }
});

knowledgeRouter.get('/packs/:packId/files', requireAuth, async (req, res, next) => {
  try {
    const pack = await getPack(req.session!.userId!, req.params.packId);
    if (!pack) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack not found' } });
      return;
    }
    const files = await listFiles(req.session!.userId!, req.params.packId);
    res.json(files);
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.get('/packs/:packId/files/:fileId', requireAuth, async (req, res, next) => {
  try {
    const file = await getFile(req.session!.userId!, req.params.fileId);
    if (!file || file.packId !== req.params.packId) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
      return;
    }
    res.json(file);
  } catch (err) {
    next(err);
  }
});

// ─── Conversation pack attachment ─────────────────────────────────────────────

knowledgeRouter.post('/conversations/:conversationId/packs/:packId', requireAuth, async (req, res, next) => {
  try {
    await attachPackToConversation(req.session!.userId!, req.params.conversationId, req.params.packId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.delete('/conversations/:conversationId/packs/:packId', requireAuth, async (req, res, next) => {
  try {
    await detachPackFromConversation(req.session!.userId!, req.params.conversationId, req.params.packId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.get('/conversations/:conversationId/packs', requireAuth, async (req, res, next) => {
  try {
    const packIds = await getAttachedPackIds(req.params.conversationId);
    res.json(packIds);
  } catch (err) {
    next(err);
  }
});

// ─── Chunk queries ────────────────────────────────────────────────────────────

knowledgeRouter.get('/packs/:packId/chunks', requireAuth, async (req, res, next) => {
  try {
    const pack = await getPack(req.session!.userId!, req.params.packId);
    if (!pack) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack not found' } });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query<{
      id: string; pack_id: string; file_id: string; filename: string; text: string; created_at: Date;
    }>(
      `SELECT kc.id, kc.pack_id, kc.file_id, kf.filename, kc.text, kc.created_at
       FROM knowledge_chunks kc
       JOIN knowledge_files kf ON kf.id = kc.file_id
       WHERE kc.pack_id = $1
       ORDER BY kc.created_at DESC`,
      [req.params.packId]
    );
    res.json(rows.map(r => ({
      id: r.id,
      packId: r.pack_id,
      fileId: r.file_id,
      sourceFilename: r.filename,
      body: r.text,
      createdAt: r.created_at.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.get('/chunks/:chunkId', requireAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query<{
      id: string; pack_id: string; file_id: string; filename: string; text: string; created_at: Date; user_id: string;
    }>(
      `SELECT kc.id, kc.pack_id, kc.file_id, kf.filename, kc.text, kc.created_at, kp.user_id
       FROM knowledge_chunks kc
       JOIN knowledge_files kf ON kf.id = kc.file_id
       JOIN knowledge_packs kp ON kp.id = kc.pack_id
       WHERE kc.id = $1`,
      [req.params.chunkId]
    );
    if (rows.length === 0 || rows[0].user_id !== req.session!.userId!) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Chunk not found' } });
      return;
    }
    const r = rows[0];
    res.json({
      id: r.id,
      packId: r.pack_id,
      fileId: r.file_id,
      sourceFilename: r.filename,
      body: r.text,
      createdAt: r.created_at.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
