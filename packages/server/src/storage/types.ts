import type { Readable } from 'node:stream';

export interface ObjectStore {
  put(key: string, data: Buffer): Promise<void>;
  putStream(key: string, stream: Readable, contentLength: number): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}
