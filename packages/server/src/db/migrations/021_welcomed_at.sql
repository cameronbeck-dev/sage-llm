-- Add welcomed_at to gate the one-time welcome conversation seed

ALTER TABLE users ADD COLUMN IF NOT EXISTS welcomed_at TIMESTAMPTZ DEFAULT NULL;

UPDATE users SET welcomed_at = now() WHERE welcomed_at IS NULL;
