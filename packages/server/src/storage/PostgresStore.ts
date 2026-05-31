import { Readable } from "node:stream"
import { createHmac, timingSafeEqual } from "node:crypto"
import type { Pool } from "pg"
import type { ObjectStore } from "./types.js"
import { getPool } from "../db/pool.js"
import { config } from "../config.js"

export class PostgresStore implements ObjectStore {
  constructor(private readonly pool: Pool = getPool()) {}

  async put(key: string, data: Buffer): Promise<void> {
    await this.pool.query(
      `INSERT INTO storage_blobs (key, content, content_type, size)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE
         SET content      = EXCLUDED.content,
             content_type = EXCLUDED.content_type,
             size         = EXCLUDED.size,
             created_at   = now()`,
      [key, data, null, data.length],
    )
  }

  async putStream(key: string, stream: Readable, contentLength: number): Promise<void> {
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      chunks.push(buf)
      total += buf.length
      if (contentLength > 0 && total > contentLength) {
        throw new Error(`PostgresStore.putStream: stream exceeded declared contentLength (${contentLength})`)
      }
    }
    const data = Buffer.concat(chunks, total)
    await this.put(key, data)
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.pool.query<{ content: Buffer }>(
      `SELECT content FROM storage_blobs WHERE key = $1`,
      [key],
    )
    if (res.rowCount === 0) {
      throw new Error(`PostgresStore.get: key not found: ${key}`)
    }
    return res.rows[0].content
  }

  async delete(key: string): Promise<void> {
    await this.pool.query(`DELETE FROM storage_blobs WHERE key = $1`, [key])
  }

  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds
    const token = signStorageToken(key, expiresAt)
    const encodedKey = encodeURIComponent(key)
    return `/api/storage/${encodedKey}?token=${token}&expires=${expiresAt}`
  }
}

export function signStorageToken(key: string, expiresAt: number): string {
  const h = createHmac("sha256", config.SAGE_ENC_KEY ?? "")
  h.update(`${key}.${expiresAt}`)
  return h.digest("hex")
}

export function verifyStorageToken(key: string, expiresAt: number, token: string): boolean {
  if (!Number.isFinite(expiresAt)) return false
  if (Math.floor(Date.now() / 1000) > expiresAt) return false
  const expected = signStorageToken(key, expiresAt)
  const a = Buffer.from(expected, "hex")
  const b = Buffer.from(token, "hex")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
