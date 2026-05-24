import type { Job } from 'pg-boss';

export const WIKI_MIGRATE = 'wiki-migrate';

export async function wikiMigrateHandler(jobs: Job<unknown>[]): Promise<void> {
  console.log('[wiki-migrate] stub — payload:', jobs);
}
