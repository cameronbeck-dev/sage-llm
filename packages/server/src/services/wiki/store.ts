import { createHash, randomUUID } from 'node:crypto';
import { getPool } from '../../db/pool.js';
import { getObjectStore } from '../../storage/index.js';
import { pageKey, versionKey } from './layout.js';
import { parseFrontmatter, extractWikilinks, extractProvenance, replaceWikilinks } from './markdown.js';
import { emit } from './events.js';

export class ContentHashMismatchError extends Error {
  constructor(public storedHash: string, public storedBody: string, public requestedHash: string) {
    super('Content hash mismatch — page has changed since you read it');
    this.name = 'ContentHashMismatchError';
  }
}

export class RenameInProgressError extends Error {
  constructor(public path: string) {
    super(`Rename already in progress for ${path}`);
    this.name = 'RenameInProgressError';
  }
}

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
  expectedContentHash,
}: {
  userId: string;
  path: string;
  body: string;
  author: 'llm' | 'user' | 'migration';
  reason?: string;
  expectedContentHash?: string;
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

  if (expectedContentHash !== undefined) {
    if (!existingRow || existingRow.deleted_at !== null) {
      throw new ContentHashMismatchError('', '', expectedContentHash);
    }
    if (existingRow.content_hash !== expectedContentHash) {
      const storedBuf = await store.get(existingRow.r2_key);
      const storedBody = storedBuf.toString('utf-8');
      throw new ContentHashMismatchError(existingRow.content_hash, storedBody, expectedContentHash);
    }
  }

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
  const { rows } = await pool.query<{ id: string; r2_key: string }>(
    `UPDATE wiki_pages SET deleted_at = now()
     WHERE user_id = $1 AND path = $2 AND deleted_at IS NULL
     RETURNING id, r2_key`,
    [userId, path]
  );
  if (rows.length === 0) return;

  const { id: pageId, r2_key } = rows[0];
  await pool.query(
    `INSERT INTO wiki_log (user_id, op, page_id, actor) VALUES ($1, 'delete', $2, 'user')`,
    [userId, pageId]
  );

  await getObjectStore().delete(r2_key).catch(() => {});
  // Version blobs intentionally retained for soft-delete resurrection: writePage can
  // revive a deleted page via ON CONFLICT DO UPDATE, and existing wiki_page_versions
  // rows must remain readable after resurrection.

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
  opts: { limit?: number; before?: string; pageId?: string } = {}
): Promise<WikiLogEntry[]> {
  const pool = getPool();
  const { limit = 50, before, pageId } = opts;
  const params: unknown[] = [userId];
  const conditions: string[] = ['user_id = $1'];

  if (before) {
    params.push(before);
    conditions.push(`id < $${params.length}`);
  }

  if (pageId) {
    params.push(pageId);
    conditions.push(`page_id = $${params.length}`);
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

export async function readVersion(
  userId: string,
  pageId: string,
  versionId: string
): Promise<{ body: string; contentHash: string; author: string; reason: string | null; createdAt: Date } | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string; content_hash: string; r2_key: string; author: string; reason: string | null; created_at: Date;
  }>(
    `SELECT wpv.id, wpv.content_hash, wpv.r2_key, wpv.author, wpv.reason, wpv.created_at
     FROM wiki_page_versions wpv
     JOIN wiki_pages wp ON wp.id = wpv.page_id
     WHERE wpv.id = $1 AND wpv.page_id = $2 AND wp.user_id = $3`,
    [versionId, pageId, userId]
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  const store = getObjectStore();
  const buffer = await store.get(row.r2_key);
  const body = buffer.toString('utf-8');

  return {
    body,
    contentHash: row.content_hash,
    author: row.author,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export async function listVersions(
  userId: string,
  path: string
): Promise<Array<{ id: string; contentHash: string; author: string; reason: string | null; createdAt: Date }>> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string; content_hash: string; author: string; reason: string | null; created_at: Date;
  }>(
    `SELECT wpv.id, wpv.content_hash, wpv.author, wpv.reason, wpv.created_at
     FROM wiki_page_versions wpv
     JOIN wiki_pages wp ON wp.id = wpv.page_id
     WHERE wp.user_id = $1 AND wp.path = $2 AND wp.deleted_at IS NULL
     ORDER BY wpv.created_at DESC
     LIMIT 50`,
    [userId, path]
  );
  return rows.map(r => ({
    id: r.id,
    contentHash: r.content_hash,
    author: r.author,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

export async function getPageIdByPath(userId: string, path: string): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM wiki_pages WHERE user_id = $1 AND path = $2 AND deleted_at IS NULL`,
    [userId, path]
  );
  return rows.length > 0 ? rows[0].id : null;
}

export async function renamePage(userId: string, oldPath: string, newPath: string): Promise<void> {
  const pool = getPool();
  const store = getObjectStore();

  const { rows: oldRows } = await pool.query<{
    id: string; r2_key: string; content_hash: string; rename_in_progress: boolean;
  }>(
    `SELECT id, r2_key, content_hash, rename_in_progress FROM wiki_pages WHERE user_id = $1 AND path = $2 AND deleted_at IS NULL`,
    [userId, oldPath]
  );
  if (oldRows.length === 0) {
    const err = new Error('Page not found');
    (err as NodeJS.ErrnoException).code = 'NOT_FOUND';
    throw err;
  }
  const oldRow = oldRows[0];
  if (oldRow.rename_in_progress) {
    throw new RenameInProgressError(oldPath);
  }
  const oldPageId = oldRow.id;

  const { rows: conflictRows } = await pool.query<{ id: string }>(
    `SELECT id FROM wiki_pages WHERE user_id = $1 AND path = $2 AND deleted_at IS NULL`,
    [userId, newPath]
  );
  if (conflictRows.length > 0) {
    const err = new Error('A page already exists at the new path');
    (err as NodeJS.ErrnoException).code = 'CONFLICT';
    throw err;
  }

  const newR2Key = pageKey(userId, newPath);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE wiki_pages SET rename_in_progress = true WHERE id = $1`,
      [oldPageId]
    );
    await client.query(
      `UPDATE wiki_pages SET path = $1, r2_key = $2, updated_at = now() WHERE id = $3`,
      [newPath, newR2Key, oldPageId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    throw err;
  }
  client.release();

  const oldBody = await store.get(oldRow.r2_key);
  await store.put(newR2Key, oldBody);
  await store.delete(oldRow.r2_key);

  const { rows: inboundRows } = await pool.query<{ source_page_id: string; r2_key: string }>(
    `SELECT DISTINCT wl.source_page_id, wp.r2_key
     FROM wiki_links wl
     JOIN wiki_pages wp ON wp.id = wl.source_page_id
     WHERE wl.target_path = $1 AND wp.user_id = $2`,
    [oldPath, userId]
  );

  for (const inbound of inboundRows) {
    const sourceBuf = await store.get(inbound.r2_key);
    const sourceBody = sourceBuf.toString('utf-8');
    const rewritten = replaceWikilinks(sourceBody, oldPath, newPath);
    await store.put(inbound.r2_key, Buffer.from(rewritten, 'utf-8'));
    await pool.query(
      `UPDATE wiki_links SET target_path = $1 WHERE source_page_id = $2 AND target_path = $3`,
      [newPath, inbound.source_page_id, oldPath]
    );
  }

  await pool.query(
    `INSERT INTO wiki_log (user_id, op, page_id, summary, actor)
     VALUES ($1, 'rename', $2, $3, 'user')`,
    [userId, oldPageId, `renamed ${oldPath} -> ${newPath}`]
  );

  await pool.query(
    `UPDATE wiki_pages SET rename_in_progress = false WHERE id = $1`,
    [oldPageId]
  );

  emit({ kind: 'rename', userId, pageId: oldPageId, path: newPath, oldPath });
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
