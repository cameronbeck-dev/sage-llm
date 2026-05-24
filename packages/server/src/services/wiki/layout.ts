export function wikiKeyPrefix(userId: string): string {
  return `wiki/${userId}/`;
}

export function pageKey(userId: string, path: string): string {
  return `wiki/${userId}/${path}`;
}

export function versionKey(userId: string, pageId: string, versionId: string): string {
  return `wiki/${userId}/.versions/${pageId}/${versionId}.md`;
}

export function SCHEMA_KEY(userId: string): string {
  return `wiki/${userId}/SCHEMA.md`;
}

export function INDEX_KEY(userId: string): string {
  return `wiki/${userId}/index.md`;
}

export function LOG_KEY(userId: string): string {
  return `wiki/${userId}/log.md`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const PAGE_PATH_RE = /^(entities|concepts|comparisons|queries|raw)\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)\.md$/;

export interface ParsedPagePath {
  section: string;
  slug: string;
  ext: string;
}

export function validatePagePath(path: string): ParsedPagePath {
  const match = PAGE_PATH_RE.exec(path);
  if (!match) {
    throw new Error(
      `Invalid wiki page path: "${path}". Must match ^(entities|concepts|comparisons|queries|raw)/[a-z0-9-]+(/[a-z0-9-]+)*\\.md$`
    );
  }
  const [, section, slug] = match;
  return { section, slug, ext: '.md' };
}
