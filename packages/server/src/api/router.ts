import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { conversationsRouter } from './conversations.routes.js';
import { messagesRouter } from './messages.routes.js';
import { settingsRouter } from './settings.routes.js';
import { providersRouter } from './providers.routes.js';
import { docsRouter } from './docs.routes.js';
import { accountRouter } from './account.routes.js';
import { usageRouter } from './usage.routes.js';
import { memoryRouter } from './memory.routes.js';
import { importsRouter } from './imports.routes.js';
import { knowledgeRouter } from './knowledge.routes.js';
import { whispersRouter } from './whispers.routes.js';
import { wikiRouter } from './wiki.routes.js';
import { factsRouter } from './facts.routes.js';
import { storageRouter } from './storage.routes.js';
import { isWikiEnabled } from '../config/flags.js';

export const apiRouter = Router();

apiRouter.use('/storage', storageRouter);
apiRouter.use('/', authRouter);
apiRouter.use('/conversations', conversationsRouter);
apiRouter.use('/conversations/:id/messages', messagesRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/providers', providersRouter);
apiRouter.use('/docs', docsRouter);
apiRouter.use('/account', accountRouter);
apiRouter.use('/usage', usageRouter);
apiRouter.use('/memory', memoryRouter);
apiRouter.use('/imports', importsRouter);
apiRouter.use('/knowledge', knowledgeRouter);
apiRouter.use('/whispers', whispersRouter);

if (isWikiEnabled()) {
  apiRouter.use('/wiki', wikiRouter);
  apiRouter.use('/facts', factsRouter);
}

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', name: 'sage' });
});
