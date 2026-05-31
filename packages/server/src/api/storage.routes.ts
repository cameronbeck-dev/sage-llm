import { Router } from "express"
import { getPool } from "../db/pool.js"
import { verifyStorageToken } from "../storage/PostgresStore.js"

export const storageRouter = Router()

storageRouter.get("/:key", async (req, res) => {
  const key = req.params.key
  const token = String(req.query.token ?? "")
  const expiresAt = Number(req.query.expires ?? 0)

  if (!key || !token || !expiresAt) {
    res.status(400).json({ error: "missing token or expiry" })
    return
  }

  if (!verifyStorageToken(key, expiresAt, token)) {
    res.status(403).json({ error: "invalid or expired token" })
    return
  }

  try {
    const pool = getPool()
    const result = await pool.query<{
      content: Buffer
      content_type: string | null
      size: string
    }>(
      `SELECT content, content_type, size
         FROM storage_blobs
        WHERE key = $1`,
      [key],
    )
    if (result.rowCount === 0) {
      res.status(404).json({ error: "not found" })
      return
    }
    const row = result.rows[0]
    res.setHeader("Content-Type", row.content_type ?? "application/octet-stream")
    res.setHeader("Content-Length", String(row.content.length))
    res.setHeader("Cache-Control", "private, max-age=0, no-store")
    res.end(row.content)
  } catch (err) {
    res.status(500).json({ error: "failed to read blob" })
  }
})
