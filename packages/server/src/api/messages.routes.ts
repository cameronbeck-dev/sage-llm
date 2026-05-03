import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { chatStream } from '../services/chat.js';
import { getConversation } from '../services/conversations.js';

export const messagesRouter = Router({ mergeParams: true });

messagesRouter.post('/', requireAuth, async (req, res, next) => {
  const { id: conversationId } = req.params;
  const { message } = req.body as { message?: string };

  if (!message || typeof message !== 'string' || message.trim() === '') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'message is required' } });
    return;
  }

  try {
    const convo = await getConversation(req.session!.userId!, conversationId);
    if (!convo) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
      return;
    }
  } catch (err) {
    next(err);
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const chunk of chatStream(req.session!.userId!, conversationId, message.trim())) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`);
  } finally {
    res.end();
  }
});
