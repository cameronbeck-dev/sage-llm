import { getPool } from '../db/pool.js';
import { listMessages } from './messages.js';
import { chatSync, extractJson, createWhisper } from './docs.js';
import type { MemoryEntry, MemoryEntryVersion, SummaryEntryRow, MemoryOp } from '@sage/shared';

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToMemoryEntry(row: Record<string, unknown>): MemoryEntry {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    key: row.key as string,
    body: row.body as string,
    type: row.type as MemoryEntry['type'],
    sourceConversationId: row.source_conversation_id as string | null,
    sourceMessageId: row.source_message_id as string | null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
    deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  };
}

function rowToMemoryEntryVersion(row: Record<string, unknown>): MemoryEntryVersion {
  return {
    id: row.id as string,
    entryId: row.entry_id as string,
    entryKey: row.entry_key as string | undefined,
    body: row.body as string | null,
    changeSummary: row.change_summary as string | null,
    triggeredBy: row.triggered_by as MemoryEntryVersion['triggeredBy'],
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function rowToSummaryEntry(row: Record<string, unknown>): SummaryEntryRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    conversationId: row.conversation_id as string | null,
    conversationTitle: row.conversation_title as string,
    summary: row.summary as string,
    lastMessageAt: row.last_message_at ? (row.last_message_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  };
}

// ─── Rendering for system prompt ──────────────────────────────────────────────

export async function renderMemoryMarkdown(userId: string): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT key, body FROM memory_entries
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [userId]
  );
  if (rows.length === 0) return '# Memory\n\n';
  const lines = rows.map((r: Record<string, unknown>) => {
    const key = r.key as string;
    const body = r.body as string;
    if (body.includes(key)) return `- ${body}`;
    return `- ${key}: ${body}`;
  });
  return `# Memory\n\n${lines.join('\n')}\n`;
}

export async function renderSummariesBlock(userId: string): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT conversation_title, summary, last_message_at, created_at FROM summary_entries
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY last_message_at DESC NULLS LAST, created_at DESC
     LIMIT 20`,
    [userId]
  );
  if (rows.length === 0) return null;
  const lines = rows.map((r: Record<string, unknown>, i: number) => {
    const when = r.last_message_at ?? r.created_at;
    const date = (when as Date).toISOString().slice(0, 16).replace('T', ' ');
    return `${i + 1}. [${date}] "${r.conversation_title as string}": ${r.summary as string}`;
  });
  return `Past conversations (most recent first):\n${lines.join('\n')}`;
}

export async function getExistingSummaryConversationIds(userId: string): Promise<Set<string>> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT conversation_id FROM summary_entries
     WHERE user_id = $1 AND deleted_at IS NULL AND conversation_id IS NOT NULL`,
    [userId]
  );
  return new Set(rows.map((r: Record<string, unknown>) => r.conversation_id as string));
}

// ─── Entry CRUD ───────────────────────────────────────────────────────────────

export async function listMemoryEntries(userId: string): Promise<MemoryEntry[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM memory_entries
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [userId]
  );
  return rows.map(rowToMemoryEntry);
}

export async function getMemoryEntry(userId: string, entryId: string): Promise<MemoryEntry | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM memory_entries
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [entryId, userId]
  );
  return rows.length > 0 ? rowToMemoryEntry(rows[0]) : null;
}

export async function updateMemoryEntry(
  userId: string,
  entryId: string,
  body: string,
  triggeredBy: 'user' | 'llm',
  changeSummary: string
): Promise<MemoryEntry> {
  const pool = getPool();
  const { rows, rowCount } = await pool.query(
    `UPDATE memory_entries SET body = $1, updated_at = now()
     WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL
     RETURNING *`,
    [body, entryId, userId]
  );
  if (!rowCount || rowCount === 0) throw new Error(`Memory entry not found: ${entryId}`);
  await pool.query(
    `INSERT INTO memory_entry_versions (entry_id, body, change_summary, triggered_by)
     VALUES ($1, $2, $3, $4)`,
    [entryId, body, changeSummary, triggeredBy]
  );
  return rowToMemoryEntry(rows[0]);
}

export async function softDeleteMemoryEntry(
  userId: string,
  entryId: string,
  triggeredBy: 'user' | 'llm',
  changeSummary: string
): Promise<void> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE memory_entries SET deleted_at = now()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [entryId, userId]
  );
  if (!rowCount || rowCount === 0) return;
  await pool.query(
    `INSERT INTO memory_entry_versions (entry_id, body, change_summary, triggered_by)
     VALUES ($1, NULL, $2, $3)`,
    [entryId, changeSummary, triggeredBy]
  );
}

export async function restoreMemoryEntry(
  userId: string,
  entryId: string,
  versionId: string
): Promise<MemoryEntry> {
  const pool = getPool();
  const { rows: versionRows } = await pool.query(
    `SELECT v.body, m.user_id FROM memory_entry_versions v
     JOIN memory_entries m ON m.id = v.entry_id
     WHERE v.id = $1 AND v.entry_id = $2 AND m.user_id = $3`,
    [versionId, entryId, userId]
  );
  if (versionRows.length === 0) throw new Error('Version not found');
  const versionBody = versionRows[0].body as string | null;
  if (versionBody === null) {
    const err = new Error('Cannot restore from a delete record') as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  const { rows } = await pool.query(
    `UPDATE memory_entries SET body = $1, deleted_at = NULL, updated_at = now()
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [versionBody, entryId, userId]
  );
  await pool.query(
    `INSERT INTO memory_entry_versions (entry_id, body, change_summary, triggered_by)
     VALUES ($1, $2, $3, 'user')`,
    [entryId, versionBody, `Restored from version ${versionId}`]
  );
  return rowToMemoryEntry(rows[0]);
}

export async function listMemoryEntryVersions(userId: string, entryId: string): Promise<MemoryEntryVersion[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT v.* FROM memory_entry_versions v
     JOIN memory_entries m ON m.id = v.entry_id
     WHERE v.entry_id = $1 AND m.user_id = $2
     ORDER BY v.created_at DESC`,
    [entryId, userId]
  );
  return rows.map(rowToMemoryEntryVersion);
}

export async function listAllMemoryEntryVersions(userId: string): Promise<MemoryEntryVersion[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT v.*, m.key AS entry_key FROM memory_entry_versions v
     JOIN memory_entries m ON m.id = v.entry_id
     WHERE m.user_id = $1
     ORDER BY v.created_at DESC
     LIMIT 500`,
    [userId]
  );
  return rows.map(rowToMemoryEntryVersion);
}

// ─── Summary CRUD ─────────────────────────────────────────────────────────────

export async function listSummaryEntries(userId: string): Promise<SummaryEntryRow[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM summary_entries
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY last_message_at DESC NULLS LAST, created_at DESC`,
    [userId]
  );
  return rows.map(rowToSummaryEntry);
}

export async function softDeleteSummaryEntry(userId: string, summaryId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE summary_entries SET deleted_at = now()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [summaryId, userId]
  );
}

export async function summaryExistsForConversation(userId: string, conversationId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT 1 FROM summary_entries
     WHERE user_id = $1 AND conversation_id = $2 AND deleted_at IS NULL`,
    [userId, conversationId]
  );
  return rows.length > 0;
}

export async function writeSummaryEntry(
  userId: string,
  conversationId: string,
  conversationTitle: string,
  summary: string,
  lastMessageAt: string | undefined
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO summary_entries (user_id, conversation_id, conversation_title, summary, last_message_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, conversation_id) DO NOTHING`,
    [userId, conversationId, conversationTitle, summary, lastMessageAt ?? null]
  );
}

export async function trimSummaryEntries(userId: string): Promise<SummaryEntryRow[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, user_id, conversation_id, conversation_title, summary, last_message_at, created_at, deleted_at
       FROM summary_entries
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY COALESCE(last_message_at, created_at) DESC
       OFFSET 20
       FOR UPDATE`,
      [userId]
    );
    if (rows.length > 0) {
      const ids = rows.map((r: Record<string, unknown>) => r.id as string);
      await client.query(
        `UPDATE summary_entries SET deleted_at = now() WHERE id = ANY($1)`,
        [ids]
      );
    }
    await client.query('COMMIT');
    return rows.map(rowToSummaryEntry);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Apply LLM ops ────────────────────────────────────────────────────────────

export async function applyMemoryOps(
  userId: string,
  ops: MemoryOp[],
  sourceConversationId: string,
  sourceMessageId: string | null
): Promise<{ whisperLines: string[] }> {
  const pool = getPool();
  const whisperLines: string[] = [];

  for (const op of ops) {
    try {
      if (op.op === 'add') {
        const { rows } = await pool.query(
          `INSERT INTO memory_entries (user_id, key, body, type, source_conversation_id, source_message_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [userId, op.key, op.body, op.type ?? 'other', sourceConversationId, sourceMessageId]
        );
        const newId = rows[0].id as string;
        await pool.query(
          `INSERT INTO memory_entry_versions (entry_id, body, change_summary, triggered_by)
           VALUES ($1, $2, $3, 'llm')`,
          [newId, op.body, op.summary]
        );
        whisperLines.push(op.summary);
      } else if (op.op === 'update') {
        const { rows: checkRows } = await pool.query(
          `SELECT id FROM memory_entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
          [op.entryId, userId]
        );
        if (checkRows.length === 0) {
          console.warn('[applyMemoryOps] update skipped — entry not found or wrong user:', op.entryId);
          continue;
        }
        await updateMemoryEntry(userId, op.entryId, op.body, 'llm', op.summary);
        await pool.query(
          `UPDATE memory_entries SET source_conversation_id = $1, source_message_id = $2
           WHERE id = $3`,
          [sourceConversationId, sourceMessageId, op.entryId]
        );
        whisperLines.push(op.summary);
      } else if (op.op === 'forget') {
        const { rows: checkRows } = await pool.query(
          `SELECT id FROM memory_entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
          [op.entryId, userId]
        );
        if (checkRows.length === 0) {
          console.warn('[applyMemoryOps] forget skipped — entry not found or wrong user:', op.entryId);
          continue;
        }
        await softDeleteMemoryEntry(userId, op.entryId, 'llm', op.summary);
        whisperLines.push(op.summary);
      }
    } catch (err) {
      console.error('[applyMemoryOps] op failed, skipping:', op, err);
    }
  }

  return { whisperLines };
}

// ─── Review memory ────────────────────────────────────────────────────────────

export async function reviewMemory(
  userId: string,
  conversationId: string
): Promise<{ whisperLines: string[] }> {
  const [history, entries] = await Promise.all([
    listMessages(conversationId, 1000),
    listMemoryEntries(userId),
  ]);

  const memoryMarkdown = await renderMemoryMarkdown(userId);

  const recentMessages = history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-10)
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join(''),
    }));

  const whisperTexts = history
    .filter(m => m.role === 'whisper')
    .map(m => m.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join(''))
    .join('\n');

  const recentEntries = [...entries]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 30);

  const entriesList = recentEntries.length > 0
    ? recentEntries.map(e => `${e.id} | ${e.key} | ${e.body}`).join('\n')
    : '(none)';

  const prompt = `You are reviewing a conversation to decide whether to add, update, or forget memories.

Current memory entries (id — key — body, most recent 30):
${entriesList}

Recent conversation:
${recentMessages.map(m => `${m.role}: ${m.content}`).join('\n')}

Already whispered about in this conversation:
${whisperTexts || '(none)'}

Output ONLY a JSON array of operations, no other text. Each element:
{ "op": "add" | "update" | "forget", "entryId"?: "uuid", "key"?: "string",
  "body"?: "string", "type"?: "user|feedback|project|reference|other", "summary": "one-sentence rationale" }

- "add": include key, body, type, summary. Only add if information is new, persistent, and useful.
- "update": include entryId, body, summary. Only when an existing entry needs material change.
- "forget": include entryId, summary. Only when an entry is now wrong or useless.
- If nothing should change, output: []`;

  try {
    const text = await chatSync(userId, prompt);
    const ops = extractJson<MemoryOp[]>(text);
    if (!Array.isArray(ops)) {
      console.error('[reviewMemory] failed to parse LLM output as array:', text.slice(0, 500));
      return { whisperLines: [] };
    }

    const userMsgs = history.filter(m => m.role === 'user' || m.role === 'assistant');
    const sourceMessageId = userMsgs.length > 0
      ? userMsgs[userMsgs.length - 1].id
      : null;

    return applyMemoryOps(userId, ops, conversationId, sourceMessageId);
  } catch (err) {
    console.error('[reviewMemory] failed:', err);
    return { whisperLines: [] };
  }
}

// ─── Session summary ──────────────────────────────────────────────────────────

export async function summarizeConversation(
  userId: string,
  conversationId: string,
  conversationTitle: string
): Promise<{ summary: string; title: string } | null> {
  const alreadyExists = await summaryExistsForConversation(userId, conversationId);
  if (alreadyExists) return null;

  const [memoryMarkdown, messages] = await Promise.all([
    renderMemoryMarkdown(userId),
    listMessages(conversationId, 1000),
  ]);

  const lastMessageAt = messages.length > 0
    ? messages[messages.length - 1].createdAt
    : undefined;

  const conversationMessages = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join(''),
    }));

  const prompt = `Analyze this conversation and produce a short title and a brief summary.

Title rules: 3-6 words, noun phrase or topic descriptor, no leading article (The/A/An), no trailing punctuation, plain text, suitable as a sidebar label.
Summary rules: 2-4 sentences. Focus on facts learned, decisions made, outstanding tasks, topics explored.

Conversation title hint: ${conversationTitle}
Messages:
${conversationMessages.map(m => `${m.role}: ${m.content}`).join('\n')}

Already known from memory:
${memoryMarkdown}

Output a JSON object:
{"title": "...3-6 word title...", "summary": "...2-4 sentence summary..."}`;

  try {
    const text = await chatSync(userId, prompt);
    const result = extractJson<{ title: string; summary: string }>(text);
    if (!result || !result.title || !result.summary) {
      console.error('[memory] summarizeConversation parse failed for', conversationId, '— LLM output:', text.slice(0, 500));
      return null;
    }

    await writeSummaryEntry(userId, conversationId, result.title, result.summary, lastMessageAt);
    return { summary: result.summary, title: result.title };
  } catch (err) {
    console.error('[memory] summarizeConversation failed for', conversationId, ':', err);
    return null;
  }
}

// ─── Trim and migrate summaries ───────────────────────────────────────────────

export async function extractFactsFromSummaries(
  userId: string,
  summaries: SummaryEntryRow[],
  context: 'trimming-old-summaries' | 'fresh-import'
): Promise<MemoryOp[]> {
  if (summaries.length === 0) return [];

  const summaryLines = summaries.map(e => `- [${e.conversationTitle}] ${e.summary}`).join('\n');
  const currentMemory = await renderMemoryMarkdown(userId);

  const contextDescription = context === 'trimming-old-summaries'
    ? 'Summaries being removed'
    : 'Summaries from imported conversations the user is bringing into Sage from another assistant — extract durable facts about the user, their projects, preferences, ongoing work';

  const prompt = `Review each summary below and extract any facts not already in memory that should be migrated.
Only extract information that is: new (not in current memory), persistent, and useful.

Current memory:
${currentMemory}

${contextDescription}:
${summaryLines}

Output ONLY a JSON array of memory operations, no other text. Each element:
{ "op": "add", "key": "string", "body": "string", "type": "user|feedback|project|reference|other", "summary": "one-sentence rationale" }

If nothing needs migrating, output: []`;

  const text = await chatSync(userId, prompt);
  const ops = extractJson<MemoryOp[]>(text);
  if (!Array.isArray(ops)) {
    console.error('[extractFactsFromSummaries] parse failed — LLM output:', text.slice(0, 500));
    return [];
  }
  return ops;
}

export async function trimAndMigrateSummaries(userId: string): Promise<void> {
  const removed = await trimSummaryEntries(userId);
  if (removed.length === 0) return;

  try {
    const ops = await extractFactsFromSummaries(userId, removed, 'trimming-old-summaries');
    const sourceConversationId = removed[0]?.conversationId ?? 'unknown';
    await applyMemoryOps(userId, ops, sourceConversationId, null);
  } catch {
    // Non-critical — proceed even if migration fails
  }
}
