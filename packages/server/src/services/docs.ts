import { getPool } from '../db/pool.js';
import { getProvider } from '../providers/registry.js';
import { getUserSettings } from './settings.js';
import { getDecryptedCredential, CredentialNotFoundError } from './credentials.js';
import { createMessage } from './messages.js';
import type { MemoryDoc, ContentBlock } from '@sage/shared';

export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fall through
  }
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]) as T;
    } catch {
      // fall through
    }
  }
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[0]) as T;
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

export async function chatSync(
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

