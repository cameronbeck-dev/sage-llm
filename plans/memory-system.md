# Memory System — Implementation Plan

## Context

Users want Sage to learn about them over time, stored in Markdown files that grow through normal conversation. The system should feel seamless — Sage quietly maintains these files without being disruptive. Users only directly edit `AGENTS.md`; everything else Sage writes silently.

**Files:**

| File | Table | Purpose | User-editable? |
|---|---|---|---|
| `AGENTS.md` | `memory_docs` | How the user wants Sage to behave | Yes — in Settings |
| `MEMORY.md` | `memory_docs` | Learned facts about the user | No — Sage writes after each message |
| `SUMMARIES.json` | `memory_docs` | Per-conversation summaries, JSON format | No — Sage writes on session end, capped at 20 |

**Core flows:**

1. **Onboarding** — On first login, a welcome conversation is seeded where Sage speaks first, prompting the user to share about themselves
2. **After every message** — Sage reviews the conversation and may update `MEMORY.md`; stores changes as whisper messages in the conversation
3. **End of session** — When user starts a new conversation, Sage writes a summary to `SUMMARIES.json`
4. **Trimming** — When SUMMARIES exceeds 20 entries, oldest are removed; Sage checks each for facts worth promoting to `MEMORY.md`
5. **Whispers** — Stored as special `whisper` role messages in the conversation with format: `I've updated memory: [description of change]`

---

## Phase 1 — Database

### 1.1 Rename `agent_files.name` → `agent_files.filename`

```sql
ALTER TABLE agent_files RENAME COLUMN name TO filename;
```

Update all code references to `file.name` → `file.filename`.

### 1.2 Create `memory_docs` table

Replaces `agent_files` and `memory_files` (consolidate both into one table with `filename` as key).

```sql
CREATE TABLE memory_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,        -- 'AGENTS.md', 'MEMORY.md', 'SUMMARIES.json'
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, filename)
);
```

Each user has exactly 3 rows. No `enabled`/`pinned` flags — all 3 are always loaded.

### 1.3 Seed welcome message template

```sql
CREATE TABLE welcome_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO welcome_templates (content) VALUES (
  'Hello! I''m Sage — your personal AI assistant. I''m here to learn about you so I can be more helpful over time.\n\nI''ll keep notes about what you tell me in the background, and I can update my own instructions if you want me to behave differently.\n\nSo — who are you? What do you do? What are you working on?'
);
```

### 1.4 Add `whisper` to message roles

Update the messages table to support the `whisper` role:

```sql
ALTER TABLE messages ALTER COLUMN role TYPE TEXT;
-- Role values now: 'user' | 'assistant' | 'system' | 'whisper'
```

Add an index for efficient whisper queries:

```sql
CREATE INDEX IF NOT EXISTS messages_conversation_id_role_idx
  ON messages (conversation_id, role) WHERE role = 'whisper';
```

### 1.5 Migration: Copy `agent_files` content to `memory_docs`

```sql
INSERT INTO memory_docs (user_id, filename, content, created_at, updated_at)
SELECT user_id, filename, content, created_at, updated_at
FROM agent_files
ON CONFLICT (user_id, filename) DO NOTHING;
```

### 1.6 Migration: Copy `memory_files` content to `memory_docs`

```sql
INSERT INTO memory_docs (user_id, filename, content, created_at, updated_at)
SELECT user_id, name, content, created_at, updated_at
FROM memory_files
ON CONFLICT (user_id, filename) DO NOTHING;
```

Note: Both migrations use `ON CONFLICT DO NOTHING` so users who already have data aren't affected — existing `memory_docs` rows take precedence.

---

## Phase 2 — Backend Services (`services/docs.ts`)

New `services/docs.ts`:

```typescript
export interface MemoryDoc {
  id: string;
  userId: string;
  filename: string;      // 'AGENTS.md' | 'MEMORY.md' | 'SUMMARIES.json'
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SummaryEntry {
  id: string;
  conversationId: string;
  conversationTitle: string;
  timestamp: string;     // ISO 8601
  summary: string;
}

export interface MemoryDelta {
  action: 'update' | 'append' | 'none';
  filename: string;
  content?: string;      // full new content for update; partial for append
  summary?: string;     // human-readable change description for the whisper
}

// Get all 3 docs for a user (creates with defaults if missing)
getDocs(userId: string): Promise<MemoryDoc[]>

// Get a single doc
getDoc(userId: string, filename: string): Promise<MemoryDoc | null>

// Update a doc (AGENTS.md user-facing; MEMORY.md and SUMMARIES.json server-only)
updateDoc(userId: string, filename: string, content: string): Promise<void>

// Append a whisper message to a conversation
createWhisper(conversationId: string, filename: string, change: string): Promise<string>

// Review pass: analyze conversation and return memory delta
reviewMemory(userId: string, conversationId: string): Promise<MemoryDelta>

// Summary pass: generate and store conversation summary
summarizeConversation(userId: string, conversationId: string, conversationTitle: string): Promise<void>

// Trim SUMMARIES.json to 20 entries; migrate facts from removed entries
trimAndMigrateSummaries(userId: string): Promise<void>
```

**Default content for new docs:**

- `AGENTS.md`: `# Agents\n\nYou are a helpful AI assistant.`
- `MEMORY.md`: `# Memory\n\n` (empty body)
- `SUMMARIES.json`: `{"entries": []}`

---

## Phase 3 — Memory Review Pass

**Trigger:** After `chatStream` completes and the assistant message is saved.

**Input to review model:**
- `AGENTS.md` content
- `MEMORY.md` content
- Last 10 messages from the conversation (user + assistant pairs only)
- All whisper messages from this conversation (so Sage won't re-save what it already whispered about)

**Prompt:**

```
You are reviewing a conversation to decide if anything should be saved to memory.
Current AGENTS.md:
{AGENTS.md}

Current MEMORY.md:
{MEMORY.md}

Recent conversation:
{messages}

Already whispered about in this conversation:
{whispers}

Should anything be added or updated in MEMORY.md? You should only suggest changes if the information is:
- New (not already in MEMORY.md)
- Persistent (won't change next session)
- Useful (would affect how you assist this user)

Output a single JSON object:
- To update/replace MEMORY.md: {"action": "update", "filename": "MEMORY.md", "content": "...full new MEMORY.md content...", "summary": "...brief description of what changed..."}
- To append to MEMORY.md: {"action": "append", "filename": "MEMORY.md", "content": "...what to append...", "summary": "...brief description..."}
- If nothing needs changing: {"action": "none"}
```

**Output:** Parse the JSON. If `action` is `"none"` — do nothing.

If `action` is `"update"` or `"append"`:
1. Call `updateDoc(userId, 'MEMORY.md', newContent)`
2. Call `createWhisper(conversationId, 'MEMORY.md', delta.summary)`
3. The whisper is now stored in the conversation as a `whisper` role message

---

## Phase 4 — Whisper Messages

**Storage:** `messages` table with `role = 'whisper'`.

**Content format:** A single text block:
```json
{ "type": "text", "text": "I've updated memory: User is working on a React/Node fullstack project" }
```

**API:** `createWhisper(conversationId, filename, change)` inserts the whisper message.

**Display:** In `MessageBubble.tsx`, render messages with `role === 'whisper'` with distinct styling — smaller font, italic, muted color, no bubble background. They appear inline in the conversation but are clearly ambient/different from regular messages.

---

## Phase 5 — Session Summary Pass

**Trigger:** When user starts a new conversation — the `createConversation` API call triggers the summary write for the previous conversation.

On `createConversation(userId, title)`:
1. Fetch the previous active conversation ID from the request or state
2. If there was an active conversation with messages, run the summary pass for it
3. Then create the new conversation as normal

**Summary input:**
- `AGENTS.md`
- `MEMORY.md`
- All messages from the conversation being summarized
- All whisper messages from the conversation

**Prompt:**

```
Write a brief summary (2-4 sentences) of what was discussed in this conversation.
Focus on: facts learned, decisions made, outstanding tasks, topics explored.

Conversation title: {title}
Messages:
{messages}

Output a JSON object:
{"summary": "...2-4 sentence summary..."}
```

**Storage:** After generating the summary, call:

```typescript
appendSummary(userId: string, conversationId: string, conversationTitle: string, summary: string)
```

Which:
1. Reads `SUMMARIES.json` content from `memory_docs`
2. Parses the JSON, appends a new entry:
```json
{
  "id": "uuid",
  "conversationId": "uuid",
  "conversationTitle": "Auth flow implementation",
  "timestamp": "2025-03-15T10:30:00Z",
  "summary": "Discussed JWT vs session-based auth..."
}
```
3. Writes the updated JSON back
4. Calls `trimAndMigrateSummaries(userId)`

---

## Phase 6 — Trimming Logic (`SUMMARIES.json`)

The file is stored as JSON. Structure:

```json
{
  "entries": [
    { "id": "...", "conversationId": "...", "conversationTitle": "...", "timestamp": "...", "summary": "..." },
    ...
  ]
}
```

`trimAndMigrateSummaries` steps:

1. Fetch `SUMMARIES.json` from `memory_docs`
2. Parse entries
3. If `entries.length <= 20`: done, write back unchanged
4. If `entries.length > 20`:
   - Sort by `timestamp` ascending (oldest first)
   - For each entry being removed (oldest first):
     a. Pass the entry's `summary` text + current `MEMORY.md` to the model
     b. Prompt: *"Does this summary contain any facts not already in MEMORY.md that should be migrated? If yes, output the full updated MEMORY.md content. If no, output: {"migrate": false}"*
     c. If model returns updated MEMORY.md: call `updateDoc(userId, 'MEMORY.md', newContent)`
   - Slice entries to keep only the 20 most recent (by timestamp descending)
   - Write the trimmed JSON back to `SUMMARIES.json`

---

## Phase 7 — Welcome Conversation Seeding

On user creation:

1. Look up the `welcome_templates` row
2. Create a new conversation titled `"Welcome"`
3. Create a single assistant message in that conversation with the template content
4. User sees the conversation in the sidebar with Sage's first message already there
5. The welcome conversation is eligible for summarization when it ends

---

## Phase 8 — Settings UI for AGENTS.md

In `Settings.tsx`:

- Add a section "Agent Instructions" with a textarea
- On mount: fetch `AGENTS.md` content via `GET /api/docs/AGENTS.md`
- On save: call `PUT /api/docs/AGENTS.md` with the new content
- Allow raw markdown editing; no preview needed (user is technical)

**API routes:**

```
GET  /api/docs/:filename         -- get a single doc (any filename, auth required)
PUT  /api/docs/AGENTS.md          -- update AGENTS.md (user-facing)
PUT  /api/docs/MEMORY.md          -- rejected: server-only
PUT  /api/docs/SUMMARIES.json     -- rejected: server-only
```

Validation: In the PUT handler, if `filename !== 'AGENTS.md'`, return 403.

---

## Phase 9 — Client Changes

### Whisper display in Chat

In `MessageBubble.tsx`: add rendering for `role === 'whisper'`:

```tsx
if (message.role === 'whisper') {
  return <div className="whisper-message">{content.text}</div>;
}
```

CSS: italic, smaller font, muted gray, no bubble — just inline text with left border or similar.

### Trigger summary on new conversation

In `conversationStore.ts`, modify `createConversation`:

```typescript
async createConversation(title) {
  // If there was a previous active conversation, trigger summary
  const prevId = this.activeConversationId;
  if (prevId) {
    fetch(`/api/conversations/${prevId}/summarize`, { method: 'POST' });
  }
  // Then create the new conversation...
}
```

Or: handle this server-side in the `createConversation` route — fetch the previous active conversation, summarize it, then create the new one in one transaction.

---

## Data Model Summary

**`memory_docs` table — one row per user per file:**

| filename | content example |
|---|---|
| `AGENTS.md` | `# Agents\n\nYou are a helpful AI assistant...` |
| `MEMORY.md` | `# Memory\n\n- User works as a fullstack dev\n- Prefers concise responses...` |
| `SUMMARIES.json` | `{"entries": [{...}, {...}]}` |

**`messages` table — whisper role:**

| role | content |
|---|---|
| `whisper` | `[{"type": "text", "text": "I've updated memory: ..."}]` |

---

## File Changes

**New files:**
- `packages/server/src/services/docs.ts` — doc CRUD + review + summary + trim
- `packages/server/src/api/docs.routes.ts` — API routes
- `packages/server/src/db/migrations/008_docs_consolidation.sql` — full schema (all Phase 1 steps)
- `packages/server/src/db/migrations/009_whisper_role.sql` — add whisper role + index
- `packages/client/src/api/docs.ts` — client API wrapper
- `plans/memory-system.md` — this file

**Modified files:**
- `packages/server/src/db/migrations/004_agent_files.sql` — rename `name` → `filename` (Phase 1.1)
- `packages/server/src/services/chat.ts` — add review pass after streaming
- `packages/server/src/services/conversations.ts` — trigger summary on conversation switch
- `packages/server/src/services/messages.ts` — support `whisper` role in `createMessage`
- `packages/client/src/pages/Settings.tsx` — AGENTS.md editor
- `packages/client/src/components/chat/MessageBubble.tsx` — render whisper messages
- `packages/client/src/state/conversationStore.ts` — trigger summary on new conversation
- `packages/shared/src/types/index.ts` — add `MemoryDoc`, `SummaryEntry`, `MemoryDelta` types
- `packages/shared/src/types/message.ts` — add `'whisper'` to `Role`

---

## Irreversible Actions

- Renaming `agent_files.name` → `filename` — code must be updated to match
- Consolidating `agent_files` + `memory_files` → `memory_docs` — data migrated once
- Whispers are stored but not editable by the user — no user-facing edit UI for memory docs
- SUMMARIES.json trimming is destructive — older entries gone after trim (but facts should be migrated to MEMORY.md first)

---

## Out of Scope (Future)

- Automatic truncation of MEMORY.md when it exceeds a token budget
- User ability to manually trigger a memory review
- Memory edit history / diff view
- Different memory strategies per user (opt-in to more aggressive learning)
- Periodic re-reading/summarization of SUMMARIES to keep MEMORY.md fresh
- Editing or deleting whispers from the UI