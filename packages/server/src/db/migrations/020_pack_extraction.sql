-- Phase 5.x v2: unified extraction pipeline schema

-- 1. Per-attachment extraction policy (replaces the bound-conversation concept)
ALTER TABLE conversation_knowledge_packs
  ADD COLUMN IF NOT EXISTS auto_extract BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Drop the deprecated bound column and its index from migration 019.
--    The index must drop before the column it depends on.
DROP INDEX IF EXISTS conversations_knowledge_pack_id_idx;
ALTER TABLE conversations
  DROP COLUMN IF EXISTS knowledge_pack_id;

-- 3. Whisper actions stored on the whisper message itself.
--    Column holds WhisperAction[] (JSON array) directly — no wrapper object.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS whisper_actions JSONB;

-- 4. Orphan extractions awaiting consolidation
CREATE TABLE IF NOT EXISTS orphan_extractions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      UUID REFERENCES messages(id) ON DELETE SET NULL,
  extracted_text  TEXT NOT NULL,
  signal_types    TEXT[] NOT NULL DEFAULT '{}',
  importance      SMALLINT NOT NULL,
  suggested_topic TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  consolidated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS orphan_extractions_pending_idx
  ON orphan_extractions (user_id, suggested_topic)
  WHERE consolidated_at IS NULL;
