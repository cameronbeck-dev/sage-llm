import type { PoolClient } from 'pg';

const WINDOW_WORDS = 375;
const OVERLAP_WORDS = 60;
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.rb', '.swift']);

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function slidingWindow(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= WINDOW_WORDS) return [text.trim()];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + WINDOW_WORDS, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
    start += WINDOW_WORDS - OVERLAP_WORDS;
  }
  return chunks;
}

function chunkMarkdown(text: string): string[] {
  const sections = text.split(/(?=^#{1,6}\s)/m).filter(s => s.trim());
  if (sections.length <= 1) return slidingWindow(text);

  const chunks: string[] = [];
  for (const section of sections) {
    if (wordCount(section) <= WINDOW_WORDS) {
      chunks.push(section.trim());
    } else {
      chunks.push(...slidingWindow(section));
    }
  }
  return chunks.filter(Boolean);
}

function chunkCode(text: string): string[] {
  const sections = text.split(/(?=^(?:export\s+)?(?:function|class|const|let|var|def|fn|func|impl|pub\s+fn|pub\s+struct|interface|type)\s)/m).filter(s => s.trim());
  if (sections.length <= 1) return slidingWindow(text);

  const chunks: string[] = [];
  for (const section of sections) {
    if (wordCount(section) <= WINDOW_WORDS) {
      chunks.push(section.trim());
    } else {
      chunks.push(...slidingWindow(section));
    }
  }
  return chunks.filter(Boolean);
}

function chunkCsv(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length === 0) return [];
  const header = lines[0];
  const dataLines = lines.slice(1);
  const BATCH = 50;
  const chunks: string[] = [];
  for (let i = 0; i < dataLines.length; i += BATCH) {
    const batch = dataLines.slice(i, i + BATCH).filter(l => l.trim());
    if (batch.length > 0) {
      chunks.push([header, ...batch].join('\n'));
    }
  }
  return chunks;
}

function chunkJson(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return slidingWindow(text);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return slidingWindow(text);
  }
  const obj = parsed as Record<string, unknown>;
  const chunks: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null) {
      const serialized = `${key}:\n${JSON.stringify(value, null, 2)}`;
      if (wordCount(serialized) <= WINDOW_WORDS) {
        chunks.push(serialized);
      } else {
        chunks.push(...slidingWindow(serialized));
      }
    } else {
      chunks.push(`${key}: ${String(value)}`);
    }
  }
  return chunks.filter(c => c.trim());
}

export function chunkText(text: string, mimeType: string, filename: string): string[] {
  if (!text || !text.trim()) return [];

  const lowerName = filename.toLowerCase();
  const dotIdx = lowerName.lastIndexOf('.');
  const ext = dotIdx >= 0 ? lowerName.slice(dotIdx) : '';

  if (ext === '.md') return chunkMarkdown(text);
  if (CODE_EXTENSIONS.has(ext)) return chunkCode(text);
  if (ext === '.csv' || mimeType === 'text/csv') return chunkCsv(text);
  if (ext === '.json' || mimeType === 'application/json') return chunkJson(text);

  return slidingWindow(text);
}

export async function insertChunks(
  client: PoolClient,
  fileId: string,
  packId: string,
  chunks: string[]
): Promise<void> {
  if (chunks.length === 0) return;

  const rows: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  for (let i = 0; i < chunks.length; i++) {
    const tokenCount = Math.round(wordCount(chunks[i]) / 0.75);
    rows.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    values.push(fileId, packId, i, chunks[i], tokenCount);
  }

  await client.query(
    `INSERT INTO knowledge_chunks (file_id, pack_id, chunk_index, text, token_count)
     VALUES ${rows.join(', ')}`,
    values
  );
}
