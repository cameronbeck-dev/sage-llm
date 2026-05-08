# Sage

**One elegant interface. Any LLM. Anytime.**

Sage is a cost-optimized, provider-agnostic LLM chat interface. Switch between OpenAI, Minimax, and future providers without losing conversation history, agent files, or memory documents.

---

## Features

- **Multi-Provider Support** — OpenAI, Minimax; plug in new providers with one file
- **Persistent History** — Conversations and messages stored in PostgreSQL
- **Per-User Encrypted Credentials** — API keys AES-256-GCM encrypted at rest; each user's keys are independent
- **GitHub OAuth** — No passwords; login with your GitHub account
- **SSE Streaming** — Responses stream in real-time
- **Persistent Memory** — Sage learns about you over time: AGENTS.md (editable instructions), MEMORY.md (learned facts), SUMMARIES.json (conversation history, capped at 20)
- **Whisper Messages** — Memory updates appear inline in chat as subtle ambient notes
- **Audit Logging** — All credential operations logged immutably
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
| **Deployment** | Single Express serve; client built into `/public` |

---

## Prerequisites

- Node.js 20+
- PostgreSQL 14+ (or a hosted provider like Supabase, Neon, Render)
- GitHub OAuth App ([create one](https://github.com/settings/developers))

---

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

# Object storage: 'local' (dev) or 'r2' (Cloudflare R2)
OBJECT_STORE=local
# Required when OBJECT_STORE=r2:
# R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_BUCKET=
```

### 3. Create GitHub OAuth App

1. Go to **GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App**
2. **Homepage URL**: `http://localhost:5173`
3. **Authorization callback URL**: `http://localhost:3001/api/auth/github/callback`
4. Copy Client ID and Secret into `.env`

### 4. Run Migrations

```bash
npm run migrate
```

Migrations also run automatically on server startup when `DATABASE_URL` is set.

### 5. Start Development

```bash
npm run dev
```

- **Server**: `http://localhost:3001`
- **Client**: `http://localhost:5173` (Vite dev server with HMR)
- **Worker**: job-queue worker process (optional — restarts independently; exits without killing server/client)

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
│   │       ├── providers/    # LLMProvider interface + OpenAI + Minimax implementations
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
| `PUT` | `/api/settings` | Update active provider/model/theme |
| `PUT` | `/api/settings/credentials/:provider` | Store/encrypt an API key |
| `GET` | `/api/settings/credentials/:provider` | Check if key is stored |
| `DELETE` | `/api/settings/credentials/:provider` | Remove stored key |
| `GET` | `/api/docs/:filename` | Get a memory doc (AGENTS.md, MEMORY.md, SUMMARIES.json) |
| `PUT` | `/api/docs/AGENTS.md` | Update agent instructions (user-editable) |
| `POST` | `/api/account/export` | Download a ZIP of all user data (GDPR export) |
| `DELETE` | `/api/account` | Permanently delete account and all associated data |
| `GET` | `/api/health` | Health check (unauthenticated) |

---

## Database Schema

Migrations live in `packages/server/src/db/migrations/` and run on startup.

**Key tables:**

- `users` — GitHub OAuth identity
- `user_settings` — active provider, model, theme per user
- `conversations` — archived flag, timestamps
- `messages` — role, content (JSON), provider/model, token usage, cost
- `credentials` — encrypted API key envelopes per user per provider
- `memory_docs` — per-user memory files: AGENTS.md, MEMORY.md, SUMMARIES.json
- `welcome_templates` — seeded welcome message content
- `audit_logs` — immutable credential operation audit trail
- `subscription_plans` — plan definitions (free, future paid tiers)
- `user_subscriptions` — per-user active plan with Stripe integration fields
- `usage_meters` — per-user per-period counters (messages, imports, storage)
- `rate_limit_hits` — Postgres-backed rate limit counter store
- `_migrations` — tracks applied SQL files

---

## Supported Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo` | API key validated on save |
| **Minimax** | `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`, `MiniMax-M2.5`, `MiniMax-M2.1` | Uses Anthropic-compatible endpoint |

### Adding a New Provider

1. Create `packages/server/src/providers/<provider>.ts` implementing `LLMProvider`:
   ```typescript
   interface LLMProvider {
     id: string;
     displayName: string;
     listModels(creds: ResolvedCredentials): Promise<ModelInfo[]>;
     *chatStream(req: ChatRequest, creds: ResolvedCredentials): AsyncIterable<ChatChunk>;
     estimateCost(model: string, usage: Usage): number;
   }
   ```
2. Import and call `registerProvider(yourProvider)` in `packages/server/src/providers/registry.ts`

---

## Deployment

### Render (Recommended)

1. Create a **Web Service**
2. Set build command: `npm run build`
3. Set start command: `cd packages/server && npm start`
4. Add environment variables from `.env.example`
5. Provision a **Render PostgreSQL** and set `DATABASE_URL`

### Heroku

```bash
heroku create sage-yourname
heroku addons:create heroku-postgresql:standard-0
heroku config:set \
  SESSION_SECRET=<...> \
  SAGE_ENC_KEY=<...> \
  GITHUB_CLIENT_ID=xxx \
  GITHUB_CLIENT_SECRET=xxx \
  OAUTH_REDIRECT_URI=https://sage-yourname.herokuapp.com/api/auth/github/callback \
  CLIENT_URL=https://sage-yourname.herokuapp.com
git push heroku main
```

The `Procfile` runs migrations in the release phase before the web process starts.

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
npm run dev       # Start server (3001) + client (5173) with hot reload
npm run build     # TypeScript compile + Vite client build
npm run migrate   # Run pending SQL migrations
npm test          # Run test suite (if configured)
```

---

## License

MIT