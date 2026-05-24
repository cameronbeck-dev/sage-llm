import type { LLMProvider, ResolvedCredentials, ChatRequest, ChatChunk, Usage } from './types.js';
import { streamOpenAICompatible, type TextFilter } from './openai-compatible-stream.js';
import type { ModelInfo } from '@sage/shared';

// Pricing data — verify against https://platform.minimaxi.com/docs/pricing/overview
const MINIMAX_PRICING: Record<string, { input: number; output: number }> = {
  'MiniMax-M2.7': { input: 0.0007, output: 0.0027 },
  'MiniMax-M2.7-highspeed': { input: 0.0012, output: 0.0048 },
  'MiniMax-M2.5': { input: 0.0005, output: 0.0015 },
  'MiniMax-M2.1': { input: 0.00016, output: 0.0005 },
};

// Strips <think>...</think> blocks from streamed content.
// Stateful: tracks whether we're currently inside a think block across chunk boundaries.
class ThinkStripper implements TextFilter {
  private inside = false;
  private buf = '';

  filter(text: string): string {
    this.buf += text;
    let out = '';

    while (this.buf.length > 0) {
      if (this.inside) {
        const end = this.buf.indexOf('</think>');
        if (end === -1) {
          // Still inside; check if a partial closing tag is at the tail so we don't emit it yet
          const partialMatch = this.findPartialSuffix(this.buf, '</think>');
          if (partialMatch > 0) {
            // Keep the potential partial tag in the buffer
            this.buf = this.buf.slice(this.buf.length - partialMatch);
          } else {
            this.buf = '';
          }
          break;
        }
        // Found the closing tag — discard everything up to and including it
        this.buf = this.buf.slice(end + '</think>'.length);
        this.inside = false;
      } else {
        const start = this.buf.indexOf('<think>');
        if (start === -1) {
          // Check for partial opening tag at the tail
          const partialMatch = this.findPartialSuffix(this.buf, '<think>');
          if (partialMatch > 0) {
            out += this.buf.slice(0, this.buf.length - partialMatch);
            this.buf = this.buf.slice(this.buf.length - partialMatch);
          } else {
            out += this.buf;
            this.buf = '';
          }
          break;
        }
        // Emit text before the tag, then enter inside mode
        out += this.buf.slice(0, start);
        this.buf = this.buf.slice(start + '<think>'.length);
        this.inside = true;
      }
    }

    return out;
  }

  // Returns the length of the longest suffix of `haystack` that is a prefix of `needle`.
  private findPartialSuffix(haystack: string, needle: string): number {
    let best = 0;
    const maxLen = Math.min(haystack.length, needle.length - 1);
    for (let len = 1; len <= maxLen; len++) {
      if (haystack.endsWith(needle.slice(0, len))) {
        best = len;
      }
    }
    return best;
  }
}

export const minimaxProvider: LLMProvider = {
  id: 'minimax',
  displayName: 'MiniMax',
  supportsTools: true,

  async listModels(_creds: ResolvedCredentials): Promise<ModelInfo[]> {
    // MiniMax doesn't expose a list endpoint; return the hardcoded catalogue.
    return [
      {
        id: 'MiniMax-M2.7',
        displayName: 'MiniMax M2.7',
        inputCostPer1k: MINIMAX_PRICING['MiniMax-M2.7'].input,
        outputCostPer1k: MINIMAX_PRICING['MiniMax-M2.7'].output,
      },
      {
        id: 'MiniMax-M2.7-highspeed',
        displayName: 'MiniMax M2.7 (Highspeed)',
        inputCostPer1k: MINIMAX_PRICING['MiniMax-M2.7-highspeed'].input,
        outputCostPer1k: MINIMAX_PRICING['MiniMax-M2.7-highspeed'].output,
      },
      {
        id: 'MiniMax-M2.5',
        displayName: 'MiniMax M2.5',
        inputCostPer1k: MINIMAX_PRICING['MiniMax-M2.5'].input,
        outputCostPer1k: MINIMAX_PRICING['MiniMax-M2.5'].output,
      },
      {
        id: 'MiniMax-M2.1',
        displayName: 'MiniMax M2.1',
        inputCostPer1k: MINIMAX_PRICING['MiniMax-M2.1'].input,
        outputCostPer1k: MINIMAX_PRICING['MiniMax-M2.1'].output,
      },
    ];
  },

  async *chatStream(req: ChatRequest, creds: ResolvedCredentials): AsyncIterable<ChatChunk> {
    yield* streamOpenAICompatible({
      baseUrl: 'https://api.minimax.io/v1',
      apiKey: creds.apiKey,
      model: req.model,
      messages: req.messages,
      system: req.system,
      maxTokens: req.maxTokens,
      tools: req.tools,
      textFilter: new ThinkStripper(),
    });
  },

  estimateCost(model: string, usage: Usage): number {
    const pricing = MINIMAX_PRICING[model];
    if (!pricing) return 0;
    const inputCost = (usage.inputTokens / 1000) * pricing.input;
    const outputCost = (usage.outputTokens / 1000) * pricing.output;
    return inputCost + outputCost;
  },
};
