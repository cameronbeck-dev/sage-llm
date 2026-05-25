import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { readPage, listPages, getLog, getLinks, autocompletePaths, readVersion, listVersions } from '../services/wiki/store.js';
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
    const { limit, before } = req.query as Record<string, string | undefined>;
    const entries = await getLog(userId, {
      limit: limit !== undefined ? parseInt(limit, 10) : undefined,
      before,
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
