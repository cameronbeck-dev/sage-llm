CREATE TABLE IF NOT EXISTS whisper_feed (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NULL REFERENCES conversations(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  display_summary TEXT NOT NULL,
  actions         JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed_at    TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS whisper_feed_user_created_idx
  ON whisper_feed (user_id, created_at DESC)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS whisper_feed_user_conv_idx
  ON whisper_feed (user_id, conversation_id, created_at DESC)
  WHERE dismissed_at IS NULL;
