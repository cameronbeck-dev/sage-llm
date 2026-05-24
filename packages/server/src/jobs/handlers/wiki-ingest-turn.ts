import type { Job } from 'pg-boss';
import { ingestTurn } from '../../services/wiki/maintainer.js';
import { addFact } from '../../services/facts/mem0Client.js';
import { logger } from '../../logger.js';

export const WIKI_INGEST_TURN = 'wiki-ingest-turn';

interface WikiIngestTurnData {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  userId: string;
}

export async function wikiIngestTurnHandler(jobs: Job<WikiIngestTurnData>[]): Promise<void> {
  for (const job of jobs) {
    const { userId, conversationId, userMessageId, assistantMessageId } = job.data;
    try {
      const result = await ingestTurn({ userId, conversationId, userMessageId, assistantMessageId });
      logger.info(
        { conversationId, appliedOps: result.appliedOps, deferredOps: result.deferredOps },
        '[wiki-ingest-turn] complete'
      );

      for (const fact of result.facts) {
        try {
          await addFact(userId, fact.text, fact.metadata ?? {});
        } catch (factErr) {
          logger.error({ factErr, conversationId }, '[wiki-ingest-turn] failed to store fact');
        }
      }

      // TODO(Phase 5): append wiki whispers to assistantMessageId
    } catch (err) {
      logger.error({ err, conversationId, assistantMessageId }, '[wiki-ingest-turn] failed');
      throw err;
    }
  }
}
