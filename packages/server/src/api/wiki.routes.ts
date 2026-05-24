import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { readPage, listPages, getLog, getLinks, autocompletePaths } from '../services/wiki/store.js';

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
