import type { ModelInfo, ContentBlock } from '@sage/shared';

export interface ResolvedCredentials {
  apiKey: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: object;
}

export type ChatChunk =
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'done'; usage: Usage; truncated?: boolean }
  | { type: 'error'; error: string }
  | { type: 'tool_call'; id: string; name?: string; inputJsonDelta?: string; complete?: boolean; input?: object };

export interface ChatRequest {
  model: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string | ContentBlock[] }>;
  system?: string;
  maxTokens?: number;
  tools?: ToolSchema[];
}

export interface LLMProvider {
  readonly id: string;
  readonly displayName: string;
  readonly supportsTools: boolean;
  listModels(creds: ResolvedCredentials): Promise<ModelInfo[]>;
  chatStream(req: ChatRequest, creds: ResolvedCredentials): AsyncIterable<ChatChunk>;
  estimateCost?(model: string, usage: Usage): number;
}
