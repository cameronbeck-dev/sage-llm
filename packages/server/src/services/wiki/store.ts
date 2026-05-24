import { createHash, randomUUID } from 'node:crypto';
import { getPool } from '../../db/pool.js';
import { getObjectStore } from '../../storage/index.js';
import { pageKey, versionKey } from './layout.js';
import { parseFrontmatter, extractWikilinks, extractProvenance } from './markdown.js';
import { emit } from './events.js';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

export interface WikiPageMeta {
  pageId: string;
  userId: string;
  path: string;
  title: string | null;
  type: string | null;
  tags: string[];
  frontmatter: Record<string, unknown>;
  contentHash: string;
  r2Key: string;
  renameInProgress: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReadPageResult {
  frontmatter: Record<string, unknown>;
  body: string;
  contentHash: string;
  pageId: string;
  versionId: string | null;
  updatedAt: string;
}

export interface WritePageResult {
  noop: boolean;
  pageId: string;
  versionId: string | null;
  contentHash: string;
}

export interface ListPagesOptions {
  type?: string;
  tag?: string;
  pathPrefix?: string;
  limit?: number;
  offset?: number;
}

export interface WikiLogEntry {
  id: string;
  userId: string;
  op: string;
  pageId: string | null;
  summary: string | null;
  actor: string;
  createdAt: string;
}

export interface WikiLink {
  id: string;
  sourcePageId: string;
  targetPath: string;
  targetPageId: string | null;
  kind: string;
  createdAt: string;
}

export async function readPage(userId: string, path: string): Promise<ReadPageResult | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string; content_hash: string; r2_key: string; updated_at: Date; deleted_at: Date | null;
  }>(
    `SELECT id, content_hash, r2_key, updated_at, deleted_at
     FROM wiki_pages
     WHERE user_id = $1 AND path = $2`,
    [userId, path]
  );
  if (rows.length === 0 || rows[0].deleted_at !== null) return null;

  const row = rows[0];
  const store = getObjectStore();
  const buffer = await store.get(row.r2_key);
  const rawBody = buffer.toString('utf-8');
  const { frontmatter, content } = parseFrontmatter(rawBody);

  const { rows: vrows } = await pool.query<{ id: string }>(
    `SELECT id FROM wiki_page_versions
     WHERE page_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [row.id]
  );

  return {
    frontmatter,
    body: content,
    contentHash: row.content_hash,
    pageId: row.id,
    versionId: vrows.length > 0 ? vrows[0].id : null,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function writePage({
  userId,
  path,
  body,
  author,
  reason,
}: {
  userId: string;
  path: string;
  body: string;
  author: 'llm' | 'user' | 'migration';
  reason?: string;
}): Promise<WritePageResult> {
  const pool = getPool();
  const store = getObjectStore();
  const contentHash = sha256(body);

  const { frontmatter } = parseFrontmatter(body);
  const title = (frontmatter['title'] as string | undefined) ?? null;
  const type = (frontmatter['type'] as string | undefined) ?? null;
  const tags = Array.isArray(frontmatter['tags'])
    ? (frontmatter['tags'] as string[])
    : [];

  const { rows: existing } = await pool.query<{
    id: string; content_hash: string; r2_key: string; deleted_at: Date | null;
  }>(
    `SELECT id, content_hash, r2_key, deleted_at FROM wiki_pages WHERE user_id = $1 AND path = $2`,
    [userId, path]
  );

  const isNew = existing.length === 0 || existing[0].deleted_at !== null;
  const existingRow = existing.length > 0 ? existing[0] : null;

  if (existingRow && existingRow.deleted_at === null && existingRow.content_hash === contentHash) {
    const { rows: vrows } = await pool.query<{ id: string }>(
      `SELECT id FROM wiki_page_versions WHERE page_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [existingRow.id]
    );
    return {
      noop: true,
      pageId: existingRow.id,
      versionId: vrows.length > 0 ? vrows[0].id : null,
      contentHash,
    };
  }

  const r2Key = pageKey(userId, path);

  let priorBody: Buffer | null = null;
  if (existingRow && existingRow.deleted_at === null) {
    priorBody = await store.get(existingRow.r2_key);
  }

  const client = await pool.connect();
  let pageId: string;
  let versionId: string | null = null;

  try {
    await client.query('BEGIN');

    if (existingRow && existingRow.deleted_at === null) {
      const versionUuid = randomUUID();
      const priorVersionKey = versionKey(userId, existingRow.id, versionUuid);

      await store.put(priorVersionKey, priorBody!);
      await store.put(r2Key, Buffer.from(body, 'utf-8'));

      const { rows: vrows } = await client.query<{ id: string }>(
        `INSERT INTO wiki_page_versions (id, page_id, content_hash, r2_key, author, reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [versionUuid, existingRow.id, existingRow.content_hash, priorVersionKey, author, reason ?? null]
      );
      versionId = vrows[0].id;

      await client.query(
        `UPDATE wiki_pages
         SET title = $1, type = $2, tags = $3, frontmatter = $4,
             content_hash = $5, r2_key = $6, updated_at = now(), deleted_at = NULL
         WHERE id = $7`,
        [title, type, tags, JSON.stringify(frontmatter), contentHash, r2Key, existingRow.id]
      );
      pageId = existingRow.id;
    } else {
      await store.put(r2Key, Buffer.from(body, 'utf-8'));
      const { rows: prows } = await client.query<{ id: string }>(
        `INSERT INTO wiki_pages
           (user_id, path, title, type, tags, frontmatter, content_hash, r2_key, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
         ON CONFLICT (user_id, path) DO UPDATE
           SET title = EXCLUDED.title, type = EXCLUDED.type, tags = EXCLUDED.tags,
               frontmatter = EXCLUDED.frontmatter, content_hash = EXCLUDED.content_hash,
               r2_key = EXCLUDED.r2_key, updated_at = now(), deleted_at = NULL
         RETURNING id`,
        [userId, path, title, type, tags, JSON.stringify(frontmatter), contentHash, r2Key]
      );
      pageId = prows[0].id;
    }

    const wikilinks = extractWikilinks(body);
    const provenance = extractProvenance(body);

    await client.query(`DELETE FROM wiki_links WHERE source_page_id = $1`, [pageId]);

    for (const targetPath of wikilinks) {
      const { rows: trows } = await client.query<{ id: string }>(
        `SELECT id FROM wiki_pages WHERE user_id = $1 AND path = $2 AND deleted_at IS NULL`,
        [userId, targetPath]
      );
      const targetPageId = trows.length > 0 ? trows[0].id : null;
      await client.query(
        `INSERT INTO wiki_links (source_page_id, target_path, target_page_id, kind)
         VALUES ($1, $2, $3, 'wikilink')`,
        [pageId, targetPath, targetPageId]
      );
    }

    for (const targetPath of provenance) {
      const { rows: trows } = await client.query<{ id: string }>(
        `SELECT id FROM wiki_pages WHERE user_id = $1 AND path = $2 AND deleted_at IS NULL`,
        [userId, targetPath]
      );
      const targetPageId = trows.length > 0 ? trows[0].id : null;
      await client.query(
        `INSERT INTO wiki_links (source_page_id, target_path, target_page_id, kind)
         VALUES ($1, $2, $3, 'provenance')`,
        [pageId, targetPath, targetPageId]
      );
    }

    const op = isNew ? 'create' : 'update';
    await client.query(
      `INSERT INTO wiki_log (user_id, op, page_id, summary, actor)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, op, pageId, reason ?? null, author]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  emit({
    kind: isNew ? 'page_created' : 'page_updated',
    userId,
    pageId,
    path,
    summary: reason,
  });

  return { noop: false, pageId, versionId, contentHash };
}

export async function deletePage(userId: string, path: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE wiki_pages SET deleted_at = now()
     WHERE user_id = $1 AND path = $2 AND deleted_at IS NULL
     RETURNING id`,
    [userId, path]
  );
  if (rows.length === 0) return;

  const pageId = rows[0].id;
  await pool.query(
    `INSERT INTO wiki_log (user_id, op, page_id, actor) VALUES ($1, 'delete', $2, 'user')`,
    [userId, pageId]
  );

  emit({ kind: 'page_deleted', userId, pageId, path });
}

export async function listPages(
  userId: string,
  opts: ListPagesOptions = {}
): Promise<WikiPageMeta[]> {
  const pool = getPool();
  const { type, tag, pathPrefix, limit = 50, offset = 0 } = opts;
  const params: unknown[] = [userId];
  const conditions: string[] = ['user_id = $1', 'deleted_at IS NULL'];

  if (type) {
    params.push(type);
    conditions.push(`type = $${params.length}`);
  }
  if (tag) {
    params.push(tag);
    conditions.push(`$${params.length} = ANY(tags)`);
  }
  if (pathPrefix) {
    params.push(`${pathPrefix}%`);
    conditions.push(`path LIKE $${params.length}`);
  }

  params.push(limit, offset);
  const { rows } = await pool.query<{
    id: string; user_id: string; path: string; title: string | null; type: string | null;
    tags: string[] | null; frontmatter: Record<string, unknown>; content_hash: string;
    r2_key: string; rename_in_progress: boolean; created_at: Date; updated_at: Date; deleted_at: Date | null;
  }>(
    `SELECT * FROM wiki_pages
     WHERE ${conditions.join(' AND ')}
     ORDER BY path ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return rows.map((r) => ({
    pageId: r.id,
    userId: r.user_id,
    path: r.path,
    title: r.title,
    type: r.type,
    tags: r.tags ?? [],
    frontmatter: r.frontmatter,
    contentHash: r.content_hash,
    r2Key: r.r2_key,
    renameInProgress: r.rename_in_progress,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  }));
}

export async function getLog(
  userId: string,
  opts: { limit?: number; before?: string } = {}
): Promise<WikiLogEntry[]> {
  const pool = getPool();
  const { limit = 50, before } = opts;
  const params: unknown[] = [userId];
  const conditions: string[] = ['user_id = $1'];

  if (before) {
    params.push(before);
    conditions.push(`id < $${params.length}`);
  }

  params.push(limit);
  const { rows } = await pool.query<{
    id: string; user_id: string; op: string; page_id: string | null;
    summary: string | null; actor: string; created_at: Date;
  }>(
    `SELECT id, user_id, op, page_id, summary, actor, created_at
     FROM wiki_log
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return rows.map((r) => ({
    id: String(r.id),
    userId: r.user_id,
    op: r.op,
    pageId: r.page_id,
    summary: r.summary,
    actor: r.actor,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function getLinks(opts: {
  sourcePageId?: string;
  targetPath?: string;
}): Promise<WikiLink[]> {
  const pool = getPool();
  const { sourcePageId, targetPath } = opts;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (sourcePageId) {
    params.push(sourcePageId);
    conditions.push(`source_page_id = $${params.length}`);
  }
  if (targetPath) {
    params.push(targetPath);
    conditions.push(`target_path = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query<{
    id: string; source_page_id: string; target_path: string;
    target_page_id: string | null; kind: string; created_at: Date;
  }>(
    `SELECT id, source_page_id, target_path, target_page_id, kind, created_at
     FROM wiki_links
     ${where}
     ORDER BY created_at DESC`,
    params
  );

  return rows.map((r) => ({
    id: r.id,
    sourcePageId: r.source_page_id,
    targetPath: r.target_path,
    targetPageId: r.target_page_id,
    kind: r.kind,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function autocompletePaths(
  userId: string,
  q: string,
  limit = 10
): Promise<WikiPageMeta[]> {
  const pool = getPool();
  const pattern = `%${q}%`;
  const { rows } = await pool.query<{
    id: string; user_id: string; path: string; title: string | null; type: string | null;
    tags: string[] | null; frontmatter: Record<string, unknown>; content_hash: string;
    r2_key: string; rename_in_progress: boolean; created_at: Date; updated_at: Date; deleted_at: Date | null;
  }>(
    `SELECT * FROM wiki_pages
     WHERE user_id = $1
       AND deleted_at IS NULL
       AND (title ILIKE $2 OR path ILIKE $2)
     ORDER BY length(path) ASC
     LIMIT $3`,
    [userId, pattern, limit]
  );

  return rows.map((r) => ({
    pageId: r.id,
    userId: r.user_id,
    path: r.path,
    title: r.title,
    type: r.type,
    tags: r.tags ?? [],
    frontmatter: r.frontmatter,
    contentHash: r.content_hash,
    r2Key: r.r2_key,
    renameInProgress: r.rename_in_progress,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  }));
}
