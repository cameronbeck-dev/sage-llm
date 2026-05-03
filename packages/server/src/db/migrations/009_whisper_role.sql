-- Whisper role: partial index for efficient whisper message queries
-- messages.role is already TEXT so no ALTER needed

CREATE INDEX IF NOT EXISTS messages_conversation_id_role_whisper_idx
  ON messages (conversation_id, role) WHERE role = 'whisper';