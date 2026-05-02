// Phase 1: Provider registry — getProvider(id)
import type { LLMProvider } from './types.js';

const registry = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  registry.set(provider.id, provider);
}

export function getProvider(id: string): LLMProvider {
  const provider = registry.get(id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

export function listProviders(): LLMProvider[] {
  return Array.from(registry.values());
}
