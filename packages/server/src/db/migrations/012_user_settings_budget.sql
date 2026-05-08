ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS monthly_budget_cents INT NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS budget_warned_period TEXT NULL;
