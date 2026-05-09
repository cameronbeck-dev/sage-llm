import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, ResolvedCredentials, ChatRequest, ChatChunk, Usage } from './types.js';
import type { ModelInfo } from '@sage/shared';

// TODO: verify pricing before launch
const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-5':   { input: 15,  output: 75  },
  'claude-sonnet-4-5': { input: 3,   output: 15  },
  'claude-haiku-4-5':  { input: 1,   output: 5   },
};

const CURATED_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-5',   displayName: 'Claude Opus 4.5',   inputCostPer1k: ANTHROPIC_PRICING['claude-opus-4-5'].input / 1000,   outputCostPer1k: ANTHROPIC_PRICING['claude-opus-4-5'].output / 1000 },
  { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', inputCostPer1k: ANTHROPIC_PRICING['claude-sonnet-4-5'].input / 1000, outputCostPer1k: ANTHROPIC_PRICING['claude-sonnet-4-5'].output / 1000 },
  { id: 'claude-haiku-4-5',  displayName: 'Claude Haiku 4.5',  inputCostPer1k: ANTHROPIC_PRICING['claude-haiku-4-5'].input / 1000,  outputCostPer1k: ANTHROPIC_PRICING['claude-haiku-4-5'].output / 1000 },
];

export const anthropicProvider: LLMProvider = {
  id: 'anthropic',
  displayName: 'Anthropic',

  async listModels(creds: ResolvedCredentials): Promise<ModelInfo[]> {
    const client = new Anthropic({ apiKey: creds.apiKey });
    await client.models.list();
    return CURATED_MODELS;
  },

  async *chatStream(req: ChatRequest, creds: ResolvedCredentials): AsyncIterable<ChatChunk> {
    const client = new Anthropic({ apiKey: creds.apiKey });

    const messages = req.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const usage: Usage = { inputTokens: 0, outputTokens: 0 };

    let stream: ReturnType<typeof client.messages.stream>;
    try {
      stream = client.messages.stream({
        model: req.model,
        messages,
        system: req.system,
        max_tokens: req.maxTokens ?? 8192,
      });
    } catch (err) {
      yield { type: 'error', error: `Network error: ${(err as Error).message}` };
      return;
    }

    try {
      for await (const event of stream) {
        if (event.type === 'message_start') {
          usage.inputTokens = event.message.usage.input_tokens;
          usage.outputTokens = event.message.usage.output_tokens;
        } else if (event.type === 'content_block_start') {
          // No output needed on block start
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            yield { type: 'delta', text: delta.text };
          } else if (delta.type === 'thinking_delta') {
            yield { type: 'thinking', text: delta.thinking };
          }
        } else if (event.type === 'content_block_stop') {
          // No output needed
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
