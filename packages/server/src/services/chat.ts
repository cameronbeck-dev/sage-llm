import { getPool } from '../db/pool.js';
import { getProvider } from '../providers/registry.js';
import { listMessages, createMessage } from './messages.js';
import { getUserSettings, updateUserSettings } from './settings.js';
import { getDecryptedCredential, CredentialNotFoundError } from './credentials.js';
import { reviewMemory, getDoc, updateDoc, createWhisper } from './docs.js';
import { getCurrentPeriodSpendCents } from './usage.js';
import type { ContentBlock } from '@sage/shared';

export interface SSEChunk {
  type: 'text' | 'thinking' | 'done' | 'error' | 'whisper' | 'title';
  delta?: string;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
  truncated?: boolean;
  whisperText?: string;
  title?: string;
  costUsd?: number;
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
  userMessage: string,
  previousId?: string
): AsyncIterable<SSEChunk> {
  const settings = await getUserSettings(userId);

  const [agentContent, memoryContents, history] = await Promise.all([
    getDefaultAgentFile(userId),
    getEnabledMemoryFiles(userId),
    listMessages(conversationId, 50),
  ]);

  if (history.length === 0) {
    const { listConversations, updateConversation } = await import('./conversations.js');
    const summariesDoc = await getDoc(userId, 'SUMMARIES.json');
    let summarizedIds = new Set<string>();
    if (summariesDoc?.content) {
      try {
        const data = JSON.parse(summariesDoc.content) as { entries: { conversationId: string }[] };
        summarizedIds = new Set(data.entries.map(e => e.conversationId));
      } catch {
        // ignore malformed
      }
    }
    const allConvos = await listConversations(userId);
    const unsummarized = allConvos.filter(c => c.id !== conversationId && !summarizedIds.has(c.id));
    for (const convo of unsummarized) {
      const { summarizeConversation } = await import('./docs.js');
      const result = await summarizeConversation(userId, convo.id, convo.title);
      if (result) {
        await updateConversation(userId, convo.id, { title: result.title });
      }
    }
  }

  let summariesBlock: string | null = null;
  if (history.length === 0) {
    const summariesDoc2 = await getDoc(userId, 'SUMMARIES.json');
    if (summariesDoc2?.content) {
      try {
        const parsed = JSON.parse(summariesDoc2.content) as {
          entries: Array<{ conversationId: string; conversationTitle: string; timestamp: string; summary: string; lastMessageAt?: string }>;
        };
        if (parsed.entries.length > 0) {
          const sorted = [...parsed.entries].sort((a, b) => {
            const aTime = a.lastMessageAt ?? a.timestamp;
            const bTime = b.lastMessageAt ?? b.timestamp;
            return bTime.localeCompare(aTime);
          });
          const lines = sorted.map((e, i) => {
            const when = e.lastMessageAt ?? e.timestamp;
            const date = when.slice(0, 16).replace('T', ' ');
            return `${i + 1}. [${date}] "${e.conversationTitle}": ${e.summary}`;
          });
          summariesBlock = `Past conversations (most recent first):\n${lines.join('\n')}`;
        }
      } catch {
        // ignore malformed
      }
    }
  }

  const systemParts: string[] = [];
  if (agentContent) systemParts.push(agentContent);
  if (memoryContents.length > 0) systemParts.push(memoryContents.join('\n\n'));
  if (summariesBlock) systemParts.push(summariesBlock);
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
          const truncatedCostUsd = finalUsage && provider.estimateCost ? provider.estimateCost(model, finalUsage) : undefined;
          await createMessage(conversationId, 'assistant', [
            { type: 'text', text: fullText },
          ], settings.activeProvider, model, finalUsage, truncatedCostUsd);
          yield { type: 'done', usage: finalUsage, truncated: true, costUsd: truncatedCostUsd };
          yield* maybeYieldBudgetWhisper(userId, conversationId, settings);
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

  let costUsd: number | undefined;
  if (finalUsage && provider.estimateCost) {
    costUsd = provider.estimateCost(model, finalUsage);
  }

  await createMessage(
    conversationId,
    'assistant',
    [{ type: 'text', text: fullText }],
    settings.activeProvider,
    model,
    finalUsage,
    costUsd
  );

  // Budget check — warn once per calendar month when budget is crossed
  yield* maybeYieldBudgetWhisper(userId, conversationId, settings);

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

  // If this is the first message of a new conversation, derive title from user message
  // and update the conversation. Also send title to client for sidebar update.
  if (history.length === 0 && userMessage.trim()) {
    const titleFromMsg = userMessage.trim().slice(0, 80);
    const { updateConversation } = await import('./conversations.js');
    await updateConversation(userId, conversationId, { title: titleFromMsg });
    yield { type: 'title', title: titleFromMsg };
  }

  yield { type: 'done', usage: finalUsage, costUsd: costUsd };
}

async function* maybeYieldBudgetWhisper(
  userId: string,
  conversationId: string,
  settings: Awaited<ReturnType<typeof getUserSettings>>
): AsyncIterable<SSEChunk> {
  if (settings.monthlyBudgetCents == null || settings.monthlyBudgetCents <= 0) return;
  const periodSpendCents = await getCurrentPeriodSpendCents(userId);
  const currentPeriod = new Date().toISOString().slice(0, 7);
  if (periodSpendCents >= settings.monthlyBudgetCents && settings.budgetWarnedPeriod !== currentPeriod) {
    const whisperText = `You've reached your $${(settings.monthlyBudgetCents / 100).toFixed(2)} monthly budget for ${currentPeriod}.`;
    await createWhisper(conversationId, whisperText);
    await updateUserSettings(userId, { budgetWarnedPeriod: currentPeriod });
    yield { type: 'whisper', whisperText };
  }
}