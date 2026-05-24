import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  listMemoryEntries,
  updateMemoryEntry,
  softDeleteMemoryEntry,
  listMemoryEntryVersions,
  restoreMemoryEntry,
  listAllMemoryEntryVersions,
  listSummaryEntries,
  softDeleteSummaryEntry,
} from '../services/_legacy/memory.js';

export const memoryRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(s: string): boolean {
  return UUID_RE.test(s);
}

memoryRouter.get('/entries', requireAuth, async (req, res, next) => {
  try {
    const entries = await listMemoryEntries(req.session!.userId!);
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

memoryRouter.get('/entries/:id', requireAuth, async (req, res, next) => {
  try {
    if (!isUUID(req.params.id)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid entry id' } });
      return;
    }
    const entries = await listMemoryEntries(req.session!.userId!);
    const entry = entries.find(e => e.id === req.params.id && e.deletedAt === null);
    if (!entry) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Entry not found' } });
      return;
    }
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

memoryRouter.patch('/entries/:id', requireAuth, async (req, res, next) => {
  try {
    if (!isUUID(req.params.id)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid entry id' } });
      return;
    }
    const { body } = req.body as { body?: string };
    if (typeof body !== 'string') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'body required' } });
      return;
    }
    const entry = await updateMemoryEntry(req.session!.userId!, req.params.id, body, 'user', 'Edited via UI');
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

memoryRouter.delete('/entries/:id', requireAuth, async (req, res, next) => {
  try {
    if (!isUUID(req.params.id)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid entry id' } });
      return;
    }
    await softDeleteMemoryEntry(req.session!.userId!, req.params.id, 'user', 'Forgotten via UI');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

memoryRouter.get('/entries/:id/history', requireAuth, async (req, res, next) => {
  try {
    if (!isUUID(req.params.id)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid entry id' } });
      return;
    }
    const versions = await listMemoryEntryVersions(req.session!.userId!, req.params.id);
    res.json(versions);
  } catch (err) {
    next(err);
  }
});

memoryRouter.post('/entries/:id/restore', requireAuth, async (req, res, next) => {
  try {
    if (!isUUID(req.params.id)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid entry id' } });
      return;
    }
    const { versionId } = req.body as { versionId?: string };
    if (typeof versionId !== 'string' || !isUUID(versionId)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'versionId required and must be a valid UUID' } });
      return;
    }
    const entry = await restoreMemoryEntry(req.session!.userId!, req.params.id, versionId);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

memoryRouter.get('/history', requireAuth, async (req, res, next) => {
  try {
    const versions = await listAllMemoryEntryVersions(req.session!.userId!);
    res.json(versions);
  } catch (err) {
    next(err);
  }
});

memoryRouter.get('/summaries', requireAuth, async (req, res, next) => {
  try {
    const summaries = await listSummaryEntries(req.session!.userId!);
    res.json(summaries);
  } catch (err) {
    next(err);
  }
});

memoryRouter.delete('/summaries/:id', requireAuth, async (req, res, next) => {
  try {
    if (!isUUID(req.params.id)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid summary id' } });
      return;
    }
    await softDeleteSummaryEntry(req.session!.userId!, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
