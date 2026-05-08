ALTER TABLE messages ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12, 6) NULL;
UPDATE messages SET cost_usd = cost_cents::numeric / 100 WHERE cost_cents IS NOT NULL AND cost_usd IS NULL;
