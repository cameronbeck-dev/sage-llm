import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ObjectStore } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = path.join(__dirname, '..', '..', '..', 'var', 'storage');
const BASE = path.resolve(BASE_DIR);

function safeResolve(key: string): string {
  const p = path.resolve(BASE, key);
  if (p !== BASE && !p.startsWith(BASE + path.sep)) {
    throw new Error('Invalid storage key');
  }
  return p;
}

export class LocalDiskStore implements ObjectStore {
  private async keyPath(key: string): Promise<string> {
    const p = safeResolve(key);
    await mkdir(dirname(p), { recursive: true });
    return p;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = await this.keyPath(key);
    await writeFile(p, data);
  }

  async get(key: string): Promise<Buffer> {
    const p = await this.keyPath(key);
    return readFile(p);
  }

  async delete(key: string): Promise<void> {
    const p = await this.keyPath(key);
    await unlink(p);
  }

  // Dev-only: returns a file:// URL. Not suitable for production use.
  async getSignedUrl(key: string): Promise<string> {
    const p = await this.keyPath(key);
    return `file://${p}`;
  }
}
