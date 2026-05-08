import type { Job } from 'pg-boss';
import { logger } from '../../logger.js';

export const NOOP_JOB = 'noop';

export async function noopHandler(jobs: Job[]): Promise<void> {
  for (const job of jobs) {
    logger.info({ jobId: job.id }, 'noop job executed');
  }
}
