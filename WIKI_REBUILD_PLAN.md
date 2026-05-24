# Sage Wiki Rebuild — Implementation Plan

**Status:** Approved (pending Phase 0 kickoff)
**Date locked:** 2026-05-24
**Branch target:** `wiki-migration` (off tag `sage-v1-pre-wiki`)
**Rollback target:** `sage-v1-pre-wiki` tag remains a fully working v1 for 30+ days post-cutover

---

## Executive Summary

Replace Sage's per-turn LLM triage / dedup / consolidation extraction pipeline with a **Karpathy-style LLM-curated markdown wiki** as the spine of memory, plus **mem0 (TypeScript SDK)** as a structured fact tier alongside it. The wiki is stored as markdown files in **Cloudflare R2** (source of truth), indexed in **Postgres**. All orchestration is implemented natively in Node/TS — we own the wiki maintainer end-to-end. mem0 is the only third-party we adopt, narrowly for the fact-extraction sub-problem.

The system is designed **backend-first**: every operation is exposed as a clean HTTP/SSE API. The current React frontend is one client; future mobile apps, CLI tools, and always-on agents (Hermes-style) all share the same backend by talking to the same endpoints. Auth supports both cookie-session (web) and personal access tokens (other clients).

**Whisper transparency is sacred.** Every wiki write, fact save, page update, link change, and lint result surfaces as a whisper with displaySummary and appropriate actions (view, undo where reversible). Existing 8 whisper kinds preserved; 8+ new kinds added for wiki and fact operations.

**Single-user assumption.** GitHub OAuth retained for web auth, but the system assumes one user. Multi-user is explicitly out of scope.

---

## Context

### What Sage is today

Multi-package monorepo: React frontend (`packages/client`), Node/TS backend (`packages/server`), shared types (`packages/shared`). Backend uses Express-style routing, Postgres for relational data, R2 for blob storage, pg-boss for background jobs. Auth via GitHub OAuth + `cookie-session`. Per-user credentials encrypted at rest with AES-256-GCM. Provider abstraction (`LLMProvider` interface) supports BYO-LLM across OpenAI, Anthropic, Minimax (and extensible).

Current memory/knowledge system:

- **`memory_entries`** — short structured facts (user/feedback/project/reference) with version history. Edited via Memory page.
- **`knowledge_packs`** + **`knowledge_files`** + **`knowledge_chunks`** — uploaded documents, parsed and chunked, attached to conversations. Used as RAG context.
- **`orphan_extractions`** — extracted facts awaiting consolidation into a pack.
- **Post-turn pipeline**: `extraction.ts` runs triage → dedup → consolidation LLM chain. Outputs whispers describing what was saved.
- **8 WhisperAction kinds**: `add_to_pack`, `create_pack`, `always_extract_to_pack`, `undo_extraction`, `undo_memory`, `undo_orphan`, `view_entry`, `dismiss`.

### Why we're rebuilding

Failure modes observed in real conversations:

1. **Hallucinated save success** — model says "Done, updated the pack" but no save fires.
2. **Granularity loss** — long structured assistant blocks reduce to 1–2 short factoids.
3. **Negotiation pattern** — model asks "want me to save this?" despite recent prompt rules forbidding it.
4. **Silent skips** — turns below importance 3 produce no whisper at all.
5. **No receipt loop** — chat model has no idea what was actually saved.

These are symptoms of the architecture, not the prompts. The decision: replace the paradigm, not patch it.

### Why Karpathy's LLM wiki

Karpathy ([gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)) describes a persistent, compounding knowledge artifact maintained by the LLM:

- **Raw sources** (immutable) — articles, papers, transcripts
- **The wiki** (mutable) — LLM-authored entity/concept/comparison markdown pages
- **The schema** (config) — `SCHEMA.md` defines conventions, naming, structure

Writes are active: ingesting a source means updating 10–15 existing pages, adding cross-references, flagging contradictions, appending to `log.md`. Navigation via `index.md` (catalog of pages). Knowledge compounds — good answers get filed as new pages.

This is closer to how a "second brain" actually wants to work: synthesis over time, not facts in buckets.

### Why we're not adopting Hermes Agent

Hermes (Nous Research, MIT, ~$70M backing) ships a working `llm-wiki` skill that implements Karpathy's pattern verbatim. We seriously considered adopting it as a backend sidecar. We're not, because:

- Storage is local filesystem + SQLite — no R2 path; we'd build a sync layer anyway
- We'd be a *client* of a Python sidecar at v0.x with weekly breaking changes
- Sage loses control of the wiki orchestration semantics
- The wiki is one optional skill among many in Hermes, not the spine of the product
- Hermes is fundamentally single-user-self-hosted with a CLI/messaging-platform focus; coupling Sage's web architecture to it is friction

We are implementing the paradigm natively. The wiki orchestration logic is small (1–2k LOC). mem0 (Apache 2.0, TypeScript SDK, 56k stars, mature) is the only library we adopt — for fact extraction, which it does well and we don't need to invent.

---

## Locked Decisions

| # | Decision | Locked because |
|---|---|---|
| 1 | Single-user app (web auth via GitHub OAuth) | User confirmed; multi-user out of scope |
| 2 | R2 = source of truth for wiki corpus; Postgres = index | User chose R2; metadata in Postgres avoids re-listing R2 |
| 3 | Wiki is user-editable, not LLM-curated only | User wants to fix mistakes, organize manually |
| 4 | Hybrid ingest: auto-maintain + explicit "save this to X" | Matches existing whisper UX |
| 5 | Two-tier memory: Wiki (synthesis) + mem0 (facts) | Mirrors existing knowledge_packs + memory_entries split, just done right |
| 6 | Per-role model selection: chat / wiki_maintenance / fact_extraction | User wants Minimax→one-model OR Claude→split flexibility |
| 7 | Whisper transparency preserved + expanded | Non-negotiable principle |
| 8 | **Backend-first architecture** | User plans mobile/CLI/agent clients; all must share the backend |
| 9 | Turn ordering: option B — await pending wiki-ingest with short timeout before queryForContext | Correctness on fast follow-ups; minimal latency cost |
| 10 | Memory.tsx strategy: option C — new Facts page in Phase 3 uses mem0 natively; Memory.tsx retires at Phase 7 cutover | No ambiguous compatibility wrapper; legacy data viewable until cutover |
| 11 | Async whisper delivery: persistent SSE on active conversation + late-append to `messages.whisper_actions` JSONB + visible on reload | Standard chat-app pattern; works across all clients |
| 12 | mem0 schema committed as numbered Sage migration (no auto-DDL on prod) | Production discipline |
| 13 | `_legacy/` deletion gated on 30 days stable operation post-cutover | Reversibility window |
| 14 | Owner check: `OWNER_GITHUB_ID` env var compared against session user | Migration endpoint security |

---

## Cross-Cutting Principles

### Backend-first

Frontend = renderer. Backend = brain. Every operation needs to be reachable via API so future clients (mobile native app, CLI tool, always-on agent like Hermes) can hook the same backend.

What lives on the backend:
- All data persistence and retrieval
- LLM orchestration (chat, wiki maintainer, fact extraction)
- Wiki CRUD (pages, links, versions, log, schema)
- Markdown parsing/validation (returning structured data)
- Search (FTS + semantic) with server-side ranking
- Wikilink resolution and validation (endpoint, not client logic)
- Whisper generation and delivery
- Auth + authorization (cookies AND personal access tokens)
- Per-role model resolution
- Background jobs (pg-boss)
- Schema enforcement
- Version history

What lives on the frontend:
- Rendering data (markdown → HTML, JSON → UI)
- User input capture
- Local UI state (selection, scroll, modals open)
- Calling backend APIs
- Subscribing to SSE streams

Wire format: raw markdown over the wire. Clients render with their preferred library. (We keep an optional `?render=html` query param on page reads for thin clients that don't want to bundle a markdown renderer.)

### Auth: dual-mode

- **Web (current React app)**: cookie-session via GitHub OAuth, unchanged
- **Non-web clients (mobile/CLI/agent)**: long-lived bearer tokens issued from Settings UI, scoped to a user, revocable
- All API endpoints accept either credential
- Personal access tokens table added in Phase 4 alongside per-role model settings

### Whisper transparency

Every state-changing operation emits a whisper, regardless of who initiated it (LLM, user via UI, scheduled lint job). Whispers carry a `displaySummary` (≤80 char UI label) plus zero or more `whisperActions` (view, undo, dismiss, etc.). Whispers are attached to the relevant message (chat-initiated) or surfaced as standalone notification rows (background-initiated).

### BYO-LLM

Existing `LLMProvider` abstraction stays. Per-role model resolver added so chat / wiki_maintenance / fact_extraction can each have their own model. Default: all three roles inherit from primary. Override: per-role explicit binding.

---

## Architecture Overview

### R2 Layout

```
wiki/<user_id>/
├── SCHEMA.md                  # User-editable; LLM consults each operation
├── index.md                   # LLM-maintained catalog of pages
├── log.md                     # Append-only ops log; rotates at 500 entries
├── raw/                       # Immutable source material
│   ├── articles/
│   ├── papers/
│   ├── transcripts/
│   ├── imports/               # Migrated from knowledge_files during cutover
│   └── assets/
├── entities/                  # Person, project, tool pages (e.g. teelo.md, barry.md)
├── concepts/                  # Topic/concept pages (e.g. elo-rating.md)
├── comparisons/               # Side-by-side analyses
├── queries/                   # Filed query results
│   └── unfiled/               # Migrated orphan_extractions
├── .versions/                 # Prior-version bodies (R2 keys referenced from wiki_page_versions)
│   └── <page_id>/<version_id>.md
└── log-archive/               # Rotated log files
```

Single-user today, but namespacing under `<user_id>` costs nothing and avoids migration if multi-user ever returns.

### Postgres Schema (new tables)

**`wiki_pages`**
```
id              uuid PK
user_id         uuid FK
path            text UNIQUE (e.g. "entities/teelo.md")
title           text
type            text ('entity'|'concept'|'comparison'|'query'|'raw'|'meta')
tags            text[]
frontmatter     jsonb
content_hash    text (sha256 of body)
r2_key          text
rename_in_progress  boolean default false  -- atomicity flag for rename ops
created_at      timestamptz
updated_at      timestamptz
deleted_at      timestamptz null
```

**`wiki_links`**
```
id              uuid PK
source_page_id  uuid FK
target_path     text (text-stored for cheap broken-link detection)
target_page_id  uuid FK null (null = broken)
kind            text ('wikilink'|'provenance')
created_at      timestamptz
```

**`wiki_page_versions`**
```
id              uuid PK
page_id         uuid FK
content_hash    text
r2_key          text  (under wiki/<user>/.versions/...)
author          text ('llm'|'user'|'migration')
reason          text
created_at      timestamptz
```
Retention: keep last 50 per page in PG; older archived to R2 cold path with summary row retained.

**`wiki_log`**
```
id              bigserial PK
user_id         uuid FK
op              text ('create'|'update'|'delete'|'rename'|'link_added'|'link_removed'|'lint')
page_id         uuid FK null
summary         text
actor           text ('llm'|'user'|'migration'|'lint')
created_at      timestamptz
```
Mirrors `log.md` content. Rotation: >500 rows → archive oldest 100 into R2 `log-archive/`.

**`wiki_deferred_ops`**
```
id              uuid PK
user_id         uuid FK
turn_id         uuid FK (messages.id of assistant turn that proposed it)
op_json         jsonb
status          text ('pending'|'applied'|'rejected')
created_at      timestamptz
```
Holds ops beyond the per-turn cap; surfaced to user via "review N deferred changes" whisper.

**`personal_access_tokens`**
```
id              uuid PK
user_id         uuid FK
name            text
token_hash      text UNIQUE  (sha256 of token; raw token shown once at creation)
last_used_at    timestamptz null
created_at      timestamptz
revoked_at      timestamptz null
```

**`user_settings`** — extend existing table:
```
chat_model              jsonb null  ({provider, model} or null = inherit primary)
wiki_maintenance_model  jsonb null
fact_extraction_model   jsonb null
```

**mem0 tables** — created via a numbered migration after inspecting mem0's DDL in dev. Disable mem0's auto-create. Likely: `memories`, `memory_history` (per mem0 conventions). Reside in same Postgres + pgvector.

### Services Map (new + retained)

**New (`packages/server/src/services/`):**
- `wiki/layout.ts` — R2 path conventions, slugify
- `wiki/store.ts` — R2 + Postgres CRUD (read/write/list/move/delete page; manage links/versions/log)
- `wiki/cache.ts` — local working cache per turn (`os.tmpdir()/sage-wiki/<conv>/<turn>/`)
- `wiki/bootstrap.ts` — first-run SCHEMA.md + index.md defaults
- `wiki/events.ts` — `WikiEvent` emitter consumed by whisper layer
- `wiki/maintainer.ts` — `ingestTurn`, `queryForContext`, `lintPage` operations
- `wiki/markdown.ts` — parse markdown for `[[wikilinks]]`, frontmatter, provenance markers
- `wiki/search.ts` — FTS + (later) vector search blending
- `facts/mem0Client.ts` — wrapper around mem0 SDK
- `facts/events.ts` — `FactEvent` emitter
- `settings/roleModel.ts` — `resolveRoleModel(userId, role)` with credential validation
- `auth/tokens.ts` — personal access token issue/verify/revoke

**Retained, extended:**
- `chat.ts` — line 197 LLM seam preserved; `extractAfterTurn` replaced by `boss.send('wiki-ingest-turn')`; `queryForContext` inserted near system-prompt assembly
- `whisper-actions.ts` — extended with handlers for new whisper kinds
- `messages.ts` — `updateMessageWhisperActions` used for post-stream whisper late-append
- `credentials.ts` — unchanged
- `providers/*` — unchanged

**Retained, will be deleted at Phase 7 cutover (moved to `_legacy/` in Phase 2):**
- `extraction.ts`, `triage.ts`, `dedup.ts`, `consolidation.ts` (services)
- `prompts/pack-literacy.ts`, `triage.ts`, `dedup.ts`, `consolidation.ts`, `indicator-copy.ts`
- `memory.ts` (service — replaced by mem0)
- `knowledge.ts` (service — replaced by wiki)
- `orphans.ts` (service — orphans become wiki queries/unfiled/)

**Retained, retired at cutover:**
- `Memory.tsx` page (read-only view of legacy `memory_entries` during transition)
- Knowledge.tsx pack viewer (read-only during transition, replaced by Wiki.tsx)

### Pg-Boss Queues (new)

- `wiki-ingest-turn` — post-turn wiki maintainer + fact extraction
- `wiki-curate-page` — per-page curation (deferred ops, lint follow-ups)
- `wiki-lint` — scheduled weekly lint pass
- `wiki-migrate` — one-shot migration from legacy schema
- `wiki-rename-reconcile` — recovers stalled rename ops

Existing queues retained: `noop`, `import-parse`, `import-commit`, `knowledge-parse` (the last one stays for raw file ingestion into `wiki/raw/`).

### API Routes (new)

```
GET    /api/wiki/pages                          List pages (filter by type/tag/path prefix)
GET    /api/wiki/pages/:path                    Fetch page (raw markdown; ?render=html optional)
PUT    /api/wiki/pages/:path                    User edit (requires If-Match content-hash)
DELETE /api/wiki/pages/:path                    Soft delete
GET    /api/wiki/pages/:path/versions           Version history
POST   /api/wiki/pages/:path/restore/:versionId Restore prior version
POST   /api/wiki/pages/:path/rename             Rename (server handles transactional link rewrite)
GET    /api/wiki/log                            Recent ops log (paginated)
GET    /api/wiki/schema                         Read SCHEMA.md
PUT    /api/wiki/schema                         Write SCHEMA.md
GET    /api/wiki/search?q=&kind=&limit=         FTS + (later) semantic blended search
GET    /api/wiki/links?source=&target=          Query link graph
GET    /api/wiki/autocomplete?q=                Wikilink autocomplete (server-ranked)
POST   /api/wiki/migrate                        Owner-only; enqueue wiki-migrate job (dry-run or commit)
GET    /api/wiki/deferred                       List deferred ops
POST   /api/wiki/deferred/:id/apply             Apply a deferred op
POST   /api/wiki/deferred/:id/reject            Reject a deferred op

GET    /api/facts                               List facts (mem0-native shape)
GET    /api/facts/search?q=                     Semantic fact search
GET    /api/facts/:id                           Fetch fact
PATCH  /api/facts/:id                           Update fact
DELETE /api/facts/:id                           Delete fact

GET    /api/settings/tokens                     List personal access tokens (no raw values)
POST   /api/settings/tokens                     Issue new token (returns raw value once)
DELETE /api/settings/tokens/:id                 Revoke token

GET    /api/whispers                            Poll-based whisper feed (for non-SSE clients)
GET    /api/whispers/stream                     Persistent SSE for active client (cross-conversation)
```

### Async Whisper Delivery (the model)

**Problem:** Wiki maintainer runs in pg-boss after the chat SSE stream closes. Whispers it generates have no open channel.

**Solution:**
1. Whispers are persisted to two places:
   - `messages.whisper_actions` JSONB on the relevant assistant message (late-appended via existing `updateMessageWhisperActions` helper)
   - A new `whisper_feed` row (lightweight notification table) for cross-conversation visibility
2. Delivery:
   - **During active conversation**: client maintains a persistent SSE connection to `/api/whispers/stream` filtered to current conversation. Backend pushes new whisper events.
   - **Across conversations**: same SSE connection (when subscribed unfiltered) receives all user's whispers — used by always-on agent clients.
   - **Fallback**: `GET /api/whispers?since=<ts>` for clients that can't hold SSE open. Used by mobile background sync.
   - **On reload of a conversation**: messages load with their late-appended `whisper_actions`, no special handling needed.

This is the standard chat-app pattern (Slack/Discord style), and it works identically across web/mobile/CLI/agent clients.

---

## Phases

Each phase ships independently. v1 stays runnable until Phase 7 cutover. The `SAGE_WIKI_ENABLED` flag gates the new code path.

### Phase 0 — Safety net

**Goal:** Branch isolation + kill switch.

**Tasks:**
1. Tag current `master` as `sage-v1-pre-wiki`; push tag.
2. Create branch `wiki-migration` from that tag. All subsequent phases land via PRs on this branch.
3. Add env flag `SAGE_WIKI_ENABLED` (default `false`) read in a new helper `packages/server/src/config/flags.ts`. All new code paths route through `isWikiEnabled()`.
4. Document parallel-run in README: how to run v1 + wiki-migration on separate ports with separate Postgres schemas for A/B testing.

**Files:** `packages/server/src/services/chat.ts`, `README.md`, `.env.example`, new `packages/server/src/config/flags.ts`
**Schema:** none
**Whispers:** none
**Risks:** feature flag drift — mitigated by single helper.

---

### Phase 1 — Wiki storage substrate

**Goal:** R2 + Postgres foundation for the wiki. No agent logic yet.

**Tasks:**
1. Migration `NNNN_wiki_core.sql` adds tables: `wiki_pages`, `wiki_links`, `wiki_page_versions`, `wiki_log`, `wiki_deferred_ops`.
2. `wiki/layout.ts` — R2 path constants, `slugify()`, path validators.
3. `wiki/store.ts` — file CRUD methods. Every write:
   - Hash body (sha256) → if unchanged, no-op
   - R2 PUT first (R2 is source of truth)
   - Insert `wiki_page_versions` row referencing prior body
   - Upsert `wiki_pages` row
   - Parse markdown via `wiki/markdown.ts`; reconcile `wiki_links`
   - Emit `WikiEvent` (consumed by whisper layer in Phase 5)
   - Append `wiki_log` row
4. `wiki/markdown.ts` — markdown parser extracting `[[wikilinks]]`, frontmatter, provenance markers.
5. `wiki/cache.ts` — per-job local working cache under `os.tmpdir()/sage-wiki/<conv>/<turn>/`. Lazy pull on read; flush back to R2 on finalize. Cleanup in `finally`. Worker startup janitor purges stale temp dirs.
6. `wiki/bootstrap.ts` — on first enabled run, write default `SCHEMA.md` + empty `index.md` if missing.
7. Register pg-boss queues `wiki-migrate`, `wiki-curate-page` (handlers stubbed).
8. Add `wiki/events.ts` — typed event emitter for `WikiEvent` (page_created, page_updated, page_deleted, link_added, link_removed, rename).
9. Add basic CRUD API routes (read-only, no auth changes yet): `GET /api/wiki/pages`, `GET /api/wiki/pages/:path`, `GET /api/wiki/log`, `GET /api/wiki/links`, `GET /api/wiki/autocomplete`.

**Files:** `packages/server/src/jobs/{boss,worker}.ts`, `packages/server/src/api/router.ts`
**New files:** `packages/server/src/services/wiki/{layout,store,cache,bootstrap,events,markdown}.ts`, `packages/server/src/api/wiki.routes.ts`, migration `NNNN_wiki_core.sql`
**Whispers:** events emitted, not yet rendered
**Risks:** R2 write failure leaving PG orphaned → R2-first commit order + Phase 8 reconciliation job. Hash collisions ignored (sha256 sufficient). Cache cleanup on crash → janitor on worker startup.

---

### Phase 2 — Wiki maintainer agent loop

**Goal:** Replace per-turn extraction chain with the wiki maintainer.

**Tasks:**
10. Move legacy services to `packages/server/src/services/_legacy/`: `extraction.ts`, `triage.ts`, `dedup.ts`, `consolidation.ts`, `memory.ts`, `knowledge.ts`, `orphans.ts`. Also move their prompts. They still compile/run when `SAGE_WIKI_ENABLED=false`.
11. `wiki/maintainer.ts` implementing three operations as a class:
    - **`ingestTurn({conversationId, userMessage, assistantMessage})`** — loads `SCHEMA.md` + `index.md`, asks model for a JSON plan: `{wikiOps: [...], facts: [...]}`. Single call by default; design supports splitting into two calls (`extractWikiOps` + `extractFacts`) as a fallback if quality suffers (architecture must not block this).
    - **`queryForContext({conversationId, query})`** — called before `provider.chatStream` at `chat.ts:197`. Loads `index.md`, asks model for relevant page paths, pulls bodies, concatenates (token budget). Uses `wiki_maintenance` role model.
    - **`lintPage(path)`** — stub here; implemented in Phase 8.
12. New prompts under `packages/server/src/prompts/wiki/{ingest,query,lint}.ts`. Lifted from Hermes' `llm-wiki` SKILL.md, rewritten against our SCHEMA. Enforce: min 2 outbound links per new page, frontmatter shape, lowercase-hyphen filenames, provenance markers.
13. Wire into chat:
    - `services/chat.ts` `finishTurn()`: replace `extractAfterTurn` call with `await boss.send('wiki-ingest-turn', {conversationId, userMessageId, assistantMessageId})`.
    - `services/chat.ts` near system prompt assembly (lines 72–153): before assembly, **await any pending `wiki-ingest-turn` job for the conversation with a 5-second timeout fallback** (decision #9). Then call `maintainer.queryForContext` to get pages to inject.
14. Handler `packages/server/src/jobs/handlers/wiki-ingest-turn.ts` calls `maintainer.ingestTurn` and applies the plan via `store.writePage` etc.
15. Cap maintainer at **10 ops/turn**; excess inserted into `wiki_deferred_ops` with a single summary whisper "N changes queued for review".

**Files:** `packages/server/src/services/chat.ts`, `packages/server/src/jobs/{boss,worker}.ts`
**New files:** `packages/server/src/services/wiki/maintainer.ts`, `packages/server/src/prompts/wiki/{ingest,query,lint}.ts`, `packages/server/src/jobs/handlers/wiki-ingest-turn.ts`
**Moved to _legacy:** `extraction.ts`, `triage.ts`, `dedup.ts`, `consolidation.ts`, `memory.ts`, `knowledge.ts`, `orphans.ts` + their prompts
**Schema:** none new (uses Phase 1 tables)
**Whispers:** events emitted; UI wires in Phase 5
**Risks:** model proposes destructive plan → 10-op cap. Query-for-context latency on cold cache → keep `index.md` always in memory, refresh on write. Single combined call quality → split-friendly architecture.

---

### Phase 3 — mem0 integration

**Goal:** Replace `memory_entries` with mem0 as the fact tier. Introduce **new Facts page** (decision #10).

**Tasks:**
16. `npm install mem0ai` in `packages/server`. Pin to specific version.
17. **Inspect mem0's DDL in dev**. Capture all CREATE statements it would auto-generate. Commit them as Sage migration `NNNN_mem0_schema.sql`. Configure mem0 with auto-create disabled.
18. Verify pgvector extension is present (add `NNNN_pgvector.sql` if not). pgvector status confirmed during Phase 1 implementation.
19. `services/facts/mem0Client.ts` — wrapper around mem0 SDK configured for Sage's Postgres + pgvector + `fact_extraction` role model. Exposes `add(userId, text, metadata)`, `search(userId, query, k)`, `update(factId, ...)`, `delete(factId)`, `list(userId, filter)`, `getById(factId)`. Every call emits a `FactEvent`.
20. `maintainer.ingestTurn` returns `{wikiOps, facts}`; facts are passed to `mem0Client.add`.
21. **New page**: `packages/client/src/pages/Facts.tsx` — uses mem0's native shape directly (no synthesis wrapper). Lists facts, search, edit, delete. Surfaces metadata.
22. New API routes: `GET /api/facts`, `GET /api/facts/search`, `GET /api/facts/:id`, `PATCH /api/facts/:id`, `DELETE /api/facts/:id`. Backed by `mem0Client`.
23. **Memory.tsx stays as-is**, read-only view of legacy `memory_entries`. Banner indicates "Legacy memory — retiring at cutover; new facts on the Facts page". Phase 7 removes Memory.tsx entirely.

**Files:** `packages/server/src/services/wiki/maintainer.ts`, `packages/server/src/api/router.ts`, `packages/client/src/pages/Memory.tsx`
**New files:** `packages/server/src/services/facts/{mem0Client,events}.ts`, `packages/server/src/api/facts.routes.ts`, `packages/client/src/pages/Facts.tsx`, migration `NNNN_mem0_schema.sql`, possibly `NNNN_pgvector.sql`
**Schema:** mem0 tables (committed by us), possibly pgvector enable
**Whispers:** events emitted; UI in Phase 5
**Risks:** mem0 SDK breaking changes → pin version, vendor types. mem0 latency in hot path → runs in same pg-boss job as wiki ingest, off the chat critical path.

---

### Phase 4 — Per-role model settings + personal access tokens

**Goal:** Multi-role model assignment; token-based auth for non-web clients.

**Tasks:**
24. Migration `NNNN_user_settings_roles.sql` adds three JSONB columns to `user_settings`: `chat_model`, `wiki_maintenance_model`, `fact_extraction_model` (`{provider, model}` or null = inherit primary).
25. Migration `NNNN_personal_access_tokens.sql` adds `personal_access_tokens` table.
26. `services/settings/roleModel.ts` — `resolveRoleModel(userId, role)` returns explicit binding or falls back to primary. Validates user has credentials for resolved provider; throws `MissingCredentialsForRoleError` otherwise.
27. `services/auth/tokens.ts` — `issueToken(userId, name)`, `verifyToken(rawToken)`, `revokeToken(id)`. Token format: `sage_pat_<random>`. Hashed at rest. Raw value returned once on creation.
28. Auth middleware extended: accepts `Authorization: Bearer <token>` in addition to existing cookie-session. Both populate `req.user.id`.
29. Plumb role resolution through: `chat.ts` (uses `chat`), `maintainer.ts` (uses `wiki_maintenance`), `mem0Client.ts` (uses `fact_extraction`).
30. API routes: `GET /api/settings/tokens`, `POST /api/settings/tokens`, `DELETE /api/settings/tokens/:id`.
31. Extend `GET/PUT /api/settings` with the three role fields.
32. **Settings UI** (`packages/client/src/pages/Settings.tsx`):
    - New "Model assignments" section: single Primary model selector + three checkboxes ("Use for chat", "Use for wiki maintenance", "Use for fact extraction" — all checked by default). Unchecking a box reveals an inline secondary selector for that role. Matches both Minimax-one-model and Claude-split patterns without forcing complexity.
    - New "Personal access tokens" section: list (name, last used, revoke); create form returns raw token once with copy-to-clipboard and "you won't see this again" warning.
33. Document token usage in README: how to set `Authorization: Bearer sage_pat_...` from CLI/mobile/agent clients.

**Files:** `packages/server/src/api/settings.routes.ts`, `packages/server/src/middleware/auth.ts`, `packages/server/src/services/chat.ts`, `packages/server/src/services/wiki/maintainer.ts`, `packages/server/src/services/facts/mem0Client.ts`, `packages/client/src/pages/Settings.tsx`, `README.md`
**New files:** `packages/server/src/services/settings/roleModel.ts`, `packages/server/src/services/auth/tokens.ts`, migrations `NNNN_user_settings_roles.sql`, `NNNN_personal_access_tokens.sql`
**Whispers:** none
**Risks:** user splits roles to provider with no credentials → `MissingCredentialsForRoleError` surfaces as chat-time whisper "Wiki maintenance model unavailable — using primary".

---

### Phase 5 — Whisper expansion

**Goal:** New whisper kinds for wiki + fact ops; delivery layer for async whispers.

**Tasks:**
34. Extend `packages/shared/src/types/whisper.ts` `WhisperAction` union with new kinds:
    - `view_wiki_page` (payload: `{path, versionId?}`)
    - `undo_wiki_edit` (payload: `{path, versionId}`)
    - `wiki_page_created` (payload: `{path, title}`)
    - `wiki_page_updated` (payload: `{path, summary}`)
    - `wiki_page_deleted` (payload: `{path}`)
    - `wiki_link_added` (payload: `{source, target}`)
    - `view_fact` (payload: `{factId}`)
    - `undo_fact` (payload: `{factId}`)
    - `review_deferred_ops` (payload: `{count}`)
35. Subscribers in `wiki/events.ts` and `facts/events.ts` write `whisperActions` into the relevant message via a new `appendMessageWhisperActions(messageId, actions)` method in `messages.ts` (extends the existing `updateMessageWhisperActions`). For background-initiated events (lint, reconciliation), insert into `whisper_feed` (new table — added in Phase 5 migration).
36. Migration `NNNN_whisper_feed.sql` adds `whisper_feed`:
    ```
    id, user_id, conversation_id null, kind, payload jsonb, display_summary,
    actions jsonb, created_at, dismissed_at null
    ```
37. Extend `services/whisper-actions.ts` handler with cases for new kinds:
    - `undo_wiki_edit` → restore prior R2 body via `store.writePage` with `author='user', reason='undo'` and the prior version's body.
    - `undo_fact` → `mem0Client.delete(factId)`.
    - `view_*` → read-only, no handler action beyond marking viewed.
    - `review_deferred_ops` → opens Wiki page with deferred-ops drawer.
38. **Async delivery infrastructure:**
    - New SSE endpoint `GET /api/whispers/stream` — long-lived; pushes new `whisper_feed` rows for the authenticated user (filtered by `?conversationId=` optional).
    - New polling endpoint `GET /api/whispers?since=<ts>` — for clients without persistent SSE.
    - Extend `Chat.tsx` to subscribe to `/api/whispers/stream?conversationId=<current>` on mount; whisper events render in-message via `WhisperActions.tsx` (extended).
39. New `packages/client/src/components/wiki/WikiPageModal.tsx` — markdown rendering, frontmatter display, version list, in-modal wikilink navigation (clicking `[[link]]` opens that page).
40. Extend `EntryViewerModal.tsx` minimally to handle `view_fact` payload shape.
41. SSE: new chunk type `wiki_progress` in `packages/shared/src/types/sse.ts` for live op streaming during maintainer's run when client is connected to `/api/whispers/stream` for the active conversation.

**Files:** `packages/shared/src/types/{whisper,sse,message}.ts`, `packages/server/src/services/{whisper-actions,messages}.ts`, `packages/server/src/services/wiki/events.ts`, `packages/server/src/services/facts/events.ts`, `packages/server/src/api/{whispers,wiki}.routes.ts`, `packages/client/src/components/chat/WhisperActions.tsx`, `packages/client/src/pages/Chat.tsx`
**New files:** `packages/client/src/components/wiki/WikiPageModal.tsx`, migration `NNNN_whisper_feed.sql`
**Whispers:** 9 new kinds (listed in task 34)
**Risks:** whisper backlog (>3 ops on a message) → UI aggregates as "Updated N wiki pages — view changes" expander. SSE connection lifecycle on tab close → standard EventSource handling.

---

### Phase 6 — Wiki editing UI

**Goal:** Direct user editing of the wiki.

**Tasks:**
42. New page `packages/client/src/pages/Wiki.tsx`:
    - Left: file tree grouped by entities/concepts/comparisons/queries/raw
    - Center: page viewer (rendered markdown) with edit toggle
    - Right: version list + recent log entries
    - Backend-driven data only; no client-side wiki logic
43. **Backend-completes API routes** (mostly delivered in Phase 1; remaining):
    - `PUT /api/wiki/pages/:path` (user edit; requires `If-Match: <content-hash>`; 409 on mismatch returns both bodies for client merge UI)
    - `DELETE /api/wiki/pages/:path` (soft delete)
    - `POST /api/wiki/pages/:path/restore/:versionId`
    - `POST /api/wiki/pages/:path/rename` — server handles transactional rewrite:
      - Set `wiki_pages.rename_in_progress = true`
      - Query `wiki_links` for all inbound
      - For each inbound page: pull body from R2, rewrite link text, PUT body back, update `wiki_links`
      - Clear `rename_in_progress` flag
      - On crash: `wiki-rename-reconcile` job (Phase 8) detects stale flag and completes/rolls back
    - `GET /api/wiki/schema` / `PUT /api/wiki/schema`
44. Editor: integrate **CodeMirror 6** with markdown mode (already lightweight; widely used).
45. **Wikilink autocomplete**: client calls `GET /api/wiki/autocomplete?q=<text>` (debounced 200ms). Backend returns ranked matches from `wiki_pages` (title + path FTS).
46. Add Wiki nav entry to main app shell.
47. User saves emit the same whisper kinds as LLM saves (`author='user'`). Visual treatment in UI distinguishes user vs LLM authorship.
48. Markdown rendering: client-side via `marked` or similar lightweight library. Server returns raw markdown. (For thin clients: optional `?render=html` query param triggers server-side render via `markdown-it`.)

**Files:** `packages/server/src/api/wiki.routes.ts`, main app router, package additions
**New files:** `packages/client/src/pages/Wiki.tsx`, `packages/client/src/components/wiki/{Editor,Tree,VersionList,Renderer}.tsx`
**Schema:** none
**Whispers:** reuses Phase 5 kinds
**Risks:** concurrent user+LLM edit → optimistic concurrency via `If-Match`; mismatch returns 409 with both versions for client merge UI. Rename atomicity → `rename_in_progress` flag + reconciliation job.

---

### Phase 7 — Migration cutover

**Goal:** One-shot data migration, retire legacy code paths.

**Tasks:**
49. Fill in `packages/server/src/jobs/handlers/wiki-migrate.ts`:
    - For each `knowledge_pack` → create wiki folder. Heuristic on pack name decides `entities/` (named after a person/project/tool) vs `concepts/` (topical). User can move via `POST /api/wiki/pages/:path/rename` after.
    - For each `knowledge_chunk` → wiki page with frontmatter (title from filename, tags from pack name, sources from chunk metadata, provenance `^[raw/imports/<original-file>]`).
    - Raw uploaded files copied into `raw/imports/`.
    - For each `memory_entry` → `mem0Client.add` preserving created_at, type, key as metadata.
    - For each `orphan_extraction` → wiki page under `queries/unfiled/`.
    - **Dry-run mode by default**: writes a report to a `wiki_migration_report` table without touching R2/mem0. Commit mode requires explicit flag.
50. `POST /api/wiki/migrate` — **owner-only** check: compare `req.user.github_id` against `OWNER_GITHUB_ID` env var; reject otherwise. Body: `{mode: 'dry-run'|'commit'}`. Progress via SSE on `/api/whispers/stream`.
51. After successful commit-mode migration:
    - Flip `SAGE_WIKI_ENABLED=true` permanently (remove flag-gated branches in subsequent cleanup).
    - Remove `extractAfterTurn`-related code from `chat.ts`.
    - **Do NOT delete `_legacy/` directory yet** — gated on 30-day stable operation window (decision #13).
52. Remove `Memory.tsx` and its route; `Facts.tsx` becomes the only memory-related page.
53. **30 days post-cutover:**
    - Migration `NNNN_drop_legacy_knowledge.sql` drops `knowledge_packs`, `knowledge_files`, `knowledge_chunks`, `memory_entries`, `memory_entry_versions`, `orphan_extractions`, `summary_entries`, `conversation_knowledge_packs`.
    - Delete `_legacy/` directory.
    - Delete legacy prompts.
    - Delete `Knowledge.tsx`.
    - Delete legacy memory/knowledge API routes.
54. README: complete architecture rewrite reflecting the wiki-paradigm system.

**Files:** `packages/server/src/jobs/handlers/wiki-migrate.ts`, `packages/server/src/api/wiki.routes.ts`, `packages/server/src/services/chat.ts`, `README.md`, eventual cleanup
**Schema:** `NNNN_drop_legacy_knowledge.sql` (after 30-day window)
**Whispers:** `wiki_migration_complete` summary on first chat after migration
**Risks:** data loss → dry-run mandatory; `sage-v1-pre-wiki` tag fully working rollback. Heuristic mis-classification (entity vs concept) → user can rename via Phase 6 UI.

---

### Phase 8 — Long-term hygiene

**Goal:** Autonomous wiki upkeep over months/years.

**Tasks:**
55. `wiki-lint` weekly pg-boss cron:
    - Scan `wiki_links` for broken targets (target_page_id null)
    - Scan `wiki_pages` for orphans (no inbound links)
    - Flag staleness (no updates in N days; configurable)
    - Run `maintainer.lintPage` on flagged pages
    - Emit a digest whisper "Wiki lint: 3 broken links, 2 orphans, 5 stale pages — review?" attached to next chat turn
56. `wiki-rename-reconcile` job (triggered hourly): finds `wiki_pages.rename_in_progress=true` older than 10 minutes; completes pending R2 link rewrites or rolls back.
57. Embeddings: new migration `NNNN_wiki_embeddings.sql` adds `wiki_embeddings` table (page_id, embedding vector). Populate on every page write. Extend `GET /api/wiki/search` to blend FTS + vector.
58. Wiki version history UI: diffs between versions via `diff` library; surfaced in `WikiPageModal`.
59. Reconciliation job: scans `wiki_pages.r2_key` against R2 listing; flags missing objects; attempts restore from `.versions/`.
60. **Cost ceiling** integration: pg-boss jobs check budget (via existing Usage service) before each LLM call. On ceiling hit: park ops in `wiki_deferred_ops` with status `pending`, fire "budget reached — N deferred ops" whisper.

**Files:** new handlers under `packages/server/src/jobs/handlers/`, `packages/server/src/services/wiki/search.ts`, `packages/server/src/api/wiki.routes.ts`, search UI in Wiki.tsx
**New files:** `wiki-lint.ts`, `wiki-rename-reconcile.ts`, `wiki-reconcile-r2.ts` handlers, migration `NNNN_wiki_embeddings.sql`
**Whispers:** `wiki_lint_digest`, `wiki_reconciliation_alert`
**Risks:** lint cost on large wikis → batched + budgeted. Embedding cost → only on write, deferred to async job.

---

## Edge Cases (consolidated)

| Case | Handling |
|---|---|
| R2 unavailable during write | `store.ts` fails loudly; no PG row inserted (R2-first order). pg-boss retries. User sees "couldn't save, retrying" whisper. |
| R2 unavailable during read (queryForContext) | Fall back to last-cached `index.md` in memory; if cold, skip context with logged warning. |
| mem0 API errors | Fact tier degrades; wiki ingest proceeds. Retries in pg-boss; persistent failure → whisper. |
| User+LLM page edit collision | `If-Match: <content-hash>` on PUT; mismatch returns 409 with both bodies for client merge UI. |
| SCHEMA drift | Maintainer re-reads SCHEMA at top of every run; bad SCHEMA degrades plan quality but doesn't crash. Lint pass flags violations. |
| Wikilink rot on rename | `rename_in_progress` flag on `wiki_pages` row; `wiki-rename-reconcile` job (Phase 8) recovers stalls. |
| Migration failures | Dry-run mandatory before commit; per-batch checkpoints; resumable. |
| Missing role credentials | `MissingCredentialsForRoleError` → chat-time whisper "X model unavailable — using primary". |
| Cost ceiling mid-maintenance | Pre-call budget check; defer ops to `wiki_deferred_ops`; whisper. |
| Whisper backlog (>3 ops per turn) | UI aggregates as "Updated N pages — view changes" expander. |
| Cache staleness on concurrent turns | Cache is per-job (not per-conversation); final R2 write is merge point. Hash check at write time catches conflicts. |
| mem0 schema collisions | Inspect mem0 DDL in dev, commit explicitly, disable auto-create. |
| Hash collisions (identical content) | By design no-op — no version row, no whisper. |
| Versions table unbounded growth | Keep last 50 per page in PG; older archived to R2 cold path with summary row retained. |
| Async whisper while user on different conversation | `whisper_feed` row + persistent SSE for cross-conversation visibility + visible on conversation reload. |
| Fast-typist follow-up before wiki ingest completes | Await pending `wiki-ingest-turn` job for prior message with 5s timeout (decision #9). |
| Legacy Memory page during transition | Read-only with banner; retired at Phase 7. New Facts page in Phase 3 (decision #10). |
| Personal access token compromise | Single-shot reveal at creation; hashed at rest; revocable from Settings. |
| Owner-only migration endpoint | `OWNER_GITHUB_ID` env var check (decision #14). |
| Combined wikiOps+facts LLM call quality | Architecture supports splitting into two calls as fallback (single-call by default). |

---

## Out of Scope

- Multi-user support (single-user assumption baked in; R2 path namespacing leaves the door open)
- Real-time collaborative editing of wiki pages
- LLM-driven mass restructuring (per-page lint only)
- Replacing GitHub OAuth for web
- Replacing the credential encryption layer
- Replacing the provider abstraction
- Replacing the conversation/messages data model
- Git-backed wiki versioning (we use Postgres version rows + R2 object copies)
- Importing wiki content from external second-brain tools (Obsidian/Logseq/Notion) — possible future enhancement
- Mobile-specific wiki editor optimizations (the API is mobile-ready; the React app is desktop-first)
- Public sharing of wiki pages
- Plugin/extension system for wiki operations
- Real-time agent-watching-the-wiki features (always-on agent client is enabled by the backend-first design but not built in this rebuild)

---

## Needs Verification Before Implementation

These are open questions the implementation agent (or the user) needs to resolve at phase start:

1. **Migration numbering** — current latest migration number in `packages/server/src/db/migrations/` (confirms `NNNN_` numbering).
2. **pgvector presence** — is it already enabled in Sage's Postgres? If yes, skip the pgvector migration.
3. **mem0 TS SDK Postgres+pgvector adapter maturity** — verify production-readiness in dev before Phase 3 commits. Fallback: separate mem0 datastore if its Postgres adapter is unreliable.
4. **Existing R2 client wrapper location** — Sage uses R2 for blobs; confirm the wrapper path so `wiki/store.ts` doesn't create a duplicate S3 client.
5. **`updateMessageWhisperActions` semantics** — confirm it supports post-stream late-append cleanly; if not, may need an `appendMessageWhisperActions` variant.
6. **Budget enforcement vs reporting** — does Usage service currently enforce a hard ceiling or just report? Phase 8 needs a cheap pre-check helper if only reporting.
7. **Markdown editor library** — CodeMirror 6 proposed; user can override (Milkdown, Lexical, plain textarea).
8. **`AGENTS.md` / `MEMORY.md` docs** — currently served via `/api/docs/:filename`. Recommend keeping separate (they're meta-config, not knowledge); don't migrate into wiki.
9. **mem0 version pin** — pick a known-stable version before Phase 3.

---

## Rollback Story

- **During Phase 0–6**: `SAGE_WIKI_ENABLED=false` reverts to v1 behavior; both paths coexist.
- **Phase 7 cutover**: tag `sage-v1-pre-wiki` remains a fully functional v1 deployment target. `_legacy/` directory still in tree for 30 days.
- **Post-cutover, before 30-day window expires**: rollback = redeploy from tag + restore Postgres backup taken before cutover; R2 wiki data remains for potential re-migration.
- **Post-30 days**: legacy tables and code deleted. Rollback now requires either re-implementing from the tag or operating on the wiki-paradigm system going forward.
- **Per-phase rollback**: each phase ships as a discrete PR; revert the PR.

---

## Glossary

- **Wiki maintainer** — the LLM-driven loop that ingests turns into wiki pages, queries the wiki for context, and lints. Lives in `services/wiki/maintainer.ts`.
- **Wiki op** — a single change proposed by the maintainer: create/update/delete page, add/remove link.
- **Deferred op** — a wiki op beyond the per-turn cap, queued in `wiki_deferred_ops` for user review.
- **Receipt loop** — feeding "what was just saved" back into the model's next-turn context to prevent hallucinated saves. Implemented via `index.md` + recent `log.md` entries being available to `queryForContext`.
- **Role** — `chat`, `wiki_maintenance`, or `fact_extraction`. Each can have its own model binding.
- **Personal access token** — long-lived bearer token issued from Settings for non-web clients. Format: `sage_pat_<random>`.
- **Fact** — a structured assertion stored in mem0 (e.g. "user lives in Sydney", "user prefers Haiku for cheap operations").
- **Wiki page** — a markdown file under `wiki/<user_id>/` with frontmatter, body, and optional `[[wikilinks]]`.
- **Provenance marker** — `^[raw/articles/source.md]` syntax linking a page assertion to its raw source.
- **Whisper** — user-visible save-transparency notification with displaySummary and zero or more actions (view, undo, dismiss).
- **Cutover** — Phase 7 event: flip flag permanently, migrate data, retire legacy code paths.

---

## Phase Sequencing Summary

```
0 (safety net)
   ↓
1 (storage substrate) ─────────────────────────┐
   ↓                                            │
2 (maintainer; replaces extraction chain)      │
   ↓                                            │
3 (mem0 + Facts page)                          │
   ↓                                            │
4 (per-role models + access tokens)            │
   ↓                                            │
5 (whisper expansion + async delivery)         │
   ↓                                            │
6 (wiki editing UI)                            │
   ↓                                            │
7 (migration cutover) ◄────────────────────────┘
   ↓
8 (long-term hygiene; ongoing)
```

Phases 1–6 each leave the system in a working state with `SAGE_WIKI_ENABLED=true` partially exercised in dev. Phase 7 is the irreversible-ish event (30-day rollback window still open). Phase 8 is open-ended; tasks shippable independently.

---

**End of plan.**
