import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
} from '../services/conversations.js';
import { listMessages } from '../services/messages.js';
import { listProviders } from '../providers/registry.js';

export const conversationsRouter = Router();

conversationsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const conversations = await listConversations(req.session!.userId!, 50, 0, includeArchived);
    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

conversationsRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const { title, seedFromPackId } = req.body as { title?: string; seedFromPackId?: string };

    const id = await createConversation(userId, title ?? 'New conversation', seedFromPackId);

    const convo = await getConversation(userId, id);
    res.status(201).json(convo);
  } catch (err) {
    next(err);
  }
});

conversationsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const convo = await getConversation(req.session!.userId!, req.params.id);
    if (!convo) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
      return;
    }
    const messages = await listMessages(req.params.id);
    res.json({ ...convo, messages });
  } catch (err) {
    next(err);
  }
});

conversationsRouter.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { title, archived, preferredProvider, preferredModel } = req.body as {
      title?: string;
      archived?: boolean;
      preferredProvider?: string | null;
      preferredModel?: string | null;
    };

    if (preferredProvider != null) {
      const knownIds = listProviders().map((p) => p.id);
      if (!knownIds.includes(preferredProvider)) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Unknown provider: ${preferredProvider}` } });
        return;
      }
    }

    await updateConversation(req.session!.userId!, req.params.id, {
      title,
      archived,
      preferredProvider,
      preferredModel,
    });
    const convo = await getConversation(req.session!.userId!, req.params.id);
    res.json(convo);
  } catch (err) {
    next(err);
  }
});

conversationsRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await deleteConversation(req.session!.userId!, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
