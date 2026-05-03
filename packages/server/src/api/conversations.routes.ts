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
import { summarizeConversation } from '../services/docs.js';

export const conversationsRouter = Router();

conversationsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const conversations = await listConversations(req.session!.userId!);
    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

conversationsRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const { title, previousId } = req.body as { title?: string; previousId?: string };

    // Summarize previous conversation if provided
    if (previousId) {
      const prevConvo = await getConversation(req.session!.userId!, previousId);
      if (prevConvo) {
        summarizeConversation(req.session!.userId!, previousId, prevConvo.title).catch((err) => {
          console.error('[conversations] summary failed', err);
        });
      }
    }

    const id = await createConversation(req.session!.userId!, title);
    const convo = await getConversation(req.session!.userId!, id);
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
    const { title, archived } = req.body as { title?: string; archived?: boolean };
    await updateConversation(req.session!.userId!, req.params.id, { title, archived });
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
