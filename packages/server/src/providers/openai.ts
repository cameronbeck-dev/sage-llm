import { fetch } from 'undici';
import { createParser } from 'eventsource-parser';
import type { LLMProvider, ResolvedCredentials, ChatRequest, ChatChunk, Usage } from './types.js';
import { AuthError, RateLimitError, ProviderError } from './errors.js';
import type { ModelInfo, ContentBlock } from '@sage/shared';

const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
};

function mapError(status: number, body: unknown): never {
  const message = (body as { error?: { message?: string } })?.error?.message ?? 'Unknown error';
  if (status === 401) throw new AuthError('openai');
  if (status === 429) throw new RateLimitError('openai');
  if (status >= 500) throw new ProviderError('openai', message, true);
  throw new ProviderError('openai', message, false);
}

function toOpenAIMessages(messages: ChatRequest['messages'], system?: string): unknown[] {
  const result: unknown[] = [];
  if (system) result.push({ role: 'system', content: system });
  for (const m of messages) {
    if (typeof m.content === 'string') {
      result.push({ role: m.role, content: m.content });
      continue;
    }
    const blocks = m.content as ContentBlock[];

    // tool role or user role with tool_result blocks → OpenAI tool messages
    if (m.role === 'tool' || (m.role === 'user' && blocks.some((b) => b.type === 'tool_result'))) {
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          result.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
        }
      }
      continue;
    }

    // assistant with tool_use blocks → OpenAI assistant with tool_calls
    if (m.role === 'assistant' && blocks.some((b) => b.type === 'tool_use')) {
      const toolCalls = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => {
          const tb = b as { type: 'tool_use'; id: string; name: string; input: unknown };
          return {
            id: tb.id,
            type: 'function',
            function: { name: tb.name, arguments: JSON.stringify(tb.input) },
          };
        });
      const textContent = blocks.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join('');
      result.push({ role: 'assistant', content: textContent || null, tool_calls: toolCalls });
      continue;
    }

    // default: extract text
    const text = blocks.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join('');
    result.push({ role: m.role, content: text });
  }
  return result;
}

export const openaiProvider: LLMProvider = {
  id: 'openai',
  displayName: 'OpenAI',
  supportsTools: true,

  async listModels(creds: ResolvedCredentials): Promise<ModelInfo[]> {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${creds.apiKey}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      mapError(res.status, body);
    }
    const data = (await res.json()) as { data: { id: string }[] };
    return data.data
      .filter((m) => m.id.startsWith('gpt-4') || m.id.startsWith('gpt-3.5'))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({
        id: m.id,
        displayName: m.id,
        inputCostPer1k: OPENAI_PRICING[m.id]?.input,
        outputCostPer1k: OPENAI_PRICING[m.id]?.output,
      }));
  },

  async *chatStream(req: ChatRequest, creds: ResolvedCredentials): AsyncIterable<ChatChunk> {
    const messages = toOpenAIMessages(req.messages, req.system);

    const requestBody: Record<string, unknown> = {
      model: req.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: req.maxTokens,
    };

    if (req.tools && req.tools.length > 0) {
      requestBody.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }

    let res;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
    } catch (err) {
      yield { type: 'error', error: `Network error: ${(err as Error).message}` };
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const status = res.status;
      let errorMsg: string;
      if (status === 401) errorMsg = 'Invalid API key';
      else if (status === 429) errorMsg = 'Rate limit exceeded';
      else errorMsg = (body as { error?: { message?: string } })?.error?.message ?? 'Provider error';
      yield { type: 'error', error: errorMsg };
      return;
    }

    if (!res.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const usage: Usage = { inputTokens: 0, outputTokens: 0 };

    type ToolCallBuffer = { id: string; name: string; argsBuf: string };
    const toolCallBuffers = new Map<number, ToolCallBuffer>();
    const announcedToolIds = new Set<string>();

    const { readable, writable } = new TransformStream<ChatChunk, ChatChunk>();
    const writer = writable.getWriter();

    const parser = createParser({
      onEvent(event) {
        if (event.data === '[DONE]') return;
        try {
          const parsed = JSON.parse(event.data) as {
            choices?: {
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string;
            }[];
            usage?: { prompt_tokens: number; completion_tokens: number };
          };

          if (parsed.usage) {
            usage.inputTokens = parsed.usage.prompt_tokens;
            usage.outputTokens = parsed.usage.completion_tokens;
          }

          const choice = parsed.choices?.[0];
          if (!choice) return;

          const delta = choice.delta;
          if (delta?.content) {
            writer.write({ type: 'delta', text: delta.content }).catch(() => {});
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              let entry = toolCallBuffers.get(tc.index);
              if (!entry) {
                entry = { id: tc.id ?? '', name: tc.function?.name ?? '', argsBuf: '' };
                toolCallBuffers.set(tc.index, entry);
              }
              if (tc.id && !entry.id) entry.id = tc.id;
              if (tc.function?.name && !entry.name) entry.name = tc.function.name;
              if (!announcedToolIds.has(entry.id) && entry.id && entry.name) {
                announcedToolIds.add(entry.id);
                writer.write({ type: 'tool_call', id: entry.id, name: entry.name, complete: false }).catch(() => {});
              }
              if (tc.function?.arguments) {
                entry.argsBuf += tc.function.arguments;
                if (entry.id) {
                  writer.write({ type: 'tool_call', id: entry.id, inputJsonDelta: tc.function.arguments }).catch(() => {});
                }
              }
            }
          }

          if (choice.finish_reason === 'tool_calls') {
            for (const [, entry] of toolCallBuffers) {
              let parsed2: object = {};
              try {
                parsed2 = JSON.parse(entry.argsBuf);
              } catch {
                // malformed — empty input
              }
              writer.write({ type: 'tool_call', id: entry.id, complete: true, input: parsed2 }).catch(() => {});
            }
            toolCallBuffers.clear();
          }
        } catch {
          // ignore parse errors
        }
      },
    });

    (async () => {
      try {
        for await (const chunk of res.body!) {
          const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf-8');
          parser.feed(text);
        }
        await writer.write({ type: 'done', usage });
      } catch (err) {
        await writer.write({ type: 'error', error: (err as Error).message });
      } finally {
        writer.close().catch(() => {});
      }
    })();

    const reader = readable.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  },

  estimateCost(model: string, usage: Usage): number {
    const pricing = OPENAI_PRICING[model];
    if (!pricing) return 0;
    const inputCost = (usage.inputTokens / 1000) * pricing.input;
    const outputCost = (usage.outputTokens / 1000) * pricing.output;
    return inputCost + outputCost;
  },
};
