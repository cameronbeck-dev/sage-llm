import type { Job } from 'pg-boss';

export const WIKI_CURATE_PAGE = 'wiki-curate-page';

export async function wikiCuratePageHandler(jobs: Job<unknown>[]): Promise<void> {
  console.log('[wiki-curate-page] stub — payload:', jobs);
}
