import { getPool } from '../db/pool.js';

export type AuditEvent =
  | 'credential_created'
  | 'credential_updated'
  | 'credential_deleted'
  | 'credential_validation_failed';

export interface AuditEntry {
  userId: string | null;
  event: AuditEvent;
  resource: string;
  success: boolean;
  errorMsg?: string;
  ipAddress?: string;
  userAgent?: string;
}

interface QueuedEntry {
  entry: AuditEntry;
  resolve: () => void;
}

/**
 * Audit logger with async non-blocking writes.
 * Uses an in-memory queue drained by a background worker to avoid
 * adding latency to credential operations.
 */
class AuditLogger {
  private queue: QueuedEntry[] = [];
  private draining = false;

  /** Enqueue an audit event (non-blocking). */
  log(entry: AuditEntry): void {
    this.queue.push({
      entry,
      resolve: () => {},
    });
    this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.queue.length === 0) return;
    this.draining = true;

    // Batch opportunistically
    const batch: QueuedEntry[] = [];
    while (this.queue.length > 0) {
      batch.push(this.queue.shift()!);
    }

    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO audit_logs (user_id, event, resource, success, error_msg, ip_address, user_agent)
         SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::boolean[], $5::text[], $6::inet[], $7::text[])`,
        [
          batch.map((b) => (b.entry.userId ? b.entry.userId : null)),
          batch.map((b) => b.entry.event),
          batch.map((b) => b.entry.resource),
          batch.map((b) => b.entry.success),
          batch.map((b) => b.entry.errorMsg ?? null),
          batch.map((b) => (b.entry.ipAddress ? b.entry.ipAddress : null)),
          batch.map((b) => b.entry.userAgent ?? null),
        ]
      );
    } catch (err) {
      // Audit failures must never break credential operations.
      // Log to server stderr for visibility but swallow.
      console.error('[audit] failed to write audit log:', err);
    } finally {
      this.draining = false;
      if (this.queue.length > 0) {
        // Something got queued while we were writing; drain again.
        setImmediate(() => this.drain());
      }
    }
  }
}

// Singleton
export const auditLogger = new AuditLogger();

/** Fire-and-forget audit entry. */
export function logAudit(entry: AuditEntry): void {
  auditLogger.log(entry);
}