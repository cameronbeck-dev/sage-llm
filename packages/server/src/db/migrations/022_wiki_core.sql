-- Wiki core tables: wiki_pages, wiki_links, wiki_page_versions, wiki_log, wiki_deferred_ops

BEGIN;

CREATE TABLE wiki_pages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path                TEXT NOT NULL,
  title               TEXT,
  type                TEXT CHECK (type IN ('entity','concept','comparison','query','raw','meta')),
  tags                TEXT[],
  frontmatter         JSONB NOT NULL DEFAULT '{}',
  content_hash        TEXT NOT NULL,
  r2_key              TEXT NOT NULL,
  rename_in_progress  BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  UNIQUE (user_id, path)
);

CREATE INDEX wiki_pages_user_type_idx ON wiki_pages (user_id, type);
CREATE INDEX wiki_pages_user_active_idx ON wiki_pages (user_id, deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE wiki_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_page_id  UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  target_path     TEXT NOT NULL,
  target_page_id  UUID REFERENCES wiki_pages(id),
  kind            TEXT NOT NULL CHECK (kind IN ('wikilink','provenance')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wiki_links_source_idx ON wiki_links (source_page_id);
CREATE INDEX wiki_links_target_path_idx ON wiki_links (target_path);
CREATE INDEX wiki_links_target_page_idx ON wiki_links (target_page_id) WHERE target_page_id IS NOT NULL;

CREATE TABLE wiki_page_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id       UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  content_hash  TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  author        TEXT NOT NULL CHECK (author IN ('llm','user','migration')),
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wiki_page_versions_page_created_idx ON wiki_page_versions (page_id, created_at DESC);

CREATE TABLE wiki_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  op          TEXT NOT NULL CHECK (op IN ('create','update','delete','rename','link_added','link_removed','lint')),
  page_id     UUID REFERENCES wiki_pages(id),
  summary     TEXT,
  actor       TEXT NOT NULL CHECK (actor IN ('llm','user','migration','lint')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wiki_log_user_created_idx ON wiki_log (user_id, created_at DESC);

CREATE TABLE wiki_deferred_ops (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  turn_id   UUID REFERENCES messages(id),
  op_json   JSONB NOT NULL,
  status    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wiki_deferred_ops_user_status_idx ON wiki_deferred_ops (user_id, status, created_at);

COMMIT;
