export type { SSEChunk } from '@sage/shared';
import type { SSEChunk } from '@sage/shared';

export async function* streamChat(
  conversationId: string,
  message: string,
  previousId?: string,
  signal?: AbortSignal,
  modelOverride?: { provider: string; model: string }
): AsyncIterable<SSEChunk> {
  const res = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, previousId, ...(modelOverride ?? {}) }),
    signal,
  });

  if (!res.ok || !res.body) {
    yield { type: 'error', error: `HTTP ${res.status}` };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const chunk = JSON.parse(json) as SSEChunk;
            yield chunk;
          } catch {
            // ignore malformed lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
