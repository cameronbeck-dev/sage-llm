import { getPool } from '../db/pool.js';
import { getProvider } from '../providers/registry.js';
import { getUserSettings } from './settings.js';
import { getDecryptedCredential, CredentialNotFoundError } from './credentials.js';
import { listMessages, createMessage } from './messages.js';
import type { MemoryDoc, SummaryEntry, MemoryDelta, ContentBlock } from '@sage/shared';

function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fall through
  }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
  return null;
}

const VALID_FILENAMES = ['AGENTS.md', 'MEMORY.md', 'SUMMARIES.json'] as const;
type ValidFilename = typeof VALID_FILENAMES[number];

// ─── rowTo helpers ────────────────────────────────────────────────────────────

function rowToMemoryDoc(row: Record<string, unknown>): MemoryDoc {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    filename: row.filename as string,
    content: row.content as string,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

// ─── Default content ──────────────────────────────────────────────────────────

const DEFAULT_AGENTS = '# Agents\n\nYou are a helpful AI assistant.';
const DEFAULT_MEMORY = '# Memory\n\n';
const DEFAULT_SUMMARIES = JSON.stringify({ entries: [] });

// ─── Sync chat helper (collects streaming output) ─────────────────────────────

async function chatSync(
  userId: string,
  prompt: string,
): Promise<string> {
  const settings = await getUserSettings(userId);
  let apiKey: string;
  try {
    apiKey = await getDecryptedCredential(userId, settings.activeProvider);
  } catch (err) {
    if (err instanceof CredentialNotFoundError) {
      throw new Error(`No API key configured for ${settings.activeProvider}`);
    }
    throw err;
  }
  const provider = getProvider(settings.activeProvider);
  const model = settings.activeModel;
  const creds = { apiKey };

  let output = '';
  for await (const chunk of provider.chatStream({ model, messages: [{ role: 'user', content: prompt }] }, creds)) {
    if (chunk.type === 'delta' && chunk.text) {
      output += chunk.text;
    } else if (chunk.type === 'error') {
      throw new Error(chunk.error);
    }
  }
  return output;
}

// ─── getDocs ─────────────────────────────────────────────────────────────────

export async function getDocs(userId: string): Promise<MemoryDoc[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM memory_docs WHERE user_id = $1',
    [userId]
  );

  const byFilename = new Map(rows.map(rowToMemoryDoc).map(d => [d.filename, d]));
  const result: MemoryDoc[] = [];

  for (const filename of VALID_FILENAMES) {
    if (byFilename.has(filename)) {
      result.push(byFilename.get(filename)!);
    } else {
      // Create with defaults
      const defaultContent = filename === 'AGENTS.md' ? DEFAULT_AGENTS
        : filename === 'MEMORY.md' ? DEFAULT_MEMORY
        : DEFAULT_SUMMARIES;
      const now = new Date().toISOString();
      const { rows: inserted } = await pool.query<Record<string, unknown>>(
        `INSERT INTO memory_docs (user_id, filename, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (user_id, filename) DO UPDATE SET content = EXCLUDED.content
         RETURNING *`,
        [userId, filename, defaultContent, now]
      );
      result.push(rowToMemoryDoc(inserted[0]));
    }
  }

  return result;
}

export async function getDoc(userId: string, filename: string): Promise<MemoryDoc | null> {
  if (!VALID_FILENAMES.includes(filename as ValidFilename)) return null;
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM memory_docs WHERE user_id = $1 AND filename = $2',
    [userId, filename]
  );
  return rows.length > 0 ? rowToMemoryDoc(rows[0]) : null;
}

export async function updateDoc(userId: string, filename: string, content: string): Promise<void> {
  if (!VALID_FILENAMES.includes(filename as ValidFilename)) {
    throw new Error(`Invalid filename: ${filename}`);
  }
  const pool = getPool();
  await pool.query(
    `INSERT INTO memory_docs (user_id, filename, content, created_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (user_id, filename) DO UPDATE SET content = $3, updated_at = now()`,
    [userId, filename, content]
  );
}

// ─── Whisper messages ─────────────────────────────────────────────────────────

export async function createWhisper(
  conversationId: string,
  change: string
): Promise<string> {
  const content: ContentBlock[] = [{ type: 'text', text: change }];
  return createMessage(conversationId, 'whisper', content);
}

// ─── Memory review ────────────────────────────────────────────────────────────

export async function reviewMemory(
  userId: string,
  conversationId: string
): Promise<MemoryDelta> {
  const [docs, history] = await Promise.all([
    getDocs(userId),
    listMessages(conversationId, 1000),
  ]);

  const agentsDoc = docs.find(d => d.filename === 'AGENTS.md');
  const memoryDoc = docs.find(d => d.filename === 'MEMORY.md');

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

  const prompt = `You are reviewing a conversation to decide if anything should be saved to memory.
Current AGENTS.md:
${agentsDoc?.content ?? ''}

Current MEMORY.md:
${memoryDoc?.content ?? ''}

Recent conversation:
${recentMessages.map(m => `${m.role}: ${m.content}`).join('\n')}

Already whispered about in this conversation:
${whisperTexts || '(none)'}

Should anything be added or updated in MEMORY.md? You should only suggest changes if the information is:
- New (not already in MEMORY.md)
- Persistent (won't change next session)
- Useful (would affect how you assist this user)

Output ONLY a single JSON object, no other text:
- To update/replace MEMORY.md: {"action": "update", "filename": "MEMORY.md", "content": "...full new MEMORY.md content...", "summary": "...brief description of what changed..."}
- To append to MEMORY.md: {"action": "append", "filename": "MEMORY.md", "content": "...what to append...", "summary": "...brief description..."}
- If nothing needs changing: {"action": "none"}`;

  try {
    const text = await chatSync(userId, prompt);
    const delta = extractJson<MemoryDelta>(text);
    if (!delta) {
      console.error('[reviewMemory] failed to parse LLM output:', text.slice(0, 500));
      return { action: 'none', filename: 'MEMORY.md' };
    }
    return delta;
  } catch (err) {
    console.error('[reviewMemory] failed:', err);
    return { action: 'none', filename: 'MEMORY.md' };
  }
}

// ─── Session summary ──────────────────────────────────────────────────────────

export async function summarizeConversation(
  userId: string,
  conversationId: string,
  conversationTitle: string
): Promise<string | null> {
  const existing = await getDoc(userId, 'SUMMARIES.json');
  if (existing?.content) {
    try {
      const data = JSON.parse(existing.content) as { entries: SummaryEntry[] };
      if (data.entries.some(e => e.conversationId === conversationId)) {
        return null;
      }
    } catch {
      // fall through and let appendSummary handle malformed JSON
    }
  }

  const [docs, messages] = await Promise.all([
    getDocs(userId),
    listMessages(conversationId, 1000),
  ]);

  const lastMessageAt = messages.length > 0
    ? messages[messages.length - 1].createdAt
    : undefined;

  const memoryDoc = docs.find(d => d.filename === 'MEMORY.md');

  const conversationMessages = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join(''),
    }));

  const whisperTexts = messages
    .filter(m => m.role === 'whisper')
    .map(m => m.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join(''))
    .join('\n');

  const prompt = `Write a brief summary (2-4 sentences) of what was discussed in this conversation.
Focus on: facts learned, decisions made, outstanding tasks, topics explored.

Conversation title: ${conversationTitle}
Messages:
${conversationMessages.map(m => `${m.role}: ${m.content}`).join('\n')}

Already known from memory:
${memoryDoc?.content ?? ''}

Output a JSON object:
{"summary": "...2-4 sentence summary..."}`;

  try {
    const text = await chatSync(userId, prompt);
    const result = extractJson<{ summary: string }>(text);
    if (!result || !result.summary) {
      console.error('[memory] summarizeConversation parse failed for', conversationId, '— LLM output:', text.slice(0, 500));
      return null;
    }

    await appendSummary(userId, conversationId, conversationTitle, result.summary, lastMessageAt);
    return result.summary;
  } catch (err) {
    console.error('[memory] summarizeConversation failed for', conversationId, ':', err);
    return null;
  }
}

// ─── Append summary ────────────────────────────────────────────────────────────

export async function appendSummary(
  userId: string,
  conversationId: string,
  conversationTitle: string,
  summary: string,
  lastMessageAt?: string
): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT content FROM memory_docs WHERE user_id = $1 AND filename = $2',
    [userId, 'SUMMARIES.json']
  );

  let data = { entries: [] as SummaryEntry[] };
  if (rows.length > 0 && rows[0].content) {
    try {
      data = JSON.parse(rows[0].content as string);
    } catch {
      data = { entries: [] };
    }
  }

  data.entries.push({
    id: crypto.randomUUID(),
    conversationId,
    conversationTitle,
    timestamp: new Date().toISOString(),
    summary,
    lastMessageAt,
  });

  await updateDoc(userId, 'SUMMARIES.json', JSON.stringify(data, null, 2));
  await trimAndMigrateSummaries(userId);
}

// ─── Trim and migrate ─────────────────────────────────────────────────────────

export async function trimAndMigrateSummaries(userId: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT content FROM memory_docs WHERE user_id = $1 AND filename = $2',
    [userId, 'SUMMARIES.json']
  );

  if (rows.length === 0) return;
  let data: { entries: SummaryEntry[] };
  try {
    data = JSON.parse(rows[0].content as string);
  } catch {
    return;
  }

  if (data.entries.length <= 20) return;

  const sorted = [...data.entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const toRemove = sorted.slice(0, sorted.length - 20);
  const toKeep = sorted.slice(sorted.length - 20);

  // Batch migrate facts from all removed entries in a single LLM call
  if (toRemove.length > 0) {
    const memoryDoc = await getDoc(userId, 'MEMORY.md');
    const currentMemory = memoryDoc?.content ?? '# Memory\n\n';
    const removedSummaries = toRemove.map(e => `- [${e.conversationTitle}] ${e.summary}`).join('\n');

    const prompt = `Review each summary below and extract any facts not already in MEMORY.md that should be migrated.
Only extract information that is: new (not in current MEMORY.md), persistent, and useful.

Current MEMORY.md:
${currentMemory}

Summaries being removed:
${removedSummaries}

Output a single JSON object. If there are facts to migrate, output the full updated MEMORY.md:
{"action": "update", "content": "...full new MEMORY.md content...", "summary": "...brief description of what was migrated..."}

If nothing needs migrating:
{"action": "none"}`;

    try {
      const text = await chatSync(userId, prompt);
      const result = extractJson<{ action: string; content?: string; summary?: string }>(text);
      if (!result) {
        console.error('[memory] trimAndMigrateSummaries parse failed — LLM output:', text.slice(0, 500));
      } else if (result.action === 'update' && result.content) {
        await updateDoc(userId, 'MEMORY.md', result.content);
        if (result.summary) {
          const conversationId = toRemove[0]?.conversationId ?? 'unknown';
          await createWhisper(conversationId, `Memory migrated: ${result.summary}`);
        }
      }
    } catch {
      // Non-critical — proceed with trim even if migration fails
    }
  }

  await updateDoc(userId, 'SUMMARIES.json', JSON.stringify({ entries: toKeep }, null, 2));
}