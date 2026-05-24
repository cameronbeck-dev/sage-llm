import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, ResolvedCredentials, ChatRequest, ChatChunk, Usage } from './types.js';
import type { ModelInfo, ContentBlock } from '@sage/shared';

const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7':            { input: 5, output: 25 },
  'claude-sonnet-4-6':          { input: 3, output: 15 },
  'claude-haiku-4-5-20251001':  { input: 1, output: 5  },
};

const CURATED_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-7',           displayName: 'Claude Opus 4.7',   inputCostPer1k: ANTHROPIC_PRICING['claude-opus-4-7'].input / 1000,           outputCostPer1k: ANTHROPIC_PRICING['claude-opus-4-7'].output / 1000 },
  { id: 'claude-sonnet-4-6',         displayName: 'Claude Sonnet 4.6', inputCostPer1k: ANTHROPIC_PRICING['claude-sonnet-4-6'].input / 1000,         outputCostPer1k: ANTHROPIC_PRICING['claude-sonnet-4-6'].output / 1000 },
  { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5',  inputCostPer1k: ANTHROPIC_PRICING['claude-haiku-4-5-20251001'].input / 1000, outputCostPer1k: ANTHROPIC_PRICING['claude-haiku-4-5-20251001'].output / 1000 },
];

type AnthropicMessage = { role: 'user' | 'assistant'; content: string | unknown[] };

function toAnthropicMessages(messages: ChatRequest['messages']): AnthropicMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role as 'user' | 'assistant', content: m.content };
      }
      const blocks = m.content as ContentBlock[];
      const anthropicBlocks: unknown[] = blocks.map((b) => {
        if (b.type === 'text') return { type: 'text', text: b.text };
        if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
        if (b.type === 'tool_result') {
          return { type: 'tool_result', tool_use_id: b.tool_use_id, content: b.content, is_error: b.is_error };
        }
        return { type: 'text', text: '' };
      });
      return { role: m.role as 'user' | 'assistant', content: anthropicBlocks };
    });
}

export const anthropicProvider: LLMProvider = {
  id: 'anthropic',
  displayName: 'Anthropic',
  supportsTools: true,

  async listModels(creds: ResolvedCredentials): Promise<ModelInfo[]> {
    const client = new Anthropic({ apiKey: creds.apiKey });
    await client.models.list();
    return CURATED_MODELS;
  },

  async *chatStream(req: ChatRequest, creds: ResolvedCredentials): AsyncIterable<ChatChunk> {
    const client = new Anthropic({ apiKey: creds.apiKey });

    const messages = toAnthropicMessages(req.messages);

    const usage: Usage = { inputTokens: 0, outputTokens: 0 };

    const requestBody: Record<string, unknown> = {
      model: req.model,
      messages,
      system: req.system,
      max_tokens: req.maxTokens ?? 8192,
    };

    if (req.tools && req.tools.length > 0) {
      requestBody.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    let stream: ReturnType<typeof client.messages.stream>;
    try {
      stream = client.messages.stream(requestBody as unknown as Parameters<typeof client.messages.stream>[0]);
    } catch (err) {
      yield { type: 'error', error: `Network error: ${(err as Error).message}` };
      return;
    }

    const toolBuffers = new Map<string, { name: string; buf: string }>();
    let currentToolId: string | null = null;
    let currentBlockType: string | null = null;

    try {
      for await (const event of stream) {
        if (event.type === 'message_start') {
          usage.inputTokens = event.message.usage.input_tokens;
          usage.outputTokens = event.message.usage.output_tokens;
        } else if (event.type === 'content_block_start') {
          const block = event.content_block;
          currentBlockType = block.type;
          if (block.type === 'tool_use') {
            currentToolId = block.id;
            toolBuffers.set(block.id, { name: block.name, buf: '' });
            yield { type: 'tool_call', id: block.id, name: block.name, complete: false };
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            yield { type: 'delta', text: delta.text };
          } else if (delta.type === 'thinking_delta') {
            yield { type: 'thinking', text: delta.thinking };
          } else if (delta.type === 'input_json_delta' && currentToolId) {
            const entry = toolBuffers.get(currentToolId);
            if (entry) {
              entry.buf += delta.partial_json;
              yield { type: 'tool_call', id: currentToolId, inputJsonDelta: delta.partial_json };
            }
          }
        } else if (event.type === 'content_block_stop') {
          if (currentBlockType === 'tool_use' && currentToolId) {
            const entry = toolBuffers.get(currentToolId);
            if (entry) {
              let parsed: object = {};
              try {
                parsed = JSON.parse(entry.buf);
              } catch {
                // malformed — yield complete with empty input; caller handles error
              }
              yield { type: 'tool_call', id: currentToolId, complete: true, input: parsed };
            }
            currentToolId = null;
          }
          currentBlockType = null;
        } else if (event.type === 'message_delta') {
          if (event.usage) {
            usage.outputTokens = event.usage.output_tokens;
          }
        } else if (event.type === 'message_stop') {
          yield { type: 'done', usage };
        }
      }
    } catch (err) {
      yield { type: 'error', error: (err as Error).message };
    }
  },

  estimateCost(model: string, usage: Usage): number {
    const pricing = ANTHROPIC_PRICING[model];
    if (!pricing) return 0;
    const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  },
};
