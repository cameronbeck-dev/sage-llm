import '../env.js';
import { getBoss, closeBoss } from './boss.js';
import { NOOP_JOB, noopHandler } from './handlers/noop.js';
import { logger } from '../logger.js';

async function main() {
  const boss = await getBoss();
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.createQueue(NOOP_JOB);
  await boss.work(NOOP_JOB, noopHandler);
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
