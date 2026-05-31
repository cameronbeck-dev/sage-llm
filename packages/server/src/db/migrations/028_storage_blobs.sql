-- 028_storage_blobs.sql
-- BYTEA-backed object storage replacing R2.
-- Single table holds all blobs keyed by opaque string (matches existing r2_key columns).

CREATE TABLE IF NOT EXISTS storage_blobs (
  key          TEXT PRIMARY KEY,
  content      BYTEA NOT NULL,
  content_type TEXT,
  size         BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS storage_blobs_created_at_idx
  ON storage_blobs (created_at);
