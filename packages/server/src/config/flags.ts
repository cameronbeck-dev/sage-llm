import { config } from '../config.js';

export function isWikiEnabled(): boolean {
  return config.SAGE_WIKI_ENABLED;
}
