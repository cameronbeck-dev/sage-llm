-- Structured memory tables replacing MEMORY.md / SUMMARIES.json blobs

CREATE TABLE memory_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other'
    CHECK (type IN ('user','feedback','project','reference','other')),
  source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX memory_entries_user_active_idx ON memory_entries (user_id) WHERE deleted_at IS NULL;
CREATE INDEX memory_entries_user_updated_idx ON memory_entries (user_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE summary_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  conversation_title TEXT NOT NULL,
  summary TEXT NOT NULL,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT summary_entries_user_conversation_unique UNIQUE (user_id, conversation_id)
);
CREATE INDEX summary_entries_user_active_idx ON summary_entries (user_id) WHERE deleted_at IS NULL;

CREATE TABLE memory_entry_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  body TEXT,
  change_summary TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'llm'
    CHECK (triggered_by IN ('user','llm','migration')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX memory_entry_versions_entry_idx ON memory_entry_versions (entry_id, created_at DESC);

-- Parse existing MEMORY.md rows into memory_entries.
DO $$
DECLARE
  doc RECORD;
  ln TEXT;
  trimmed TEXT;
  m_key TEXT;
  m_body TEXT;
  link_match TEXT[];
  colon_idx INT;
  new_entry_id UUID;
BEGIN
  FOR doc IN SELECT user_id, content FROM memory_docs WHERE filename = 'MEMORY.md' LOOP
    FOREACH ln IN ARRAY string_to_array(doc.content, E'\n') LOOP
      trimmed := trim(ln);
      CONTINUE WHEN trimmed = '' OR left(trimmed, 1) = '#';
      CONTINUE WHEN left(trimmed, 2) <> '- ';
      m_body := substring(trimmed FROM 3);
      link_match := regexp_match(m_body, '^\[([^\]]+)\]');
      IF link_match IS NOT NULL THEN
        m_key := link_match[1];
      ELSE
        colon_idx := position(':' in m_body);
        IF colon_idx > 0 AND colon_idx <= 80 THEN
          m_key := trim(substring(m_body FROM 1 FOR colon_idx - 1));
        ELSE
          m_key := left(m_body, 80);
        END IF;
      END IF;
      INSERT INTO memory_entries (user_id, key, body, type, created_at, updated_at)
      VALUES (doc.user_id, m_key, m_body, 'other', now(), now())
      RETURNING id INTO new_entry_id;
      INSERT INTO memory_entry_versions (entry_id, body, change_summary, triggered_by)
      VALUES (new_entry_id, m_body, 'Migrated from MEMORY.md', 'migration');
    END LOOP;
  END LOOP;
END $$;

-- Parse existing SUMMARIES.json rows into summary_entries.
DO $$
DECLARE
  doc RECORD;
  data JSONB;
  entry JSONB;
BEGIN
  FOR doc IN SELECT user_id, content FROM memory_docs WHERE filename = 'SUMMARIES.json' LOOP
    BEGIN
      data := doc.content::jsonb;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipping malformed SUMMARIES.json for user %', doc.user_id;
      CONTINUE;
    END;
    IF data ? 'entries' THEN
      FOR entry IN SELECT * FROM jsonb_array_elements(data->'entries') LOOP
        INSERT INTO summary_entries (
          user_id, conversation_id, conversation_title, summary, last_message_at, created_at
        ) VALUES (
          doc.user_id,
          NULLIF(entry->>'conversationId','')::uuid,
          COALESCE(entry->>'conversationTitle', '(untitled)'),
          COALESCE(entry->>'summary', ''),
          NULLIF(entry->>'lastMessageAt','')::timestamptz,
          COALESCE(NULLIF(entry->>'timestamp','')::timestamptz, now())
        )
        ON CONFLICT (user_id, conversation_id) DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;
END $$;
