CREATE TABLE knowledge_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_packs_user_idx ON knowledge_packs(user_id);

CREATE TABLE knowledge_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES knowledge_packs(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  raw_text TEXT,
  source_kind TEXT NOT NULL DEFAULT 'upload'
    CHECK (source_kind IN ('upload', 'chat_extracted')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'parsing', 'ready', 'failed')),
  error_msg TEXT,
  r2_key TEXT,
  file_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_files_pack_idx ON knowledge_files(pack_id);
CREATE UNIQUE INDEX knowledge_files_pack_hash_idx ON knowledge_files(pack_id, file_hash) WHERE file_hash IS NOT NULL;

CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES knowledge_files(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES knowledge_packs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER,
  embedding BYTEA NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_chunks_pack_idx ON knowledge_chunks(pack_id);
CREATE INDEX knowledge_chunks_tsv_idx ON knowledge_chunks USING GIN(tsv);

CREATE TABLE conversation_knowledge_packs (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES knowledge_packs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, pack_id)
);

ALTER TABLE conversations
  ADD COLUMN knowledge_pack_id UUID REFERENCES knowledge_packs(id) ON DELETE SET NULL;
CREATE INDEX conversations_knowledge_pack_id_idx ON conversations(knowledge_pack_id) WHERE knowledge_pack_id IS NOT NULL;
