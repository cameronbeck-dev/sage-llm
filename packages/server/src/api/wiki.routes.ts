import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  readPage, listPages, getLog, getLinks, autocompletePaths, readVersion, listVersions,
  writePage, deletePage, getPageIdByPath, renamePage,
  ContentHashMismatchError, RenameInProgressError,
} from '../services/wiki/store.js';
import { validatePagePath } from '../services/wiki/layout.js';
import { getObjectStore } from '../storage/index.js';
import { SCHEMA_KEY } from '../services/wiki/layout.js';
import { ensureBootstrap } from '../services/wiki/bootstrap.js';
import { getPool } from '../db/pool.js';

export const wikiRouter = Router();

wikiRouter.get('/pages', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const { type, tag, pathPrefix, limit, offset } = req.query as Record<string, string | undefined>;
    const pages = await listPages(userId, {
      type,
      tag,
      pathPrefix,
      limit: limit !== undefined ? parseInt(limit, 10) : undefined,
      offset: offset !== undefined ? parseInt(offset, 10) : undefined,
    });
    res.json(pages);
  } catch (err) {
    next(err);
  }
});

wikiRouter.get('/pages/*/versions/:versionId', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const { versionId } = req.params;
    const rawPath = (req.params as Record<string, string>)[0];
    const path = decodeURIComponent(rawPath);

    const pageResult = await readPage(userId, path);
    if (!pageResult) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Page not found' } });
      return;
    }

    const version = await readVersion(userId, pageResult.pageId, versionId);
    if (!version) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } });
      return;
    }

    res.json({
      path,
      versionId,
      body: version.body,
      contentHash: version.contentHash,
      author: version.author,
      reason: version.reason,
      createdAt: version.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

wikiRouter.get('/pages/*/versions', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const rawPath = (req.params as Record<string, string>)[0];
    const path = decodeURIComponent(rawPath);
    const versions = await listVersions(userId, path);
    res.json(versions.map(v => ({
      id: v.id,
      contentHash: v.contentHash,
      author: v.author,
      reason: v.reason,
      createdAt: v.createdAt,
    })));
  } catch (err) {
    next(err);
  }
});

wikiRouter.get('/pages/*', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const rawPath = (req.params as Record<string, string>)[0];
    const path = decodeURIComponent(rawPath);
    const page = await readPage(userId, path);
    if (!page) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Page not found' } });
      return;
    }
    res.json(page);
  } catch (err) {
    next(err);
  }
});

wikiRouter.get('/log', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const { limit, before, pageId } = req.query as Record<string, string | undefined>;
    const entries = await getLog(userId, {
      limit: limit !== undefined ? parseInt(limit, 10) : undefined,
      before,
      pageId,
    });
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

wikiRouter.get('/links', requireAuth, async (req, res, next) => {
  try {
    const { sourcePageId, targetPath } = req.query as Record<string, string | undefined>;
    const links = await getLinks({ sourcePageId, targetPath });
    res.json(links);
  } catch (err) {
    next(err);
  }
});

wikiRouter.get('/autocomplete', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const { q, limit } = req.query as Record<string, string | undefined>;
    if (!q) {
      res.json([]);
      return;
    }
    const results = await autocompletePaths(userId, q, limit !== undefined ? parseInt(limit, 10) : undefined);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

wikiRouter.put('/pages/*', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const rawPath = (req.params as Record<string, string>)[0];
    const path = decodeURIComponent(rawPath);

    try {
      validatePagePath(path);
    } catch (err) {
      res.status(400).json({ error: { code: 'INVALID_PATH', message: (err as Error).message } });
      return;
    }

    const { body } = req.body as { body: string };
    if (typeof body !== 'string') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'body must be a string' } });
      return;
    }

    const ifMatchRaw = req.headers['if-match'] as string | undefined;
    const expectedContentHash = ifMatchRaw ? ifMatchRaw.replace(/^"|"$/g, '') : undefined;

    try {
      const result = await writePage({ userId, path, body, author: 'user', reason: 'user edit', expectedContentHash });
      res.json({ path, contentHash: result.contentHash, versionId: result.versionId, pageId: result.pageId, noop: result.noop });
    } catch (err) {
      if (err instanceof ContentHashMismatchError) {
        res.status(409).json({
          error: { code: 'CONTENT_HASH_MISMATCH', message: err.message },
          ours: err.storedBody,
          ourHash: err.storedHash,
          theirs: body,
        });
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

wikiRouter.delete('/pages/*', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const rawPath = (req.params as Record<string, string>)[0];
    const path = decodeURIComponent(rawPath);
    await deletePage(userId, path);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

wikiRouter.post('/pages/*/restore/:versionId', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const { versionId } = req.params;
    const rawPath = (req.params as Record<string, string>)[0];
    const path = decodeURIComponent(rawPath);

    const pageId = await getPageIdByPath(userId, path);
    if (!pageId) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Page not found' } });
      return;
    }

    const version = await readVersion(userId, pageId, versionId);
    if (!version) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } });
      return;
    }

    const result = await writePage({
      userId,
      path,
      body: version.body,
      author: 'user',
      reason: `restore v${versionId.slice(0, 8)}`,
    });
    res.json({ path, contentHash: result.contentHash, versionId: result.versionId, pageId: result.pageId });
  } catch (err) {
    next(err);
  }
});

wikiRouter.post('/pages/*/rename', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const rawPath = (req.params as Record<string, string>)[0];
    const oldPath = decodeURIComponent(rawPath);
    const { newPath } = req.body as { newPath: string };

    if (typeof newPath !== 'string') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'newPath must be a string' } });
      return;
    }

    try {
      validatePagePath(oldPath);
      validatePagePath(newPath);
    } catch (err) {
      res.status(400).json({ error: { code: 'INVALID_PATH', message: (err as Error).message } });
      return;
    }

    try {
      await renamePage(userId, oldPath, newPath);
      res.json({ ok: true, oldPath, newPath });
    } catch (err) {
      if (err instanceof RenameInProgressError) {
        res.status(409).json({ error: { code: 'RENAME_IN_PROGRESS', path: err.path } });
        return;
      }
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'NOT_FOUND') {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: (err as Error).message } });
        return;
      }
      if (code === 'CONFLICT') {
        res.status(409).json({ error: { code: 'CONFLICT', message: (err as Error).message } });
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

wikiRouter.get('/schema', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const store = getObjectStore();
    try {
      const buf = await store.get(SCHEMA_KEY(userId));
      res.json({ body: buf.toString('utf-8') });
    } catch {
      await ensureBootstrap(userId);
      const buf = await store.get(SCHEMA_KEY(userId));
      res.json({ body: buf.toString('utf-8') });
    }
  } catch (err) {
    next(err);
  }
});

wikiRouter.put('/schema', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const { body } = req.body as { body: string };
    if (typeof body !== 'string' || body.trim().length === 0) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'body must be a non-empty string' } });
      return;
    }
    if (Buffer.byteLength(body, 'utf-8') > 100 * 1024) {
      res.status(400).json({ error: { code: 'TOO_LARGE', message: 'SCHEMA body exceeds 100KB limit' } });
      return;
    }
    const store = getObjectStore();
    await store.put(SCHEMA_KEY(userId), Buffer.from(body, 'utf-8'));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

wikiRouter.get('/deferred-ops', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const status = (req.query.status as string) ?? 'pending';
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, turn_id, op_json, status, created_at
       FROM wiki_deferred_ops
       WHERE user_id = $1 AND status = $2
       ORDER BY created_at DESC LIMIT 100`,
      [userId, status]
    );
    res.json({ deferred: rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      turnId: row.turn_id,
      op: row.op_json,
      status: row.status,
      createdAt: row.created_at,
    })) });
  } catch (err) {
    next(err);
  }
});
