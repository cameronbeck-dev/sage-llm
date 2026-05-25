export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  content: string;
}

function parseYamlValue(raw: string): unknown {
  const trimmed = raw.trim();

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;

  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '') return num;

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    if (inner.trim() === '') return [];
    return inner.split(',').map((s) => {
      const v = s.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        return v.slice(1, -1);
      }
      return v;
    });
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseSimpleYaml(yamlText: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yamlText.split('\n');
  let currentKey: string | null = null;
  const listAccumulator: string[] = [];

  for (const line of lines) {
    if (line.trim() === '') continue;

    const listItemMatch = /^  - (.+)$/.exec(line);
    if (listItemMatch && currentKey !== null) {
      listAccumulator.push(listItemMatch[1].trim());
      continue;
    }

    if (currentKey !== null && listAccumulator.length > 0) {
      result[currentKey] = [...listAccumulator];
      listAccumulator.length = 0;
      currentKey = null;
    }

    const keyValueMatch = /^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/.exec(line);
    if (!keyValueMatch) continue;

    const [, key, valueRaw] = keyValueMatch;
    const valueTrimmed = valueRaw.trim();

    if (valueTrimmed === '') {
      currentKey = key;
    } else {
      result[key] = parseYamlValue(valueTrimmed);
      currentKey = null;
    }
  }

  if (currentKey !== null && listAccumulator.length > 0) {
    result[currentKey] = [...listAccumulator];
  }

  return result;
}

export function parseFrontmatter(body: string): ParsedFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(body);
  if (!match) {
    return { frontmatter: {}, content: body };
  }
  const [, yamlText, content] = match;
  let frontmatter: Record<string, unknown> = {};
  try {
    frontmatter = parseSimpleYaml(yamlText);
  } catch {
    frontmatter = {};
  }
  return { frontmatter, content };
}

export function extractWikilinks(body: string): string[] {
  const seen = new Set<string>();
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    seen.add(m[1].trim());
  }
  return Array.from(seen);
}

export function replaceWikilinks(body: string, oldPath: string, newPath: string): string {
  const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\[\\[${escaped}(\\|[^\\]]+)?\\]\\]`, 'g');
  return body.replace(pattern, (_match, displayPart) => `[[${newPath}${displayPart ?? ''}]]`);
}

export function extractProvenance(body: string): string[] {
  const seen = new Set<string>();
  const re = /\^\[(raw\/[^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    seen.add(m[1].trim());
  }
  return Array.from(seen);
}
