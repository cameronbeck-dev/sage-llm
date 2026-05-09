CREATE TABLE imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('chatgpt','claude','generic')),
  filename TEXT NOT NULL,
  r2_key TEXT,
  file_hash TEXT,
  stats JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','parsing','ready','committing','done','failed')),
  error_msg TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX imports_user_created_idx ON imports (user_id, created_at DESC);
CREATE UNIQUE INDEX imports_user_hash_unique ON imports (user_id, file_hash) WHERE file_hash IS NOT NULL;
