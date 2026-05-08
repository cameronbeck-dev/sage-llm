import { fetch } from 'undici';
import { createParser } from 'eventsource-parser';
import type { LLMProvider, ResolvedCredentials, ChatRequest, ChatChunk, Usage } from './types.js';
import { AuthError, RateLimitError, ProviderError } from './errors.js';
import type { ModelInfo } from '@sage/shared';

// Pricing data — verify against https://platform.minimaxi.com/docs/pricing/overview
const MINIMAX_PRICING: Record<string, { input: number; output: number }> = {
  'MiniMax-M2.7': { input: 0.0007, output: 0.0027 },        // $0.70/1M input, $2.70/1M output
  'MiniMax-M2.7-highspeed': { input: 0.0012, output: 0.0048 }, // premium for faster response
  'MiniMax-M2.5': { input: 0.0005, output: 0.0015 },        // $0.50/1M input, $1.50/1M output
  'MiniMax-M2.1': { input: 0.00016, output: 0.0005 },       // $0.16/1M input, $0.50/1M output
};

function mapError(status: number, body: unknown): never {
  const message =
    (body as { base_resp?: { status_msg?: string } })?.base_resp?.status_msg ??
    (body as { error?: { message?: string } })?.error?.message ??
    'Unknown error';
  if (status === 401) throw new AuthError('minimax');
  if (status === 429) throw new RateLimitError('minimax');
  if (status >= 500) throw new ProviderError('minimax', message, true);
  throw new ProviderError('minimax', message, false);
}

export const minimaxProvider: LLMProvider = {
  id: 'minimax',
  displayName: 'MiniMax',

  async listModels(_creds: ResolvedCredentials): Promise<ModelInfo[]> {
    // Return the full model catalogue. MiniMax doesn't expose a list endpoint,
    // so we hardcode the known text models and let validation catch retired ones.
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
    const messages = req.system
      ? [{ role: 'system', content: req.system }, ...req.messages]
      : req.messages;

    let res;
    try {
      // Anthropic-compatible endpoint for Token Plan keys
      // See: https://platform.minimaxi.com/docs/token-plan/quickstart
      res = await fetch('https://api.minimax.io/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': creds.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: req.model,
          messages,
          stream: true,
          max_tokens: req.maxTokens ?? 4096,
        }),
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
    let truncated = false;

    const { readable, writable } = new TransformStream<ChatChunk, ChatChunk>();
    const writer = writable.getWriter();

    const parser = createParser({
      onEvent(event) {
        if (event.data === '[DONE]') return;
        try {
          const parsed = JSON.parse(event.data) as {
            type?: string;
            delta?: { type?: string; text?: string; thinking?: string };
            usage?: { input_tokens?: number; output_tokens?: number };
            stop_reason?: string;
          };
          if (parsed.type === 'message_delta') {
            if (parsed.usage) {
              usage.inputTokens = parsed.usage.input_tokens ?? 0;
              usage.outputTokens = parsed.usage.output_tokens ?? 0;
            }
            if (parsed.stop_reason === 'max_tokens') {
              truncated = true;
            }
          }
          if (parsed.delta?.type === 'thinking_delta' && parsed.delta.thinking) {
            writer.write({ type: 'thinking', text: parsed.delta.thinking }).catch(() => {});
          }
          const delta = parsed.delta?.text;
          if (delta) {
            writer.write({ type: 'delta', text: delta }).catch(() => {});
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
        await writer.write({ type: 'done', usage, truncated });
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
    const pricing = MINIMAX_PRICING[model];
    if (!pricing) return 0;
    const inputCost = (usage.inputTokens / 1000) * pricing.input;
    const outputCost = (usage.outputTokens / 1000) * pricing.output;
    return inputCost + outputCost;
  },
};