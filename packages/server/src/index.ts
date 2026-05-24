import './env.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import express from 'express';
import { config } from './config.js';
import { logger } from './logger.js';
import { initSentry, sentryErrorHandler } from './sentry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { migrate } from './db/migrate.js';
import { sessionMiddleware } from './auth/session.js';
import { securityMiddleware } from './middleware/security.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiRouter } from './api/router.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { getObjectStore } from './storage/index.js';
import { getBoss } from './jobs/boss.js';
import { IMPORT_PARSE_JOB } from './jobs/handlers/import-parse.js';
import { IMPORT_COMMIT_JOB } from './jobs/handlers/import-commit.js';
import { KNOWLEDGE_PARSE_JOB } from './jobs/handlers/knowledge-parse.js';
import { WIKI_MIGRATE } from './jobs/handlers/wiki-migrate.js';
import { WIKI_CURATE_PAGE } from './jobs/handlers/wiki-curate-page.js';
import { WIKI_INGEST_TURN } from './jobs/handlers/wiki-ingest-turn.js';

initSentry();

const app = express();

if (config.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(requestIdMiddleware);
app.use(securityMiddleware);
app.use(express.json());
app.use(sessionMiddleware);
app.use(requestLogger);

app.use('/api', apiRouter);

const publicDir = join(__dirname, 'public');
if (existsSync(join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });
}

app.use(sentryErrorHandler() as unknown as express.ErrorRequestHandler);
app.use(errorHandler as express.ErrorRequestHandler);

async function main() {
  if (config.DATABASE_URL) {
    try {
      await migrate();
    } catch (err) {
      logger.error({ err }, '[startup] migration failed');
    }
  } else {
    logger.warn('[startup] DATABASE_URL not set, skipping migrations');
  }

  getObjectStore();
  logger.info({ store: config.OBJECT_STORE }, 'object store initialized');

  try {
    const boss = await getBoss();
    await boss.createQueue(IMPORT_PARSE_JOB);
    await boss.createQueue(IMPORT_COMMIT_JOB);
    await boss.createQueue(KNOWLEDGE_PARSE_JOB);
    await boss.createQueue(WIKI_MIGRATE);
    await boss.createQueue(WIKI_CURATE_PAGE);
    await boss.createQueue(WIKI_INGEST_TURN);
  } catch (err) {
    logger.error({ err }, '[startup] failed to ensure import queues exist');
  }

  app.listen(config.PORT, () => {
    logger.info(`Sage server running on http://localhost:${config.PORT}`);
  });
}

main().catch((err) => {
  logger.error({ err }, '[startup] fatal error');
  process.exit(1);
});

export { app };
