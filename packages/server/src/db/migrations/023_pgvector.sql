-- Enable the pgvector extension for mem0's fact embeddings.
-- Requires PostgreSQL with pgvector installed (apt install postgresql-15-pgvector
-- or equivalent; most managed Postgres providers offer it as a checkbox).
--
-- If pgvector is unavailable on this instance, this migration logs a NOTICE
-- and succeeds as a no-op so the server can still boot. Wiki/facts features
-- depending on pgvector will not work until the extension is installed and
-- this migration (and 024) are re-run manually.
--
-- To recover after installing pgvector:
--   psql> CREATE EXTENSION vector;
--   psql> DELETE FROM _migrations WHERE filename IN ('023_pgvector.sql', '024_mem0_schema.sql');
--   (then restart the server — migrations will re-apply)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  RAISE NOTICE 'pgvector extension available';
EXCEPTION
  WHEN feature_not_supported OR undefined_file OR insufficient_privilege THEN
    RAISE NOTICE 'pgvector extension unavailable on this Postgres instance — wiki/facts will be limited until installed. Server continues to boot.';
END
$$;
