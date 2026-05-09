import AdmZip from 'adm-zip';

export interface ParsedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
}

export interface ParsedConversation {
  title: string;
  createdAt: Date;
  messages: ParsedMessage[];
}

export interface ParsedImport {
  source: 'chatgpt' | 'claude' | 'generic';
  conversations: ParsedConversation[];
  skipped: number;
  errors: string[];
}

export function parseChatGPTExport(buffer: Buffer): ParsedImport {
  const skipped = { count: 0 };
  const errors: string[] = [];
  const conversations: ParsedConversation[] = [];

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch (err) {
    return { source: 'chatgpt', conversations: [], skipped: 0, errors: [`Failed to read ZIP: ${(err as Error).message}`] };
  }

  const entry = zip.getEntry('conversations.json');
  if (!entry) {
    return { source: 'chatgpt', conversations: [], skipped: 0, errors: ['conversations.json not found in ZIP'] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(entry.getData().toString('utf-8'));
  } catch (err) {
    return { source: 'chatgpt', conversations: [], skipped: 0, errors: [`Failed to parse conversations.json: ${(err as Error).message}`] };
  }

  if (!Array.isArray(raw)) {
    return { source: 'chatgpt', conversations: [], skipped: 0, errors: ['conversations.json is not an array'] };
  }

  for (const conv of raw) {
    try {
      const c = conv as {
        id: string;
        title: string;
        create_time: number;
        mapping: Record<string, {
          id: string;
          parent: string | null;
          children: string[];
          message: {
            id: string;
            author: { role: string } | null;
            content: { parts: unknown[] } | null;
            create_time: number | null;
          } | null;
        }>;
      };

      const mapping = c.mapping ?? {};

      const rootId = Object.keys(mapping).find((k) => mapping[k].parent === null || mapping[k].parent === undefined);
      if (!rootId) {
        skipped.count++;
        continue;
      }

      const ordered: typeof mapping[string][] = [];
      const visited = new Set<string>();
      function walk(nodeId: string) {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        const node = mapping[nodeId];
        if (!node) return;
        if (node.message) ordered.push(node);
        const children = (node.children ?? []).slice().sort((a, b) => {
          const ta = mapping[a]?.message?.create_time ?? 0;
          const tb = mapping[b]?.message?.create_time ?? 0;
          return ta - tb;
        });
        for (const child of children) walk(child);
      }
      walk(rootId);

      const messages: ParsedMessage[] = [];
      for (const node of ordered) {
        const msg = node.message;
        if (!msg) continue;
        const role = msg.author?.role;
        if (!role || !['user', 'assistant', 'system'].includes(role)) continue;
        const parts = msg.content?.parts;
        if (!Array.isArray(parts)) { skipped.count++; continue; }
        const textParts = parts.filter((p): p is string => typeof p === 'string');
        if (textParts.length === 0) { skipped.count++; continue; }
        const content = textParts.join('');
        if (!content.trim()) { skipped.count++; continue; }
        messages.push({
          role: role as 'user' | 'assistant' | 'system',
          content,
          createdAt: msg.create_time ? new Date(msg.create_time * 1000) : new Date(),
        });
      }

      if (messages.length === 0) { skipped.count++; continue; }

      conversations.push({
        title: c.title || 'Untitled',
        createdAt: c.create_time ? new Date(c.create_time * 1000) : new Date(),
        messages,
      });
    } catch (err) {
      errors.push(`Conversation parse error: ${(err as Error).message}`);
      skipped.count++;
    }
  }

  return { source: 'chatgpt', conversations, skipped: skipped.count, errors };
}

export function parseClaudeExport(buffer: Buffer): ParsedImport {
  const text = buffer.toString('utf-8');
  const lines = text.split('\n').filter((l) => l.trim());
  const conversations: ParsedConversation[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const line of lines) {
    try {
      const conv = JSON.parse(line) as {
        name: string;
        created_at: string;
        chat_messages: Array<{
          sender: 'human' | 'assistant';
          text?: string;
          content?: unknown;
        }>;
      };

      const messages: ParsedMessage[] = [];
      for (const m of conv.chat_messages ?? []) {
        const role: 'user' | 'assistant' = m.sender === 'human' ? 'user' : 'assistant';
        const content = typeof m.text === 'string' ? m.text : JSON.stringify(m.content ?? '');
        if (!content.trim()) { skipped++; continue; }
        messages.push({ role, content, createdAt: new Date(conv.created_at) });
      }

      if (messages.length === 0) { skipped++; continue; }

      conversations.push({
        title: conv.name || 'Untitled',
        createdAt: new Date(conv.created_at),
        messages,
      });
    } catch (err) {
      errors.push(`Line parse error: ${(err as Error).message}`);
      skipped++;
    }
  }

  return { source: 'claude', conversations, skipped, errors };
}

export function parseGenericJson(_buffer: Buffer): ParsedImport {
  return {
    source: 'generic',
    conversations: [],
    skipped: 0,
    errors: ['Generic JSON import is not yet supported.'],
  };
}

export function parseImport(buffer: Buffer, filename: string, source: 'chatgpt' | 'claude' | 'generic'): ParsedImport {
  if (source === 'chatgpt') return parseChatGPTExport(buffer);
  if (source === 'claude') return parseClaudeExport(buffer);
  return parseGenericJson(buffer);
}
