import './env.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import express from 'express';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { migrate } from './db/migrate.js';
import { sessionMiddleware } from './auth/session.js';
import { securityMiddleware } from './middleware/security.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiRouter } from './api/router.js';

const app = express();

app.use(securityMiddleware);
app.use(express.json());
app.use(sessionMiddleware);

app.use('/api', apiRouter);

const publicDir = join(__dirname, 'public');
if (existsSync(join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });
}

app.use(errorHandler as express.ErrorRequestHandler);

async function main() {
  if (config.DATABASE_URL) {
    try {
      await migrate();
    } catch (err) {
      console.error('[startup] migration failed', err);
    }
  } else {
    console.warn('[startup] DATABASE_URL not set, skipping migrations');
  }

  app.listen(config.PORT, () => {
    console.log(`Sage server running on http://localhost:${config.PORT}`);
  });
}

main().catch((err) => {
  console.error('[startup] fatal error', err);
  process.exit(1);
});

export { app };
