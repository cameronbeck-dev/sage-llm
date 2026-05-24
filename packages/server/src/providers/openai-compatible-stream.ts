import { fetch } from 'undici';
import { createParser } from 'eventsource-parser';
import type { ChatChunk, Usage, ToolSchema } from './types.js';
import type { ChatRequest } from './types.js';
import type { ContentBlock } from '@sage/shared';

export interface TextFilter {
  filter(text: string): string;
}

export interface OpenAICompatRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatRequest['messages'];
  system?: string;
  maxTokens?: number;
  tools?: ToolSchema[];
  textFilter?: TextFilter;
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

    if (m.role === 'tool' || (m.role === 'user' && blocks.some((b) => b.type === 'tool_result'))) {
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          result.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
        }
      }
      continue;
    }

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
      const textContent = blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');
      result.push({ role: 'assistant', content: textContent || null, tool_calls: toolCalls });
      continue;
    }

    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
    result.push({ role: m.role, content: text });
  }
  return result;
}

export async function* streamOpenAICompatible(req: OpenAICompatRequest): AsyncIterable<ChatChunk> {
  const messages = toOpenAIMessages(req.messages, req.system);

  const requestBody: Record<string, unknown> = {
    model: req.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: req.maxTokens ?? 4096,
  };

  if (req.tools && req.tools.length > 0) {
    requestBody.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
  }

  let res;
  try {
    res = await fetch(`${req.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
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
    else
      errorMsg =
        (body as { error?: { message?: string } })?.error?.message ??
        (body as { base_resp?: { status_msg?: string } })?.base_resp?.status_msg ??
        'Provider error';
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

  const textFilter = req.textFilter;

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
                type?: string;
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
          const text = textFilter ? textFilter.filter(delta.content) : delta.content;
          if (text) {
            writer.write({ type: 'delta', text }).catch(() => {});
          }
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
              writer
                .write({ type: 'tool_call', id: entry.id, name: entry.name, complete: false })
                .catch(() => {});
            }
            if (tc.function?.arguments) {
              entry.argsBuf += tc.function.arguments;
              if (entry.id) {
                writer
                  .write({ type: 'tool_call', id: entry.id, inputJsonDelta: tc.function.arguments })
                  .catch(() => {});
              }
            }
          }
        }

        if (choice.finish_reason === 'tool_calls') {
          for (const [, entry] of toolCallBuffers) {
            let parsedArgs: object = {};
            try {
              parsedArgs = JSON.parse(entry.argsBuf);
            } catch {
              // malformed — empty input
            }
            writer
              .write({ type: 'tool_call', id: entry.id, complete: true, input: parsedArgs })
              .catch(() => {});
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
        const text =
          typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf-8');
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
}
