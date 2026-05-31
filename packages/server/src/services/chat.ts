import { getPool } from '../db/pool.js';
import { getProvider, listProviders } from '../providers/registry.js';
import { listMessages, createMessage } from './messages.js';
import { getUserSettings, updateUserSettings } from './settings.js';
import { getDecryptedCredential, CredentialNotFoundError } from './credentials.js';
import { resolveRoleModel } from './settings/roleModel.js';
import { createWhisper } from './docs.js';
import { renderMemoryMarkdown, renderSummariesBlock, getExistingSummaryConversationIds, summarizeConversation } from './_legacy/memory.js';
import { getCurrentPeriodSpendCents } from './usage.js';
import { searchChunks, getAttachedPackIds, listPacks } from './_legacy/knowledge.js';
import { extractAfterTurn } from './_legacy/extraction.js';
import { buildPackLiteracyBlock } from '../prompts/pack-literacy.js';
import { isWikiEnabled } from '../config/flags.js';
import { getBoss } from '../jobs/boss.js';
import { WIKI_INGEST_TURN } from '../jobs/handlers/wiki-ingest-turn.js';
import * as maintainer from './wiki/maintainer.js';
import { searchFacts } from './facts/mem0Client.js';
import { getAllTools, getToolSchemas, getToolByName } from '../tools/registry.js';
import { consumeToolCallToken } from '../middleware/rateLimit.js';
import type { ContentBlock, SSEChunk } from '@sage/shared';
import type { ChatRequest } from '../providers/types.js';

export type { SSEChunk };

const MAX_TOOL_ROUNDS = 8;

const WEB_TOOL_LITERACY = `You have access to two web tools: \`web_search\` (searches the web for a query) and \`web_fetch\` (fetches a specific URL and returns its main content). Use them when the user asks about current events, specific URLs, or facts you might be uncertain about. Always cite sources as Markdown links inline in your response — the UI will surface a Sources footer automatically. Prefer \`web_search\` first, then \`web_fetch\` on specific results when more detail is needed.`;

async function getDefaultAgentFile(userId: string): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT content FROM memory_docs WHERE user_id = $1 AND filename = 'AGENTS.md'`,
    [userId]
  );
  return rows.length > 0 ? (rows[0].content as string) : null;
}

async function awaitPendingWikiIngest(conversationId: string, timeoutMs: number): Promise<void> {
  const pool = getPool();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { rows } = await pool.query(
        `SELECT 1 FROM pgboss.job
         WHERE name = $1 AND state IN ('created','active','retry')
           AND data->>'conversationId' = $2
         LIMIT 1`,
        [WIKI_INGEST_TURN, conversationId]
      );
      if (rows.length === 0) return;
    } catch (err) {
      console.warn('[chat] awaitPendingWikiIngest query failed, proceeding:', err);
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }
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

  const { getConversation, updateConversation } = await import('./conversations.js');
  const convo = await getConversation(userId, conversationId);

  const userPacks = await listPacks(userId);

  let wikiContext = '';
  let factsContext = '';
  if (isWikiEnabled()) {
    await awaitPendingWikiIngest(conversationId, 5000);
    try {
      wikiContext = await maintainer.queryForContext({
        userId,
        conversationId,
        recentUserMessage: userMessage,
      });
    } catch (err) {
      console.warn('[chat] wiki queryForContext failed:', err);
      wikiContext = '';
    }
    try {
      const facts = await searchFacts(userId, userMessage, 8);
      if (facts.length > 0) {
        const factsList = facts.map(f => `- ${f.text}`).join('\n');
        factsContext = `## Relevant facts about the user\n\n${factsList}`;
      }
    } catch (err) {
      console.warn('[chat] searchFacts failed:', err);
      factsContext = '';
    }
  }

  const systemParts: string[] = [];

  if (agentContent) systemParts.push(agentContent);

  systemParts.push(buildPackLiteracyBlock(userPacks));

  if (memoryContent) systemParts.push(memoryContent);
  if (summariesBlock) systemParts.push(summariesBlock);

  const attachedPackIds = convo?.attachedPackIds && convo.attachedPackIds.length > 0
    ? convo.attachedPackIds
    : await getAttachedPackIds(conversationId);

  if (attachedPackIds.length > 0) {
    const chunks = await searchChunks(attachedPackIds, userMessage, 8);
    if (chunks.length > 0) {
      const MAX_CHARS = 12000;
      let used = 0;
      const kept: typeof chunks = [];
      for (const chunk of chunks) {
        if (used + chunk.text.length > MAX_CHARS) break;
        kept.push(chunk);
        used += chunk.text.length;
      }
      if (kept.length > 0) {
        const contextBlock = kept
          .map(c => `[Source: ${c.filename}, chunk #${c.chunkIndex}]\n${c.text}`)
          .join('\n\n');
        systemParts.push(`Relevant context from knowledge packs:\n\n${contextBlock}`);
      }
    }
  }

  if (wikiContext) systemParts.push(wikiContext);
  if (factsContext) systemParts.push(factsContext);

  systemParts.push('Memory policy: Do not mention memory updates in your response to the user. A whisper message will be sent automatically to inform the user of any memory changes.');

  // Resolve provider/model: per-request override > conversation preferred > role model (chat)
  let resolvedProviderId: string = '';
  let resolvedModel: string = '';
  let apiKey: string = '';

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

  if (usedOverride || (convo?.preferredProvider && convo?.preferredModel)) {
    const pid = resolvedProviderId!;
    try {
      apiKey = await getDecryptedCredential(userId, pid);
    } catch (err) {
      if (err instanceof CredentialNotFoundError) {
        yield { type: 'error', error: `No API key configured for ${pid}. Add one in Settings.` };
        return;
      }
      yield { type: 'error', error: (err as Error).message };
      return;
    }
  } else {
    try {
      const resolved = await resolveRoleModel(userId, 'chat');
      resolvedProviderId = resolved.provider;
      resolvedModel = resolved.model;
      apiKey = resolved.apiKey;
    } catch (err) {
      yield { type: 'error', error: (err as Error).message };
      return;
    }
  }

  const creds = { apiKey };
  const provider = getProvider(resolvedProviderId);
  const model = resolvedModel;

  // Inject tool literacy if provider supports tools
  if (provider.supportsTools) {
    systemParts.push(WEB_TOOL_LITERACY);
  }
  const system = systemParts.join('\n\n---\n\n');

  const userContent: ContentBlock[] = [{ type: 'text', text: userMessage }];
  const userMessageId = await createMessage(conversationId, 'user', userContent);

  // Build provider messages from history + current user turn
  // Translate history rows: text-only rows become strings, rows with tool_use/tool_result blocks pass through
  const providerMessages: ChatRequest['messages'] = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const hasToolBlocks = m.content.some((b) => b.type === 'tool_use' || b.type === 'tool_result');
      if (hasToolBlocks) {
        return { role: m.role as 'user' | 'assistant', content: m.content };
      }
      return {
        role: m.role as 'user' | 'assistant',
        content: m.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join(''),
      };
    })
    .concat([{ role: 'user', content: userMessage }]);

  const tools = provider.supportsTools ? getToolSchemas() : undefined;

  let toolRound = 0;
  let finalAssistantMessageId: string | undefined;

  // Outer loop for tool rounds
  while (true) {
    const chatReq: ChatRequest = { model, messages: providerMessages, system, tools };

    let fullText = '';
    let fullThinking = '';
    let finalUsage: { inputTokens: number; outputTokens: number } | undefined;
    const pendingToolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    let streamError: string | undefined;
    let truncated = false;

    // Track currently-building tool call for name resolution
    const inFlightToolNames = new Map<string, string>();

    try {
      for await (const chunk of provider.chatStream(chatReq, creds)) {
        if (chunk.type === 'delta' && chunk.text) {
          fullText += chunk.text;
          yield { type: 'text', delta: chunk.text };
        } else if (chunk.type === 'thinking' && chunk.text) {
          fullThinking += chunk.text;
          yield { type: 'thinking', delta: chunk.text };
        } else if (chunk.type === 'tool_call') {
          if (chunk.name && !inFlightToolNames.has(chunk.id)) {
            inFlightToolNames.set(chunk.id, chunk.name);
          }
          if (chunk.complete && chunk.input !== undefined) {
            const name = chunk.name ?? inFlightToolNames.get(chunk.id) ?? '';
            pendingToolCalls.push({ id: chunk.id, name, input: chunk.input });
          }
        } else if (chunk.type === 'done') {
          finalUsage = chunk.usage;
          truncated = chunk.truncated ?? false;
          if (truncated) {
            const truncationNotice = '\n\n[Output truncated due to token limit — response was cut off]';
            fullText += truncationNotice;
            const truncatedCostUsd = finalUsage && provider.estimateCost ? provider.estimateCost(model, finalUsage) : undefined;
            finalAssistantMessageId = await createMessage(conversationId, 'assistant', [
              { type: 'text', text: fullText },
            ], resolvedProviderId, model, finalUsage, truncatedCostUsd, fullThinking || undefined);
            yield { type: 'done', usage: finalUsage, truncated: true, costUsd: truncatedCostUsd };
            yield* maybeYieldBudgetWhisper(userId, conversationId, settings);
            return;
          }
        } else if (chunk.type === 'error') {
          // Providers that cannot handle tools should set supportsTools: false rather than
          // emitting a sentinel error — that way tools are never forwarded in the first place.
          streamError = chunk.error;
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

    if (streamError) return;

    // No tool calls — this is the final assistant turn
    if (pendingToolCalls.length === 0) {
      let costUsd: number | undefined;
      if (finalUsage && provider.estimateCost) {
        costUsd = provider.estimateCost(model, finalUsage);
      }

      finalAssistantMessageId = await createMessage(
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
      yield* maybeYieldBudgetWhisper(userId, conversationId, settings);
      yield* finishTurn(userId, conversationId, userMessageId, finalAssistantMessageId, history.length, userMessage);
      return;
    }

    // Tool calls pending
    if (++toolRound >= MAX_TOOL_ROUNDS) {
      // Persist any text produced in this round
      if (fullText) {
        let costUsd: number | undefined;
        if (finalUsage && provider.estimateCost) costUsd = provider.estimateCost(model, finalUsage);
        finalAssistantMessageId = await createMessage(
          conversationId, 'assistant', [{ type: 'text', text: fullText }],
          resolvedProviderId, model, finalUsage, costUsd, fullThinking || undefined
        );
      }
      yield { type: 'whisper', whisperText: 'Reached tool-call limit for this turn.' };
      yield { type: 'response_complete' };
      if (finalAssistantMessageId) {
        yield* finishTurn(userId, conversationId, userMessageId, finalAssistantMessageId, history.length, userMessage);
      }
      return;
    }

    // Persist intermediate assistant turn (tool_use blocks + any text)
    const assistantBlocks: ContentBlock[] = [];
    if (fullText) assistantBlocks.push({ type: 'text', text: fullText });
    for (const tc of pendingToolCalls) {
      assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    await createMessage(
      conversationId, 'assistant', assistantBlocks,
      resolvedProviderId, model, finalUsage,
      finalUsage && provider.estimateCost ? provider.estimateCost(model, finalUsage) : undefined,
      fullThinking || undefined
    );

    // Execute each tool call sequentially
    const toolResultBlocks: ContentBlock[] = [];
    for (const tc of pendingToolCalls) {
      let rateLimited = false;
      try {
        await consumeToolCallToken(userId, tc.name);
      } catch {
        rateLimited = true;
      }

      if (rateLimited) {
        yield { type: 'tool_call_error', id: tc.id, name: tc.name, error: 'rate_limited' };
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: 'Error: rate_limited',
          is_error: true,
        });
        continue;
      }

      const tool = getToolByName(tc.name);
      if (!tool) {
        yield { type: 'tool_call_error', id: tc.id, name: tc.name, error: `unknown_tool: ${tc.name}` };
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: `Error: unknown tool "${tc.name}"`,
          is_error: true,
        });
        continue;
      }

      yield { type: 'tool_call_started', id: tc.id, name: tc.name, input: tc.input };

      // Record system_internal with provider=null so by-provider rollup doesn't pick it up
      await createMessage(
        conversationId, 'system_internal',
        [{ type: 'text', text: `[${tc.name}] ${JSON.stringify(tc.input).slice(0, 200)}` }],
        undefined, undefined, undefined, 0
      );

      let result: Awaited<ReturnType<typeof tool.execute>>;
      try {
        const racePromise = Promise.race([
          tool.execute(tc.input, { userId, conversationId }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
        ]);
        result = await racePromise;
      } catch (err) {
        const errorMsg = (err as Error).message;
        yield { type: 'tool_call_error', id: tc.id, name: tc.name, error: errorMsg };
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: `Error: ${errorMsg}`,
          is_error: true,
        });
        continue;
      }

      if (result.ok) {
        yield { type: 'tool_call_result', id: tc.id, name: tc.name, result: result.data };
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: JSON.stringify(result.data),
        });
      } else {
        yield { type: 'tool_call_error', id: tc.id, name: tc.name, error: result.error };
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: `Error: ${result.error}`,
          is_error: true,
        });
      }
    }

    // Persist synthetic user turn with tool_result blocks
    await createMessage(conversationId, 'user', toolResultBlocks);

    // Update providerMessages for the next round
    providerMessages.push({ role: 'assistant', content: assistantBlocks });
    providerMessages.push({ role: 'user', content: toolResultBlocks });
  }
}

async function* finishTurn(
  userId: string,
  conversationId: string,
  userMessageId: string,
  assistantMessageId: string,
  historyLength: number,
  userMessage: string
): AsyncIterable<SSEChunk> {
  if (isWikiEnabled()) {
    const boss = await getBoss();
    await boss.send(WIKI_INGEST_TURN, {
      userId,
      conversationId,
      userMessageId,
      assistantMessageId,
    });
    yield { type: 'whisper', whisperText: '' };
  } else {
    let destinationCompleteCount = 0;
    for await (const chunk of extractAfterTurn(userId, conversationId, userMessageId, assistantMessageId)) {
      if (chunk.type === 'extraction_progress' && chunk.stage === 'destination_complete') destinationCompleteCount++;
      yield chunk;
    }
    if (destinationCompleteCount === 0) {
      yield { type: 'whisper', whisperText: '' };
    }
  }

  if (historyLength === 0 && userMessage.trim()) {
    const titleFromMsg = userMessage.trim().slice(0, 80);
    const { updateConversation } = await import('./conversations.js');
    await updateConversation(userId, conversationId, { title: titleFromMsg });
    yield { type: 'title', title: titleFromMsg };
  }

  yield { type: 'done' };
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
