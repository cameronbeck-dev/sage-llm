export type Role = 'user' | 'assistant' | 'system' | 'whisper';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  content: ContentBlock[];
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  createdAt: string;
  thinking?: string;
}
