import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  listFacts,
  searchFacts,
  getFact,
  updateFact,
  deleteFact,
} from '../services/facts/mem0Client.js';

export const factsRouter = Router();

factsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const { limit, offset } = req.query as Record<string, string | undefined>;
    const facts = await listFacts(userId, {
      limit: limit !== undefined ? parseInt(limit, 10) : undefined,
      offset: offset !== undefined ? parseInt(offset, 10) : undefined,
    });
    res.json(facts);
  } catch (err) {
    next(err);
  }
});

factsRouter.get('/search', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const { q, k } = req.query as Record<string, string | undefined>;
    if (!q) {
      res.json([]);
      return;
    }
    const results = await searchFacts(userId, q, k !== undefined ? parseInt(k, 10) : undefined);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

factsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const fact = await getFact(req.params['id']!);
    if (!fact) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Fact not found' } });
      return;
    }
    if (fact.userId !== userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      return;
    }
    res.json(fact);
  } catch (err) {
    next(err);
  }
});

factsRouter.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const fact = await getFact(req.params['id']!);
    if (!fact) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Fact not found' } });
      return;
    }
    if (fact.userId !== userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      return;
    }
    const { text } = req.body as { text?: string };
    if (typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'text is required' } });
      return;
    }
    await updateFact(req.params['id']!, text);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

factsRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const fact = await getFact(req.params['id']!);
    if (!fact) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Fact not found' } });
      return;
    }
    if (fact.userId !== userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      return;
    }
    await deleteFact(req.params['id']!);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
