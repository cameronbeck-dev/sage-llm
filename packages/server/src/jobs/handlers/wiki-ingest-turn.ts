import type { Job } from 'pg-boss';
import { ingestTurn } from '../../services/wiki/maintainer.js';
import { addFact } from '../../services/facts/mem0Client.js';
import { appendMessageWhisperActions } from '../../services/messages.js';
import type { WhisperAction } from '@sage/shared';
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

      const whisperActions: WhisperAction[] = [];

      for (const applied of result.appliedOpList) {
        if (applied.op === 'create') {
          whisperActions.push({
            kind: 'wiki_page_created',
            label: `Created ${applied.path}`,
            path: applied.path,
            title: applied.title ?? applied.path,
          });
        } else if (applied.op === 'update') {
          whisperActions.push({
            kind: 'wiki_page_updated',
            label: `Updated ${applied.path}`,
            path: applied.path,
          });
          if (applied.versionId) {
            whisperActions.push({
              kind: 'undo_wiki_edit',
              label: `Undo edit to ${applied.path}`,
              path: applied.path,
              versionId: applied.versionId,
            });
          }
        } else if (applied.op === 'delete') {
          whisperActions.push({
            kind: 'wiki_page_deleted',
            label: `Deleted ${applied.path}`,
            path: applied.path,
          });
        } else if (applied.op === 'link') {
          whisperActions.push({
            kind: 'wiki_page_updated',
            label: `Linked from ${applied.path}`,
            path: applied.path,
          });
        }
      }

      if (result.deferredOps > 0) {
        whisperActions.push({
          kind: 'review_deferred_ops',
          label: `Review ${result.deferredOps} deferred changes`,
          count: result.deferredOps,
        });
      }

      if (whisperActions.length > 0) {
        try {
          await appendMessageWhisperActions(assistantMessageId, whisperActions);
        } catch (whisperErr) {
          logger.error({ whisperErr, assistantMessageId }, '[wiki-ingest-turn] failed to append whisper actions');
        }
      }
    } catch (err) {
      logger.error({ err, conversationId, assistantMessageId }, '[wiki-ingest-turn] failed');
      throw err;
    }
  }
}
