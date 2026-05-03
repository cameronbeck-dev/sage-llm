import type { ModelInfo } from '@sage/shared';

export interface ResolvedCredentials {
  apiKey: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatChunk {
  type: 'delta' | 'thinking' | 'done' | 'error';
  text?: string;
  usage?: Usage;
  error?: string;
  truncated?: boolean;
}

export interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  system?: string;
  maxTokens?: number;
}

export interface LLMProvider {
  readonly id: string;
  readonly displayName: string;
  listModels(creds: ResolvedCredentials): Promise<ModelInfo[]>;
  chatStream(req: ChatRequest, creds: ResolvedCredentials): AsyncIterable<ChatChunk>;
  estimateCost?(model: string, usage: Usage): number;
}
