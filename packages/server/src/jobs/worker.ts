import '../env.js';
import { getBoss, closeBoss } from './boss.js';
import { NOOP_JOB, noopHandler } from './handlers/noop.js';
import { IMPORT_PARSE_JOB, importParseHandler } from './handlers/import-parse.js';
import { IMPORT_COMMIT_JOB, importCommitHandler } from './handlers/import-commit.js';
import { KNOWLEDGE_PARSE_JOB, knowledgeParseHandler } from './handlers/knowledge-parse.js';
import { WIKI_MIGRATE, wikiMigrateHandler } from './handlers/wiki-migrate.js';
import { WIKI_CURATE_PAGE, wikiCuratePageHandler } from './handlers/wiki-curate-page.js';
import { WIKI_INGEST_TURN, wikiIngestTurnHandler } from './handlers/wiki-ingest-turn.js';
import { cleanupStaleCacheDirs } from '../services/wiki/cache.js';
import { logger } from '../logger.js';

async function main() {
  const boss = await getBoss();
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.createQueue(NOOP_JOB);
  await boss.work(NOOP_JOB, noopHandler);
  await boss.createQueue(IMPORT_PARSE_JOB);
  await boss.work(IMPORT_PARSE_JOB, importParseHandler);
  await boss.createQueue(IMPORT_COMMIT_JOB);
  await boss.work(IMPORT_COMMIT_JOB, importCommitHandler);
  await boss.createQueue(KNOWLEDGE_PARSE_JOB);
  await boss.work(KNOWLEDGE_PARSE_JOB, knowledgeParseHandler);
  await boss.createQueue(WIKI_MIGRATE);
  await boss.work(WIKI_MIGRATE, wikiMigrateHandler);
  await boss.createQueue(WIKI_CURATE_PAGE);
  await boss.work(WIKI_CURATE_PAGE, wikiCuratePageHandler);
  await boss.createQueue(WIKI_INGEST_TURN);
  await boss.work(WIKI_INGEST_TURN, wikiIngestTurnHandler);
  cleanupStaleCacheDirs().catch(() => {});
  logger.info('worker started');

  async function shutdown() {
    await closeBoss();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'worker fatal error');
  process.exit(1);
});
