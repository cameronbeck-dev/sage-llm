-- Facts store backed by pgvector.
-- mem0's auto-create-tables is DISABLED in our config; this migration is the
-- authoritative schema definition.
--
-- Vector dimension: 1536 matches OpenAI text-embedding-3-small (the default
-- embedder in mem0 OSS). Change the dimension here and rebuild the index if
-- you switch to a different embedding model.
--
-- All DDL is gated on `vector` type existing, so this migration is a no-op
-- when pgvector wasn't installed (see 023_pgvector.sql).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    RAISE NOTICE 'vector type not available — skipping memories schema. Install pgvector and re-run migrations 023 and 024.';
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS memories (
    id      UUID PRIMARY KEY,
    vector  vector(1536),
    payload JSONB NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS memories_vector_hnsw_idx
    ON memories
    USING hnsw (vector vector_cosine_ops);

  CREATE INDEX IF NOT EXISTS memories_payload_gin_idx
    ON memories
    USING gin (payload);

  CREATE TABLE IF NOT EXISTS memory_migrations (
    id      SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS memory_history (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id    UUID NOT NULL,
    old_memory   TEXT,
    new_memory   TEXT,
    event        TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted   SMALLINT NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS memory_history_memory_id_idx
    ON memory_history (memory_id);
END
$$;
