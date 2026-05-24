export type SSEChunk =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'done'; usage?: { inputTokens: number; outputTokens: number }; truncated?: boolean; costUsd?: number }
  | { type: 'error'; error: string; costUsd?: number }
  | { type: 'whisper'; whisperText: string }
  | { type: 'title'; title: string }
  | { type: 'response_complete'; costUsd?: number }
  | { type: 'extraction_progress'; stage: 'started' | 'destinations_known' | 'destination_complete' | 'finished'; label?: string; indicators?: Array<{ id: string; label: string }>; completedId?: string }
  | { type: 'tool_call_started'; id: string; name: string; input: unknown }
  | { type: 'tool_call_result'; id: string; name: string; result: unknown }
  | { type: 'tool_call_error'; id: string; name: string; error: string };
