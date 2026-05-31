import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { chatStream } from '../services/chat.js';
import { getConversation } from '../services/conversations.js';
import { createMessage } from '../services/messages.js';
import { chatLimiter } from '../middleware/rateLimit.js';
import { listProviders } from '../providers/registry.js';
import type { ContentBlock } from '@sage/shared';

export const messagesRouter = Router({ mergeParams: true });

messagesRouter.post('/', requireAuth, chatLimiter, async (req, res, next) => {
  const { id: conversationId } = req.params;
  const { message, role, content, previousId, provider, model } = req.body as {
    message?: string;
    role?: string;
    content?: ContentBlock[];
    previousId?: string;
    provider?: string;
    model?: string;
  };

  // Support direct message creation (for /setup, whispers, etc.)
  if (role && content) {
    try {
      const convo = await getConversation(req.session!.userId!, conversationId);
      if (!convo) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
        return;
      }
      const msgId = await createMessage(conversationId, role, content);
      res.status(201).json({ id: msgId, conversationId, role, content, createdAt: new Date().toISOString() });
      return;
    } catch (err) {
      next(err);
      return;
    }
  }

  if (!message || typeof message !== 'string' || message.trim() === '') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'message is required' } });
    return;
  }

  if (provider && model) {
    const knownIds = listProviders().map((p) => p.id);
    if (!knownIds.includes(provider)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Unknown provider: ${provider}` } });
      return;
    }
  }

  let convo;
  try {
    convo = await getConversation(req.session!.userId!, conversationId);
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

  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 25_000);
  req.on('close', () => clearInterval(keepalive));

  try {
    const modelOverride = provider && model ? { provider, model } : undefined;
    for await (const chunk of chatStream(req.session!.userId!, conversationId, message.trim(), previousId, modelOverride)) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`);
  } finally {
    clearInterval(keepalive);
    res.end();
  }
});
