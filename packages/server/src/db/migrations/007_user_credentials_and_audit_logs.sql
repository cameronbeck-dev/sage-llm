-- Migration 007: Per-user encrypted credentials + immutable audit logs
-- Credentials: AES-256-GCM encrypted at rest, validated against real providers before store
-- Audit: Full immutable log of all credential operations, no plaintext secrets ever logged

BEGIN;

-- ─── User Credentials Table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_credentials (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT        NOT NULL,  -- 'openai' | 'minimax'
  encrypted   JSONB       NOT NULL, -- EncryptedEnvelope (version/iv/tag/ciphertext)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);

-- ─── Audit Logs Table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  event       TEXT        NOT NULL,  -- 'credential_created' | 'credential_updated' | 'credential_deleted' | 'credential_validation_failed'
  resource    TEXT        NOT NULL,  -- 'openai' | 'minimax'
  success     BOOLEAN     NOT NULL,
  error_msg   TEXT,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookups for audit review (not by user — immutable table, no user filter)
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_resource ON audit_logs(event, resource);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ─── Role-restricted audit table ────────────────────────────────────────────
-- Prevent any application role from deleting audit records
CREATE OR REPLACE FUNCTION prevent_audit_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs cannot be deleted. This action is blocked.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER audit_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_delete();

-- Note: audit_admin role must be created and assigned by a DBA for out-of-band cleanup.
-- Application code never uses audit_admin. See runbook for key-rotation procedures.

COMMIT;