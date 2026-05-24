import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getObjectStore } from '../../storage/index.js';
import { pageKey } from './layout.js';

const BASE_DIR = join(tmpdir(), 'sage-wiki');

interface CachedPage {
  body: string;
  dirty: boolean;
  userId: string;
  path: string;
}

export interface TurnCache {
  getOrFetchPage(userId: string, path: string): Promise<string | null>;
  markDirty(userId: string, path: string, body: string): void;
  flushDirty(): Promise<void>;
  cleanup(): Promise<void>;
}

export function createTurnCache(conversationId: string, turnId: string): TurnCache {
  const cacheDir = join(BASE_DIR, conversationId, turnId);
  const pages = new Map<string, CachedPage>();
  let initialized = false;

  async function ensureDir(): Promise<void> {
    if (!initialized) {
      await fs.mkdir(cacheDir, { recursive: true });
      initialized = true;
    }
  }

  function localPath(userId: string, path: string): string {
    const safe = path.replace(/\//g, '__');
    return join(cacheDir, `${userId}__${safe}`);
  }

  return {
    async getOrFetchPage(userId: string, path: string): Promise<string | null> {
      const cacheKey = `${userId}:${path}`;
      const cached = pages.get(cacheKey);
      if (cached) return cached.body;

      await ensureDir();
      const file = localPath(userId, path);

      try {
        const body = await fs.readFile(file, 'utf-8');
        pages.set(cacheKey, { body, dirty: false, userId, path });
        return body;
      } catch {
        // not on disk — fetch from R2
      }

      const store = getObjectStore();
      const key = pageKey(userId, path);
      let buffer: Buffer;
      try {
        buffer = await store.get(key);
      } catch {
        return null;
      }

      const body = buffer.toString('utf-8');
      await fs.writeFile(file, body, 'utf-8');
      pages.set(cacheKey, { body, dirty: false, userId, path });
      return body;
    },

    markDirty(userId: string, path: string, body: string): void {
      const cacheKey = `${userId}:${path}`;
      pages.set(cacheKey, { body, dirty: true, userId, path });
    },

    async flushDirty(): Promise<void> {
      const store = getObjectStore();
      for (const [, page] of pages) {
        if (!page.dirty) continue;
        const key = pageKey(page.userId, page.path);
        await store.put(key, Buffer.from(page.body, 'utf-8'));
        page.dirty = false;
      }
    },

    async cleanup(): Promise<void> {
      await fs.rm(cacheDir, { recursive: true, force: true });
      pages.clear();
    },
  };
}

export async function cleanupStaleCacheDirs(maxAgeMs = 60 * 60 * 1000): Promise<void> {
  let entries: string[];
  try {
    const convDirs = await fs.readdir(BASE_DIR);
    entries = [];
    for (const conv of convDirs) {
      const convPath = join(BASE_DIR, conv);
      const turnDirs = await fs.readdir(convPath).catch(() => [] as string[]);
      for (const turn of turnDirs) {
        entries.push(join(convPath, turn));
      }
    }
  } catch {
    return;
  }

  const cutoff = Date.now() - maxAgeMs;
  for (const dir of entries) {
    try {
      const stat = await fs.stat(dir);
      if (stat.mtimeMs < cutoff) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}
