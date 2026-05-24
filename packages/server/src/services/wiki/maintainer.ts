import { getPool } from '../../db/pool.js';
import { getObjectStore } from '../../storage/index.js';
import { getProvider } from '../../providers/registry.js';
import { getUserSettings } from '../settings.js';
import { getDecryptedCredential, CredentialNotFoundError } from '../credentials.js';
import { listMessages } from '../messages.js';
import { ensureBootstrap } from './bootstrap.js';
import { SCHEMA_KEY, INDEX_KEY } from './layout.js';
import { writePage, readPage, deletePage } from './store.js';
import { buildIngestPrompt } from '../../prompts/wiki/ingest.js';
import { buildQueryPrompt } from '../../prompts/wiki/query.js';
import { logger } from '../../logger.js';

const MAX_OPS_PER_TURN = 10;
const QUERY_CONTEXT_BUDGET = 2000;

function extractText(content: { type: string; text?: string }[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('');
}

async function callModel(userId: string, system: string, userText: string): Promise<string> {
  // TODO(Phase 4): use resolveRoleModel(userId, 'wiki_maintenance') once available
  const settings = await getUserSettings(userId);
  let apiKey: string;
  try {
    apiKey = await getDecryptedCredential(userId, settings.activeProvider);
  } catch (err) {
    if (err instanceof CredentialNotFoundError) {
      throw new Error(`[wiki/maintainer] no API key for ${settings.activeProvider}`);
    }
    throw err;
  }

  const provider = getProvider(settings.activeProvider);
  const model = settings.activeModel;
  const creds = { apiKey };

  let output = '';
  for await (const chunk of provider.chatStream(
    { model, system, messages: [{ role: 'user', content: userText }] },
    creds
  )) {
    if (chunk.type === 'delta' && chunk.text) {
      output += chunk.text;
    } else if (chunk.type === 'error') {
      throw new Error(chunk.error);
    }
  }
  return output;
}

function extractJson<T>(raw: string): T | null {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenceMatch ? fenceMatch[1] : raw;
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

type WikiOp =
  | { op: 'create'; path: string; title: string; type: string; body: string; reason?: string }
  | { op: 'update'; path: string; body: string; reason?: string }
  | { op: 'delete'; path: string; reason?: string }
  | { op: 'link'; sourcePath: string; targetPath: string; reason?: string };

interface IngestPlanRaw {
  wikiOps: WikiOp[];
  facts: Array<{ text: string; metadata?: Record<string, unknown> }>;
}

export interface IngestResult {
  appliedOps: number;
  deferredOps: number;
  facts: Array<{ text: string; metadata?: Record<string, unknown> }>;
}

export async function ingestTurn(opts: {
  userId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
}): Promise<IngestResult> {
  const { userId, conversationId, userMessageId, assistantMessageId } = opts;

  const allMessages = await listMessages(conversationId, 1000);
  const userMsg = allMessages.find(m => m.id === userMessageId);
  const assistantMsg = allMessages.find(m => m.id === assistantMessageId);

  if (!userMsg || !assistantMsg) {
    logger.warn({ userMessageId, assistantMessageId }, '[wiki/maintainer] messages not found');
    return { appliedOps: 0, deferredOps: 0, facts: [] };
  }

  const userText = extractText(userMsg.content as { type: string; text?: string }[]);
  const assistantText = extractText(assistantMsg.content as { type: string; text?: string }[]);

  if (!userText) return { appliedOps: 0, deferredOps: 0, facts: [] };

  await ensureBootstrap(userId);

  const store = getObjectStore();
  const schemaKey = SCHEMA_KEY(userId);
  const indexKey = INDEX_KEY(userId);

  let schema = '';
  let indexContent = '';
  try {
    schema = (await store.get(schemaKey)).toString('utf-8');
  } catch {
    schema = '';
  }
  try {
    indexContent = (await store.get(indexKey)).toString('utf-8');
  } catch {
    indexContent = '';
  }

  const { system, user } = buildIngestPrompt({
    schema,
    indexExcerpt: indexContent.slice(0, 3000),
    userText,
    assistantText,
  });

  let raw = '';
  try {
    raw = await callModel(userId, system, user);
  } catch (err) {
    logger.error({ err }, '[wiki/maintainer] ingestTurn model call failed');
    return { appliedOps: 0, deferredOps: 0, facts: [] };
  }

  const plan = extractJson<IngestPlanRaw>(raw);
  if (!plan) {
    logger.warn({ raw: raw.slice(0, 500) }, '[wiki/maintainer] failed to parse ingest plan');
    return { appliedOps: 0, deferredOps: 0, facts: [] };
  }

  const ops = Array.isArray(plan.wikiOps) ? plan.wikiOps : [];
  const facts = Array.isArray(plan.facts) ? plan.facts : [];

  const toApply = ops.slice(0, MAX_OPS_PER_TURN);
  const toDefer = ops.slice(MAX_OPS_PER_TURN);

  if (toDefer.length > 0) {
    const pool = getPool();
    for (const op of toDefer) {
      try {
        await pool.query(
          `INSERT INTO wiki_deferred_ops (turn_id, op_json, status)
           VALUES ($1, $2, 'pending')`,
          [assistantMessageId, JSON.stringify(op)]
        );
      } catch (err) {
        logger.error({ err, op }, '[wiki/maintainer] failed to insert deferred op');
      }
    }
    logger.info({ count: toDefer.length }, '[wiki/maintainer] deferred ops inserted');
  }

  let appliedOps = 0;
  for (const op of toApply) {
    try {
      if (op.op === 'create' || op.op === 'update') {
        await writePage({ userId, path: op.path, body: op.body, author: 'llm', reason: op.reason });
        appliedOps++;
      } else if (op.op === 'delete') {
        await deletePage(userId, op.path);
        appliedOps++;
      } else if (op.op === 'link') {
        const page = await readPage(userId, op.sourcePath);
        if (page) {
          const linkRef = `[[${op.targetPath}]]`;
          if (!page.body.includes(linkRef)) {
            await writePage({
              userId,
              path: op.sourcePath,
              body: page.body.trimEnd() + `\n${linkRef}\n`,
              author: 'llm',
              reason: op.reason,
            });
            appliedOps++;
          }
        }
      }
    } catch (err) {
      logger.error({ err, op }, '[wiki/maintainer] op failed, continuing');
    }
  }

  return { appliedOps, deferredOps: toDefer.length, facts };
}

export async function queryForContext(opts: {
  userId: string;
  conversationId: string;
  recentUserMessage: string;
}): Promise<string> {
  const { userId, recentUserMessage } = opts;

  try {
    await ensureBootstrap(userId);

    const store = getObjectStore();
    const indexKey = INDEX_KEY(userId);
    let indexContent = '';
    try {
      indexContent = (await store.get(indexKey)).toString('utf-8');
    } catch {
      return '';
    }

    const prompt = buildQueryPrompt({ index: indexContent.slice(0, 3000), recentUserMessage });

    // TODO(Phase 4): use resolveRoleModel(userId, 'wiki_maintenance') once available
    const settings = await getUserSettings(userId);
    let apiKey: string;
    try {
      apiKey = await getDecryptedCredential(userId, settings.activeProvider);
    } catch {
      return '';
    }

    const provider = getProvider(settings.activeProvider);
    const model = settings.activeModel;
    const creds = { apiKey };

    let raw = '';
    for await (const chunk of provider.chatStream(
      { model, messages: [{ role: 'user', content: prompt }] },
      creds
    )) {
      if (chunk.type === 'delta' && chunk.text) raw += chunk.text;
    }

    const result = extractJson<{ paths: string[] }>(raw);
    if (!result || !Array.isArray(result.paths)) return '';

    const paths = result.paths.slice(0, 5);
    if (paths.length === 0) return '';

    const sections: string[] = [];
    for (const path of paths) {
      try {
        const page = await readPage(userId, path);
        if (page) {
          sections.push(`### ${path}\n\n${page.body}`);
        }
      } catch {
        // skip unavailable pages
      }
    }

    if (sections.length === 0) return '';

    const full = `## Relevant Wiki Pages\n\n${sections.join('\n\n---\n\n')}`;
    return full.slice(0, QUERY_CONTEXT_BUDGET);
  } catch (err) {
    logger.warn({ err }, '[wiki/maintainer] queryForContext failed');
    return '';
  }
}

export function lintPage(_path: string): { ok: boolean; stub: boolean } {
  // TODO(Phase 8): implement
  return { ok: true, stub: true };
}
