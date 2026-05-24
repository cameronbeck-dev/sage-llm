-- Phase 4: Per-role model assignment columns.
-- Each column holds {provider: string, model: string} or NULL.
-- NULL means "inherit the primary active_provider / active_model".

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS chat_model JSONB NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS wiki_maintenance_model JSONB NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS fact_extraction_model JSONB NULL;
