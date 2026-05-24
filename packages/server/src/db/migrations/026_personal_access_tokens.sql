-- Phase 4: Personal access tokens for non-web clients (CLI, mobile, agents).
-- Tokens are hashed (SHA-256) at rest; raw value is returned once on creation.
-- Index excludes revoked rows since lookups always filter on active tokens.

CREATE TABLE IF NOT EXISTS personal_access_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  last_used_at  TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS personal_access_tokens_user_id_idx
  ON personal_access_tokens (user_id) WHERE revoked_at IS NULL;
