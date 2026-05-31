# Sage

**One elegant interface. Any LLM. Anytime.**

Sage is a cost-optimized, provider-agnostic LLM chat interface. Switch between OpenAI, Anthropic (Claude), Minimax, and future providers without losing conversation history, agent files, or memory documents.

---

## Features

- **Multi-Provider Support** — OpenAI, Anthropic (Claude), Minimax; plug in new providers with one file
- **Per-Conversation Model Picker** — Switch model mid-conversation without changing your global default; choice persists per conversation
- **Persistent History** — Conversations and messages stored in PostgreSQL
- **Per-User Encrypted Credentials** — API keys AES-256-GCM encrypted at rest; each user's keys are independent
- **GitHub OAuth** — No passwords; login with your GitHub account
- **SSE Streaming** — Responses stream in real-time
- **Persistent Memory** — Sage learns about you over time: AGENTS.md (editable instructions), structured memory entries with full edit history, conversation summaries (capped at 20)
- **Whisper Messages** — Memory updates appear inline in chat as subtle ambient notes
- **Audit Logging** — All credential operations logged immutably
- **Cost Tracking** — Per-message cost, per-conversation total, monthly usage dashboard with daily chart, provider/model breakdown, top conversations, and CSV export
- **Soft Monthly Budget** — Optional cap with a single in-chat whisper warning when crossed
- **Conversation Import** — Import chat history from ChatGPT (.zip) and Claude.ai (.json) exports; conversations are archived and used to seed structured memory
- **Knowledge Packs** — Named document collections per user. Upload PDFs, Markdown, text, DOCX, CSV, JSON, and source-code files (up to 100 MB each); Sage indexes them with full-text search (FTS via Postgres GIN, pgvector planned). How packs work:
  - **Attached packs** (retrieval) — attach a pack via the chat header picker; Sage auto-injects relevant chunks into the system prompt for every turn (top-8 chunks, ~12,000-character cap).
  - **Talk to Sage** (from `/knowledge`) — creates a conversation with the pack attached and `auto_extract: true`, plus a context-aware opener message. Subsequent turns silently extract to the pack without prompting.
  - **Unified extraction pipeline** — after every assistant turn, a single triage LLM call classifies what (if anything) is worth capturing and where: general memory, an existing pack, or an "orphan" bucket for unclassified domain content. No bound-conversation concept remains.
  - **Pack-literacy system block** — every conversation system prompt now includes a concise description of the user's packs and a reminder that capture is automatic, so Sage never claims to "save" or "file" content itself.
  - **Per-pack dedup** — before inserting a chunk into an existing pack, Sage checks the 10 most-recent chunks for semantic overlap and skips if the candidate is a duplicate.
  - **Orphan consolidation** — substantive notes that don't match any existing pack accumulate as "orphans". When ≥ 5 orphans share a topic, a consolidation LLM pass proposes a pack name and description, and a whisper offers to create the pack.
  - **Whisper actions** — whispers carry `WhisperAction[]` buttons with snake_case `kind` values: `add_to_pack`, `create_pack`, `always_extract_to_pack`, `undo_extraction`, `undo_memory`, `undo_orphan`, `view_entry`, `dismiss`. Each button can be greyed out after use via `consumedAt`; other buttons remain clickable. `view_entry` is handled client-side and opens a modal showing the just-saved memory entry or knowledge chunk.
  - **Pack entry browser** — the Knowledge page right column has Files / Entries tabs; the Entries tab lists every `knowledge_chunk` in the selected pack, styled like memory cards.
- **Pixel Art UI** — Muted forest tones with vibrant green accents; Sage avatar reacts to state

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, React Router 6, Zustand (state), Vite |
| **Backend** | Express, TypeScript, pg (PostgreSQL pool) |
| **Auth** | GitHub OAuth via `cookie-session` |
| **Encryption** | AES-256-GCM (`node:crypto`) |
| **LLM Streaming** | Server-Sent Events (SSE) |
| **Object Storage** | Postgres BYTEA-backed (`storage_blobs` table in production; local disk in dev) |
| **Deployment** | Single Express serve; client built into `/public` |

---

## Prerequisites

- Node.js 20+
- PostgreSQL 14+ (or a hosted provider like Supabase, Neon, Render, Heroku)
- GitHub OAuth App ([create one](https://github.com/settings/developers))
- Docker Desktop — required for the SearXNG container that powers `web_search`. Without it, chat still works but web tools are disabled.
  - **Windows**: `winget install -e --id Docker.DockerDesktop` (then launch Docker Desktop once to accept terms and let it initialise the WSL2 backend)
  - **macOS**: `brew install --cask docker`
  - **Linux**: [official install guide](https://docs.docker.com/engine/install/)

---

For production deployment to Heroku, see the Deploy section below.

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/cameronbeck-dev/sage-llm.git
cd sage-llm
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```env
DATABASE_URL=postgresql://localhost:5432/sage
PORT=3001

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=<32+ random bytes>

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# REQUIRED in production. Optional in dev (credential ops will fail without it).
SAGE_ENC_KEY=<64 hex chars>

GITHUB_CLIENT_ID=<from GitHub OAuth App>
GITHUB_CLIENT_SECRET=<from GitHub OAuth App>
OAUTH_REDIRECT_URI=http://localhost:3001/api/auth/github/callback

CLIENT_URL=http://localhost:5173

DEFAULT_PROVIDER=openai
DEFAULT_MODEL=gpt-4o-mini

# Optional — leave empty to disable Sentry error reporting
SENTRY_DSN=
VITE_SENTRY_DSN=
```

### 3. Create GitHub OAuth App

1. Go to **GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App**
2. **Homepage URL**: `http://localhost:5173`
3. **Authorization callback URL**: `http://localhost:3001/api/auth/github/callback`
4. Copy Client ID and Secret into `.env`

### 4. Start Development

```bash
npm run dev
```

This single command starts the SearXNG container (`docker compose up -d searxng`), runs any pending database migrations, and spins up the server and client. Open `http://localhost:5173`.

- **Server**: `http://localhost:3001`
- **Client**: `http://localhost:5173` (Vite dev server with HMR)
- **Worker**: job-queue worker process (optional — restarts independently; exits without killing server/client)

When you're done for the day, shut down the SearXNG container with:

```bash
npm run dev:down
```

### 6. Add Your API Key

1. Open `http://localhost:5173` and log in with GitHub
2. Go to **Settings → API Keys**
3. Enter your provider API key (validated against the real provider before saving)

---

## Project Structure

```
sage/
├── packages/
│   ├── shared/           # Types shared between server and client
│   │   └── src/types/   # Message, Conversation, ModelInfo, ContentBlock
│   ├── server/          # Express API
│   │   └── src/
│   │       ├── api/         # Route handlers (auth, conversations, messages, providers, settings)
│   │       ├── auth/         # GitHub OAuth, session middleware, requireAuth
│   │       ├── crypto/       # AES-256-GCM encrypt/decrypt
│   │       ├── db/           # pg pool, migrations, pool singleton
│   │       ├── providers/    # LLMProvider interface + OpenAI + Anthropic + Minimax implementations
│   │       ├── services/     # Business logic (chat, conversations, messages, settings, credentials, audit)
│   │       ├── middleware/    # Helmet security headers, global error handler
│   │       └── index.ts      # Express app entry, startup, migration
│   └── client/          # React SPA
│       └── src/
│           ├── api/          # SSE client (streamChat.ts)
│           ├── components/   # SageAvatar, MessageBubble, ConfirmModal
│           ├── hooks/        # useSageState (avatar animation + messages)
│           ├── pages/        # Login, Chat, Settings
│           ├── state/         # Zustand stores (auth, conversation, settings)
│           ├── styles/        # CSS tokens, pixel art classes, global styles
│           └── router.tsx    # React Router v6 route definitions
├── scripts/
│   ├── dev.mjs          # Dev runner (concurrently starts server + client)
│   └── postbuild.mjs    # Production build (copies client/dist + migrations to server/dist)
├── .env.example
└── README.md
```

---

## API Routes

All routes require authentication unless noted.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/github` | Redirect to GitHub OAuth |
| `GET` | `/api/auth/github/callback` | GitHub OAuth callback |
| `GET` | `/api/conversations` | List user's conversations |
| `POST` | `/api/conversations` | Create new conversation |
| `GET` | `/api/conversations/:id` | Get conversation + messages |
| `PATCH` | `/api/conversations/:id` | Update title or archived status |
| `DELETE` | `/api/conversations/:id` | Delete conversation |
| `GET` | `/api/conversations/:id/messages` | List messages in conversation |
| `POST` | `/api/conversations/:id/messages` | Send a message (triggers SSE chat stream) |
| `GET` | `/api/providers` | List all providers with models and key status |
| `POST` | `/api/providers/:provider/models` | List models for a specific provider |
| `GET` | `/api/settings` | Get user settings + credential status |
| `PUT` | `/api/settings` | Update active provider/model/theme/role models |
| `PUT` | `/api/settings/credentials/:provider` | Store/encrypt an API key |
| `GET` | `/api/settings/credentials/:provider` | Check if key is stored |
| `DELETE` | `/api/settings/credentials/:provider` | Remove stored key |
| `GET` | `/api/settings/tokens` | List active personal access tokens |
| `POST` | `/api/settings/tokens` | Create a personal access token (raw shown once) |
| `DELETE` | `/api/settings/tokens/:id` | Revoke a personal access token |
| `GET` | `/api/docs/:filename` | Get a memory doc (AGENTS.md, MEMORY.md, SUMMARIES.json) |
| `PUT` | `/api/docs/AGENTS.md` | Update agent instructions (user-editable) |
| `GET` | `/api/usage` | Get usage report for the current or specified period |
| `GET` | `/api/usage/export.csv` | Download daily spend as CSV |
| `GET` | `/api/memory/entries` | List active memory entries |
| `PATCH` | `/api/memory/entries/:id` | Edit a memory entry body |
| `DELETE` | `/api/memory/entries/:id` | Soft-delete (forget) a memory entry |
| `GET` | `/api/memory/entries/:id/history` | Version history for one entry |
| `POST` | `/api/memory/entries/:id/restore` | Restore entry from a prior version |
| `GET` | `/api/memory/history` | Bulk version history (last 500 events) |
| `GET` | `/api/memory/summaries` | List active conversation summaries |
| `DELETE` | `/api/memory/summaries/:id` | Soft-delete a conversation summary |
| `POST` | `/api/imports` | Upload a conversation export (multipart `file`); enqueues a parse job |
| `GET` | `/api/imports` | List the user's imports |
| `GET` | `/api/imports/:id` | Poll an import's status (`uploaded`, `parsing`, `ready`, `committing`, `done`, `failed`) |
| `POST` | `/api/imports/:id/commit` | Commit a parsed import — creates archived conversations and seeds memory |
| `PUT` | `/api/settings/budget` | Set monthly budget cap (USD) |
| `POST` | `/api/account/export` | Download a ZIP of all user data (GDPR export) |
| `DELETE` | `/api/account` | Permanently delete account and all associated data |
| `GET` | `/api/health` | Health check (unauthenticated) |
| `POST` | `/api/whispers/:messageId/actions/:index` | Invoke a whisper action by index (add_to_pack, create_pack, always_extract_to_pack, undo_extraction, dismiss); marks the action consumed and returns the updated message |

---

## Database Schema

Migrations live in `packages/server/src/db/migrations/` and run on startup.

**Key tables:**

- `users` — GitHub OAuth identity
- `user_settings` — active provider, model, theme, `monthly_budget_cents`, `budget_warned_period` per user
- `conversations` — archived flag, timestamps
- `messages` — role, content (JSON), provider/model, token usage, cost; `whisper_actions` (JSONB, nullable) holds `WhisperAction[]` directly (no wrapper object)
- `orphan_extractions` — substantive extraction candidates that don't fit any existing pack; clustered by `suggested_topic`; consolidated at ≥ 5 per topic into a pack-creation whisper
- `credentials` — encrypted API key envelopes per user per provider
- `memory_docs` — per-user legacy blob files: AGENTS.md (still active), MEMORY.md, SUMMARIES.json (superseded by structured tables)
- `memory_entries` — per-user structured memory facts; soft-deleted; tracks source conversation/message
- `memory_entry_versions` — full edit history for each memory entry (triggered by user, LLM, or migration)
- `summary_entries` — per-conversation summaries (max 20 active per user; overflow soft-deleted and facts migrated)
- `imports` — uploaded export metadata (source, filename, R2 key, SHA-256 hash, parse stats, status)
- `welcome_templates` — seeded welcome message content
- `audit_logs` — immutable credential operation audit trail
- `subscription_plans` — plan definitions (free, future paid tiers)
- `user_subscriptions` — per-user active plan with Stripe integration fields
- `usage_meters` — per-user per-period counters (messages, imports, storage)
- `rate_limit_hits` — Postgres-backed rate limit counter store
- `_migrations` — tracks applied SQL files

---

## Importing Conversations

Open **Import** from the user menu (or visit `/import`, or use the teaser card on Settings) to bring in chat history from other assistants.

**Supported formats:**
- **ChatGPT** — request your data from OpenAI and upload the `.zip` (the parser reads `conversations.json` from inside the archive and walks the message tree).
- **Claude.ai** — request your data from Anthropic and upload the `conversations.json` file. The parser also accepts JSONL (one conversation per line) for older exports.

The page sniffs the file's content rather than trusting the extension, so a Claude `conversations.json` won't be misrouted to the generic stub.

**Flow:** upload → parse (asynchronous, status visible via 2-second polling) → preview the parsed conversation count and any per-conversation skips → click **Confirm** to commit. Committing creates archived conversations, summarises each, and extracts persistent facts into structured memory.

**Limits:** 25 MB per file, 20 imports per day per user.

**Re-uploads:** the same file (matched on SHA-256) won't double-import — successful or in-progress rows short-circuit and return the existing import id. **Failed imports** are dropped on re-upload so you can retry after fixing whatever went wrong.

**Sidebar:** imported conversations show an "imported" badge in the sidebar. All conversations are grouped by recency (Today, Yesterday, Previous 7 days, Previous 30 days, Older), and the 3-dot menu shows the last-updated timestamp.

---

## Memory System

Memories are stored as structured rows in `memory_entries`, with edit history in `memory_entry_versions` and conversation summaries in `summary_entries`. The `/memory` page provides entry-level management: edit, forget, restore from history, and source-trace via the **Why?** drawer (links back to the originating conversation). Migration 016 performs the one-time data move from the previous blob storage (MEMORY.md / SUMMARIES.json).

After every assistant response, a unified triage LLM call (`services/extraction.ts`) classifies the last user/assistant exchange. If importance ≥ 3, extracted facts are routed to: general memory (autobiographical facts, preferences), an existing attached pack (with dedup check against the 10 most-recent chunks), or the orphan bucket. A heuristic pre-filter skips the LLM call entirely for very short or pure-acknowledgement messages (< 19 combined words). Each applied memory operation emits a `summary` string that becomes the audit trail. When the summary count exceeds 20, the oldest summaries are soft-deleted and any persistent facts are migrated into memory entries via another LLM pass.

---

## Supported Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo` | API key validated on save |
| **Anthropic** | `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` | Add your Anthropic API key in Settings → API Keys. Older `claude-*-4-5` aliases still resolve and remain billable. |
| **Minimax** | `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`, `MiniMax-M2.5`, `MiniMax-M2.1` | Uses OpenAI-compatible endpoint (`api.minimax.io/v1`); full tool support |

### Adding a New Provider

1. Create `packages/server/src/providers/<provider>.ts` implementing `LLMProvider`:
   ```typescript
   interface LLMProvider {
     readonly id: string;
     readonly displayName: string;
     readonly supportsTools: boolean;
     listModels(creds: ResolvedCredentials): Promise<ModelInfo[]>;
     chatStream(req: ChatRequest, creds: ResolvedCredentials): AsyncIterable<ChatChunk>;
     estimateCost?(model: string, usage: Usage): number;
   }
   ```
   Set `supportsTools: true` if the provider handles the `tools` field in `ChatRequest` and emits `tool_call` chunks.
2. Import and call `registerProvider(yourProvider)` in `packages/server/src/providers/registry.ts`

---

## Deployment

### Deploy to Heroku

The fastest path is the one-click button (uses `app.json`):

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/CammyBeck/personal-llm)

Or manually:

```bash
heroku create my-sage-app
heroku addons:create heroku-postgresql:basic
heroku config:set NODE_ENV=production
heroku config:set NPM_CONFIG_PRODUCTION=false
heroku config:set SAGE_ENC_KEY=$(openssl rand -hex 32)
heroku config:set SESSION_SECRET=$(openssl rand -hex 32)
heroku config:set OPENAI_API_KEY=sk-...
heroku config:set GITHUB_CLIENT_ID=...
heroku config:set GITHUB_CLIENT_SECRET=...
heroku config:set OAUTH_REDIRECT_URI=https://my-sage-app.herokuapp.com/api/auth/github/callback
git push heroku master
heroku ps:scale web=1:basic worker=1:basic
```

Migrations run automatically via the `release` Procfile entry on every deploy.

---

## Security

- **Encrypted Credentials** — API keys encrypted with AES-256-GCM before storage. The plaintext key never touches the DB, logs, or client.
- **SAGE_ENC_KEY Required in Production** — The server refuses to start in production without it.
- **Per-User Keys** — Each user has independent credentials; no shared keys.
- **Audit Trail** — All credential create/update/delete/validation events logged with IP, user agent, timestamp. No secrets in logs.
- **Session Security** — `httpOnly`, `secure` (prod), `sameSite: lax`, 30-day max age.
- **Helmet CSP** — Strict Content-Security-Policy headers; no inline scripts from external origins.

---

## Development

```bash
npm run dev       # Start SearXNG + server (3001) + client (5173) with hot reload
npm run dev:down  # Stop SearXNG container when done
npm run build     # TypeScript compile + Vite client build
npm run migrate   # Run pending SQL migrations manually (also runs automatically on server startup)
npm test          # Run test suite (if configured)
```

---

## Web Tools

Sage supports two agentic web tools available to the LLM during user-facing chat turns:

| Tool | What it does |
|------|--------------|
| `web_search` | Queries a self-hosted SearXNG instance (Google, Bing, DuckDuckGo, Wikipedia engines). Returns titles, URLs, and snippets. |
| `web_fetch` | Fetches a specific URL, extracts readable article text with Mozilla Readability, and returns title + body text. Follows no redirects automatically — returns the redirect target so the model can decide. |

### Search backend

Sage uses [SearXNG](https://searxng.github.io/searxng/) as a self-hosted, privacy-respecting metasearch engine. No third-party search API key is required.

SearXNG starts automatically when you run `npm run dev`. To verify it's up:
```bash
curl 'http://localhost:8080/search?q=test&format=json'
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARXNG_URL` | `http://searxng:8080` | URL of the SearXNG instance |
| `SEARXNG_SECRET_KEY` | `changeme` | SearXNG secret key (set in `searxng-config/settings.yml`) |
| `WEB_FETCH_USER_AGENT` | `Sage/1.0 (+https://sage.local)` | User-agent sent with `web_fetch` requests |
| `WEB_FETCH_TIMEOUT_MS` | `10000` | HTTP timeout for `web_fetch` in milliseconds |
| `WEB_FETCH_MAX_BYTES` | `5000000` | Maximum response body size for `web_fetch` |

### SSRF protection

`web_fetch` resolves hostnames via Node.js DNS before making any request, pins the resolved IP to prevent DNS rebinding attacks, and rejects any IP in private, loopback, link-local, or reserved ranges (both IPv4 and IPv6). The validation uses `ipaddr.js` for range classification rather than regex.

### Provider notes

- **Anthropic / OpenAI / MiniMax** — all have `supportsTools: true`; tools are injected automatically. MiniMax uses its OpenAI-compatible endpoint which handles tool calls natively.

### Citations

When `web_search` or `web_fetch` return results, inline Markdown links appear in the assistant response. A collapsible **Sources** footer is rendered below the message text with deduplicated URLs from all tool calls in that turn.

### Rate limits

30 tool calls per user per tool per 5-minute window. Requests over the limit receive a `tool_call_error: rate_limited` response inline; the conversation continues.

---

## Wiki Rebuild (Parallel Run)

The codebase is mid-rebuild from the current per-turn extraction pipeline to a Karpathy-style wiki + mem0 fact tier. All new wiki code lives on the `wiki-migration` branch and is guarded by the `SAGE_WIKI_ENABLED` env flag (default `false`), so v1 behaviour is unchanged unless you opt in.

### Facts page (Phase 3)

When `SAGE_WIKI_ENABLED=true`, Sage extracts structured facts from every conversation turn and stores them in the `memories` table. Facts are browsable at `/facts` and searchable via full-text. The `/memory` page shows a legacy banner pointing to `/facts`.

**mem0ai dependency:** `packages/server` depends on `mem0ai` (npm). The package is installed and pinned — future phases will use it for intelligent deduplication and entity linking. For Phase 3, Sage owns the storage layer directly (custom Postgres implementation, same schema).

**pgvector requirement:** migration `023_pgvector.sql` runs `CREATE EXTENSION IF NOT EXISTS vector`. Your Postgres instance must have pgvector available:
- **Neon / Supabase / Railway** — enabled by default or as a one-click setting in the dashboard.
- **Render** — enable the `pgvector` extension in the Render Postgres settings.
- **Self-hosted Postgres** — `apt install postgresql-15-pgvector` (or your distro's equivalent), then `CREATE EXTENSION vector;` in psql.
- If pgvector is unavailable, migrations `023_pgvector.sql` and `024_mem0_schema.sql` will fail at startup with a logged error. The server still boots (the migration runner catches and logs), but wiki facts won't work. Install pgvector and restart — migrations will retry and succeed.

**Rollback target:** git tag `sage-v1-pre-wiki` captures the exact state before any wiki changes landed.

**A/B testing v1 vs wiki-migration side-by-side:**

```bash
# Terminal 1 — v1 on port 3001 (main branch, separate DB)
DATABASE_URL=postgresql://localhost:5432/sage_v1 PORT=3001 npm run dev

# Terminal 2 — wiki-migration on port 3002 (wiki-migration branch, separate DB)
DATABASE_URL=postgresql://localhost:5432/sage_wiki PORT=3002 SAGE_WIKI_ENABLED=true npm run dev
```

Each instance needs its own `DATABASE_URL` so migrations don't collide. Both can share the same GitHub OAuth app as long as `OAUTH_REDIRECT_URI` matches the port you're testing. Set `SAGE_WIKI_ENABLED=true` only on the wiki-migration instance.

### Phase 6: Wiki editing UI (`/wiki`)

A full-featured wiki editing interface accessible at `/wiki` (link in the user menu).

- **3-column layout** — page tree (left), editor/viewer (center), versions + activity log (right).
- **Page tree** — all sections (`entities`, `concepts`, `comparisons`, `queries`, `raw`) with collapsible section headers and a "+ New page" form.
- **CodeMirror 6 editor** — `@uiw/react-codemirror` with forest-palette theme, Markdown syntax highlighting, and wikilink autocomplete (`[[` triggers a debounced call to `/api/wiki/autocomplete`).
- **If-Match conflict detection** — saves use the `If-Match` header; a 409 conflict shows a side-by-side merge UI with "Force overwrite" and "Reload theirs" options.
- **Version restore** — right sidebar lists all prior versions; each has a "View" and "Restore" button.
- **Rename with link-rewrite** — renames update all inbound `[[wikilink]]` references atomically; a yellow dot indicates a rename in progress.
- **SCHEMA editor** — top-bar "Edit SCHEMA" button loads `SCHEMA.md` from object storage into the editor for direct editing.
- **New server routes** — `PUT /api/wiki/pages/*`, `DELETE /api/wiki/pages/*`, `POST /api/wiki/pages/*/restore/:versionId`, `POST /api/wiki/pages/*/rename`, `GET /api/wiki/schema`, `PUT /api/wiki/schema`. All guarded by `isWikiEnabled()` and `requireAuth`.

### Phase 4: Per-role models + personal access tokens

Per-role model assignments are now available in **Settings → Model assignments**. Each role (chat, wiki maintenance, fact extraction) defaults to your primary model but can be overridden to any provider/model independently. The resolver falls through: call-time override → conversation preferred model → role assignment → primary.

Personal access tokens (PATs) are available in **Settings → Personal access tokens**. See below for usage.

---

## Personal access tokens

Long-lived bearer tokens for using Sage from a CLI, mobile app, or always-on agent (no browser session required).

**Creating a token**

Go to **Settings → Personal access tokens**, enter a name, and click **Create token**. The raw token is shown once — copy it and store it securely.

**Token format:** `sage_pat_<random>` — tokens are ~52 characters and stored as SHA-256 hashes; the raw value is never stored.

**Using a token**

Pass the token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer sage_pat_..." https://your-sage/api/wiki/pages
```

Bearer auth works on any route that requires auth (`requireAuth` middleware). Cookie session still works normally for browser clients — the two paths coexist.

**Revoking a token**

Click **Revoke** next to the token in Settings, or call `DELETE /api/settings/tokens/:id`. Revocation is immediate and irreversible.

---

## Known Limitations

- **Import commit retries are not idempotent** — if a commit job fails partway through, already-archived conversations remain. Re-uploading after a failure drops the failed row and starts a fresh upload; re-uploading after a successful commit short-circuits and does not re-import.
- **Import rate-limit window is sliding, not calendar-day** — the 20/day limit resets 24 hours after the first request in the window, not at midnight.
- **Anthropic pricing is hardcoded** — model prices in `providers/anthropic.ts` are baked in. Verify against the [official pricing page](https://platform.claude.com/docs/en/about-claude/pricing) when bumping models.

---

## License

MIT