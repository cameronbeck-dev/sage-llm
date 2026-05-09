import type { LLMProvider } from './types.js';
import { openaiProvider } from './openai.js';
import { minimaxProvider } from './minimax.js';
import { anthropicProvider } from './anthropic.js';

const registry = new Map<string, LLMProvider>();

function registerProvider(provider: LLMProvider): void {
  registry.set(provider.id, provider);
}

registerProvider(openaiProvider);
registerProvider(minimaxProvider);
registerProvider(anthropicProvider);

export function getProvider(id: string): LLMProvider {
  const provider = registry.get(id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

export function listProviders(): LLMProvider[] {
  return Array.from(registry.values());
}
