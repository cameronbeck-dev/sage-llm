import { getPool } from '../db/pool.js';
import { getProvider } from '../providers/registry.js';
import { listMessages, createMessage } from './messages.js';
import { getUserSettings } from './settings.js';
import { getDecryptedCredential, CredentialNotFoundError } from './credentials.js';
import { reviewMemory, getDoc, updateDoc, createWhisper } from './docs.js';
import type { ContentBlock } from '@sage/shared';

export interface SSEChunk {
  type: 'text' | 'thinking' | 'done' | 'error' | 'whisper';
  delta?: string;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
  truncated?: boolean;
  whisperText?: string;
}

async function getDefaultAgentFile(userId: string): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT content FROM memory_docs WHERE user_id = $1 AND filename = 'AGENTS.md'`,
    [userId]
  );
  return rows.length > 0 ? (rows[0].content as string) : null;
}

async function getEnabledMemoryFiles(userId: string): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT content FROM memory_docs WHERE user_id = $1 AND filename = 'MEMORY.md'`,
    [userId]
  );
  return rows.map((r) => r.content as string);
}

export async function* chatStream(
  userId: string,
  conversationId: string,
  userMessage: string
): AsyncIterable<SSEChunk> {
  const settings = await getUserSettings(userId);

  const [agentContent, memoryContents, history] = await Promise.all([
    getDefaultAgentFile(userId),
    getEnabledMemoryFiles(userId),
    listMessages(conversationId, 50),
  ]);

  const systemParts: string[] = [];
  if (agentContent) systemParts.push(agentContent);
  if (memoryContents.length > 0) systemParts.push(memoryContents.join('\n\n'));
  systemParts.push('Memory policy: When you update MEMORY.md, do not mention it in your response to the user. A whisper message will be sent automatically to inform the user of any memory changes.');
  const system = systemParts.join('\n\n---\n\n');

  const userContent: ContentBlock[] = [{ type: 'text', text: userMessage }];
  await createMessage(conversationId, 'user', userContent);

  let apiKey: string;
  try {
    apiKey = await getDecryptedCredential(userId, settings.activeProvider);
  } catch (err) {
    if (err instanceof CredentialNotFoundError) {
      yield { type: 'error', error: `No API key configured for ${settings.activeProvider}. Add one in Settings.` };
      return;
    }
    yield { type: 'error', error: (err as Error).message };
    return;
  }

  const creds = { apiKey };
  const provider = getProvider(settings.activeProvider);
  const model = settings.activeModel;

  const providerMessages = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join(''),
    }))
    .concat([{ role: 'user', content: userMessage }]);

  const chatReq = { model, messages: providerMessages, system };

  let fullText = '';
  let finalUsage: { inputTokens: number; outputTokens: number } | undefined;

  try {
    for await (const chunk of provider.chatStream(chatReq, creds)) {
      if (chunk.type === 'delta' && chunk.text) {
        fullText += chunk.text;
        yield { type: 'text', delta: chunk.text };
      } else if (chunk.type === 'thinking' && chunk.text) {
        yield { type: 'thinking', delta: chunk.text };
      } else if (chunk.type === 'done') {
        finalUsage = chunk.usage;
        if (chunk.truncated) {
          const truncationNotice = '\n\n[Output truncated due to token limit — response was cut off]';
          fullText += truncationNotice;
          const truncatedCost = finalUsage && provider.estimateCost ? provider.estimateCost(model, finalUsage) : undefined;
          yield { type: 'done', usage: finalUsage, truncated: true };
          await createMessage(conversationId, 'assistant', [
            { type: 'text', text: fullText },
          ], settings.activeProvider, model, finalUsage, truncatedCost);
          return;
        }
      } else if (chunk.type === 'error') {
        yield { type: 'error', error: chunk.error };
        await createMessage(conversationId, 'assistant', [
          { type: 'text', text: '[Error: ' + (chunk.error ?? 'unknown') + ']' },
        ]);
        return;
      }
    }
  } catch (err) {
    yield { type: 'error', error: (err as Error).message };
    return;
  }

  let costCents: number | undefined;
  if (finalUsage && provider.estimateCost) {
    costCents = provider.estimateCost(model, finalUsage);
  }

  await createMessage(
    conversationId,
    'assistant',
    [{ type: 'text', text: fullText }],
    settings.activeProvider,
    model,
    finalUsage,
    costCents
  );

  // Memory review pass — must complete before 'done' is sent to client
  let whisperText: string | undefined;
  await reviewMemory(userId, conversationId)
    .then(async (delta) => {
      if (delta.action === 'none' || !delta.content || !delta.summary) return;
      let newContent = delta.content;
      if (delta.action === 'append') {
        const current = await getDoc(userId, 'MEMORY.md');
        newContent = (current?.content ?? '# Memory\n\n') + '\n' + delta.content;
      }
      await updateDoc(userId, 'MEMORY.md', newContent);
      await createWhisper(conversationId, `Memory updated: ${delta.summary}`);
      whisperText = `Memory updated: ${delta.summary}`;
    })
    .catch((err) => {
      console.error('[memory] review pass failed', err);
    });

  if (whisperText) {
    yield { type: 'whisper', whisperText };
  }

  yield { type: 'done', usage: finalUsage };
}