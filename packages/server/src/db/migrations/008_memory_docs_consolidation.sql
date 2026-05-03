-- Memory system consolidation: memory_docs + welcome_templates
-- Phase 1.1: Rename agent_files.name -> filename (must happen before we SELECT from it)

ALTER TABLE agent_files RENAME COLUMN name TO filename;

-- Phase 1.2: Create memory_docs table

CREATE TABLE IF NOT EXISTS memory_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, filename)
);

-- Phase 1.3: Create welcome_templates table

CREATE TABLE IF NOT EXISTS welcome_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the welcome template

INSERT INTO welcome_templates (content) VALUES (
  'Hello! I''m Sage — your personal AI assistant, here to learn about you over time.

I''ll keep notes about what you tell me so I can be more helpful in our conversations. The more I know, the better I can adapt to your style and needs.

To get us started, I''d love to learn a little about you. Answer as many (or as few) of these as you like — or just chat with me naturally and I''ll pick things up:

1. What should I call you?
2. What do you do for work or fun?
3. How formal should I be? (1 = casual mates, 10 = boardroom)
4. What are you currently working on?
5. What''s one thing you wish AI understood about you?
6. Do you prefer short and snappy, or detailed and thorough responses?
7. Any topics you''d like me to avoid or approach with extra care?
8. What LLMs or AI tools have you used before, and what did you like about them?
9. Any habits or quirks I should know about?
10. What will make our partnership most valuable to you?

Feel free to tell me anything else you want me to remember. I''m listening.'
);

-- Phase 1.5: Migrate agent_files content to memory_docs

INSERT INTO memory_docs (user_id, filename, content, created_at, updated_at)
SELECT user_id, filename, content, created_at, updated_at
FROM agent_files
ON CONFLICT (user_id, filename) DO NOTHING;

-- Phase 1.6: Migrate memory_files content to memory_docs

INSERT INTO memory_docs (user_id, filename, content, created_at, updated_at)
SELECT user_id, name, content, created_at, updated_at
FROM memory_files
ON CONFLICT (user_id, filename) DO NOTHING;