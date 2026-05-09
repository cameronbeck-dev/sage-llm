import { getPool } from '../db/pool.js';
import { getProvider, listProviders } from '../providers/registry.js';
import { listMessages, createMessage } from './messages.js';
import { getUserSettings, updateUserSettings } from './settings.js';
import { getDecryptedCredential, CredentialNotFoundError } from './credentials.js';
import { createWhisper } from './docs.js';
import { reviewMemory, renderMemoryMarkdown, renderSummariesBlock, getExistingSummaryConversationIds, summarizeConversation } from './memory.js';
import { getCurrentPeriodSpendCents } from './usage.js';
import type { ContentBlock } from '@sage/shared';

export interface SSEChunk {
  type: 'text' | 'thinking' | 'done' | 'error' | 'whisper' | 'title' | 'response_complete';
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

export async function* chatStream(
  userId: string,
  conversationId: string,
  userMessage: string,
  previousId?: string,
  override?: { provider?: string; model?: string }
): AsyncIterable<SSEChunk> {
  const settings = await getUserSettings(userId);

  const [agentContent, history] = await Promise.all([
    getDefaultAgentFile(userId),
    listMessages(conversationId, 50),
  ]);

  if (history.length === 0) {
    const { listConversations, updateConversation } = await import('./conversations.js');
    const summarizedIds = await getExistingSummaryConversationIds(userId);
    const allConvos = await listConversations(userId);
    const unsummarized = allConvos.filter(c => c.id !== conversationId && !summarizedIds.has(c.id));
    for (const convo of unsummarized) {
      const result = await summarizeConversation(userId, convo.id, convo.title);
      if (result) {
        await updateConversation(userId, convo.id, { title: result.title });
      }
    }
  }

  let summariesBlock: string | null = null;
  if (history.length === 0) {
    summariesBlock = await renderSummariesBlock(userId);
  }

  const memoryMarkdown = await renderMemoryMarkdown(userId);
  const memoryContent = memoryMarkdown.includes('\n-') ? memoryMarkdown.trimEnd() : null;

  const systemParts: string[] = [];
  if (agentContent) systemParts.push(agentContent);
  if (memoryContent) systemParts.push(memoryContent);
  if (summariesBlock) systemParts.push(summariesBlock);
  systemParts.push('Memory policy: Do not mention memory updates in your response to the user. A whisper message will be sent automatically to inform the user of any memory changes.');
  const system = systemParts.join('\n\n---\n\n');

  const userContent: ContentBlock[] = [{ type: 'text', text: userMessage }];
  await createMessage(conversationId, 'user', userContent);

  // Resolve provider/model: per-request override > conversation preferred > user settings
  let resolvedProviderId = settings.activeProvider;
  let resolvedModel = settings.activeModel;

  const { getConversation, updateConversation } = await import('./conversations.js');
  const convo = await getConversation(userId, conversationId);

  let usedOverride = false;
  if (override?.provider && override?.model) {
    const knownProviders = listProviders().map((p) => p.id);
    if (knownProviders.includes(override.provider)) {
      resolvedProviderId = override.provider;
      resolvedModel = override.model;
      usedOverride = true;
    }
  }

  if (!usedOverride && convo?.preferredProvider && convo?.preferredModel) {
    resolvedProviderId = convo.preferredProvider;
    resolvedModel = convo.preferredModel;
  }

  if (usedOverride) {
    await updateConversation(userId, conversationId, {
      preferredProvider: override!.provider,
      preferredModel: override!.model,
    });
  }

  let apiKey: string;
  try {
    apiKey = await getDecryptedCredential(userId, resolvedProviderId);
  } catch (err) {
    if (err instanceof CredentialNotFoundError) {
      yield { type: 'error', error: `No API key configured for ${resolvedProviderId}. Add one in Settings.` };
      return;
    }
    yield { type: 'error', error: (err as Error).message };
    return;
  }

  const creds = { apiKey };
  const provider = getProvider(resolvedProviderId);
  const model = resolvedModel;

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
  let fullThinking = '';
  let finalUsage: { inputTokens: number; outputTokens: number } | undefined;

  try {
    for await (const chunk of provider.chatStream(chatReq, creds)) {
      if (chunk.type === 'delta' && chunk.text) {
        fullText += chunk.text;
        yield { type: 'text', delta: chunk.text };
      } else if (chunk.type === 'thinking' && chunk.text) {
        fullThinking += chunk.text;
        yield { type: 'thinking', delta: chunk.text };
      } else if (chunk.type === 'done') {
        finalUsage = chunk.usage;
        if (chunk.truncated) {
          const truncationNotice = '\n\n[Output truncated due to token limit — response was cut off]';
          fullText += truncationNotice;
          const truncatedCostUsd = finalUsage && provider.estimateCost ? provider.estimateCost(model, finalUsage) : undefined;
          await createMessage(conversationId, 'assistant', [
            { type: 'text', text: fullText },
          ], resolvedProviderId, model, finalUsage, truncatedCostUsd, fullThinking || undefined);
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
    resolvedProviderId,
    model,
    finalUsage,
    costUsd,
    fullThinking || undefined
  );

  yield { type: 'response_complete', costUsd };

  // Budget check — warn once per calendar month when budget is crossed
  yield* maybeYieldBudgetWhisper(userId, conversationId, settings);

  // Memory review pass — must complete before 'done' is sent to client
  const whisperTextsFromMemory: string[] = [];
  await reviewMemory(userId, conversationId)
    .then(async ({ whisperLines }) => {
      for (const line of whisperLines) {
        await createWhisper(conversationId, `Memory: ${line}`);
        whisperTextsFromMemory.push(`Memory: ${line}`);
      }
    })
    .catch((err) => {
      console.error('[memory] review pass failed', err);
    });

  for (const whisperText of whisperTextsFromMemory) {
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

  yield { type: 'done', usage: finalUsage };
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