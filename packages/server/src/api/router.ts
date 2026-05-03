import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { conversationsRouter } from './conversations.routes.js';
import { messagesRouter } from './messages.routes.js';
import { settingsRouter } from './settings.routes.js';
import { providersRouter } from './providers.routes.js';

export const apiRouter = Router();

apiRouter.use('/', authRouter);
apiRouter.use('/conversations', conversationsRouter);
apiRouter.use('/conversations/:id/messages', messagesRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/providers', providersRouter);

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', name: 'sage' });
});
