CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_provider TEXT NOT NULL DEFAULT 'openai',
  active_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  theme TEXT NOT NULL DEFAULT 'forest',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
