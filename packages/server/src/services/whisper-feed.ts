import { getPool } from '../db/pool.js';
import { subscribe as subscribeWiki } from './wiki/events.js';
import { subscribe as subscribeFacts } from './facts/events.js';
import type { WhisperAction } from '@sage/shared';

export async function insertWhisperFeed(row: {
  userId: string;
  conversationId?: string | null;
  kind: string;
  displaySummary: string;
  payload?: Record<string, unknown>;
  actions?: WhisperAction[];
}): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO whisper_feed (user_id, conversation_id, kind, payload, display_summary, actions)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
     RETURNING id`,
    [
      row.userId,
      row.conversationId ?? null,
      row.kind,
      JSON.stringify(row.payload ?? {}),
      row.displaySummary,
      JSON.stringify(row.actions ?? []),
    ]
  );
  return rows[0].id;
}

export function setupSubscribers(): void {
  subscribeWiki((event) => {
    if (event.kind === 'page_created') {
      insertWhisperFeed({
        userId: event.userId,
        kind: 'wiki_page_created',
        displaySummary: `Created wiki page: ${event.path}`,
        payload: { pageId: event.pageId, path: event.path, summary: event.summary },
      }).catch((err) => console.error('[whisper-feed] wiki page_created insert failed:', err));
    } else if (event.kind === 'page_updated') {
      insertWhisperFeed({
        userId: event.userId,
        kind: 'wiki_page_updated',
        displaySummary: `Updated wiki page: ${event.path}`,
        payload: { pageId: event.pageId, path: event.path, summary: event.summary },
      }).catch((err) => console.error('[whisper-feed] wiki page_updated insert failed:', err));
    } else if (event.kind === 'page_deleted') {
      insertWhisperFeed({
        userId: event.userId,
        kind: 'wiki_page_deleted',
        displaySummary: `Deleted wiki page: ${event.path}`,
        payload: { pageId: event.pageId, path: event.path },
      }).catch((err) => console.error('[whisper-feed] wiki page_deleted insert failed:', err));
    }
  });

  subscribeFacts((event) => {
    if (event.kind === 'fact_added') {
      insertWhisperFeed({
        userId: event.userId,
        kind: 'fact_added',
        displaySummary: `Fact saved`,
        payload: { factId: event.factId, text: event.text },
      }).catch((err) => console.error('[whisper-feed] fact_added insert failed:', err));
    } else if (event.kind === 'fact_updated') {
      insertWhisperFeed({
        userId: event.userId,
        kind: 'fact_updated',
        displaySummary: `Fact updated`,
        payload: { factId: event.factId },
      }).catch((err) => console.error('[whisper-feed] fact_updated insert failed:', err));
    } else if (event.kind === 'fact_deleted') {
      insertWhisperFeed({
        userId: event.userId,
        kind: 'fact_deleted',
        displaySummary: `Fact deleted`,
        payload: { factId: event.factId },
      }).catch((err) => console.error('[whisper-feed] fact_deleted insert failed:', err));
    }
  });
}
