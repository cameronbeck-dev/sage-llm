ALTER TABLE conversations
  ADD COLUMN import_id UUID REFERENCES imports(id) ON DELETE SET NULL;

CREATE INDEX idx_conversations_import_id ON conversations(import_id) WHERE import_id IS NOT NULL;
