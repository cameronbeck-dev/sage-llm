# Sage

**One elegant interface. Any LLM. Anytime.**

Sage is a cost-optimized, provider-agnostic LLM interface built for flexibility. Switch between OpenAI, Anthropic, Minimax, or any supported provider with a single configuration change. Maintain persistent conversation history, agent files, and memory documents across all your models—just like Claude Code, but for any LLM you choose.

---

## Why Sage?

**Cost Optimization** — Different providers offer different value. Minimax's pricing is currently unbeatable for quality. Switch providers whenever it makes sense, without rebuilding your entire workflow.

**Provider Agility** — The LLM landscape evolves fast. Don't lock yourself into one vendor. Sage lets you experiment with new models the moment they launch, and switch back when you prefer.

**Persistent Memory** — Conversations, agent files, and memory documents persist across all providers. Your context is never lost, even when you swap models mid-project.

**Extensible Architecture** — Adding a new provider takes minutes, not days. Build once, extend forever.

---

## Features

- 🧙 **Sage Guide** — Meet your wise elder AI assistant, guiding you through conversations in a serene, muted-green interface with vibrant green accents
- 🔄 **Multi-Provider Support** — Switch between OpenAI, Anthropic, Minimax, and more with a settings click
- 💾 **Persistent History** — All conversations, agent files, and memory documents live on your server
- 🔐 **OAuth Authentication** — Secure login with industry-standard token encryption
- 📝 **Agent & Memory Files** — Editable agent definitions and memory files, updated in real-time within the UI
- 🚀 **Heroku Ready** — Deploy in minutes with built-in Heroku configuration
- 🎨 **Pokemon-Inspired Pixel Aesthetic** — Charming retro styling with muted tones and vibrant green highlights

---

## Quick Start

### Prerequisites
- Node.js 16+
- PostgreSQL (or your choice of database)
- OAuth credentials (GitHub recommended)
- API keys for your chosen LLM provider(s)

### 1. Clone & Install
```bash
git clone <repo-url>
cd sage
npm install
```

### 2. Configure Environment Variables
Create a `.env.local` file in the root:
```env
# OAuth
OAUTH_CLIENT_ID=your_github_oauth_client_id
OAUTH_CLIENT_SECRET=your_github_oauth_client_secret
OAUTH_REDIRECT_URI=http://localhost:3000/auth/callback

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/sage

# LLM Providers (encrypted on server, never exposed to frontend)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
MINIMAX_API_KEY=...

# Default provider
DEFAULT_PROVIDER=minimax
DEFAULT_MODEL=minimax-text-01
```

### 3. Run Locally
```bash
npm run dev
```
Visit `http://localhost:3000` and log in via OAuth.

### 4. Configure Your LLM Provider
Once logged in, visit **Settings** → **LLM Provider** and select which provider + model to use. Sage remembers your choice and persists it to your account.

---

## Supported Providers

| Provider | API Key | Models | Notes |
|----------|---------|--------|-------|
| **OpenAI** | `OPENAI_API_KEY` | GPT-4, GPT-4 Turbo, GPT-3.5 | Market leader; higher cost |
| **Anthropic** | `ANTHROPIC_API_KEY` | Claude 3 (Opus, Sonnet, Haiku) | Strong reasoning; competitive pricing |
| **Minimax** | `MINIMAX_API_KEY` | MiniMax-Text-01 | Excellent cost/quality ratio; fastest growing |

### Adding a New Provider

Implement the `LLMProvider` interface in `src/server/providers/`:
```typescript
export interface LLMProvider {
  name: string;
  apiKey: string;
  listModels(): Promise<Model[]>;
  chat(messages: Message[], model: string): Promise<string>;
}
```

See `src/server/providers/openai.ts` for a reference implementation. Register it in `src/server/providers/index.ts`.

---

## Configuration Examples

### Example 1: Start with Minimax (Default)
```env
DEFAULT_PROVIDER=minimax
DEFAULT_MODEL=minimax-text-01
MINIMAX_API_KEY=sk-minimax-xxx
```

### Example 2: Switch to Claude (Anthropic)
Visit Settings → LLM Provider → Select "Anthropic" → "Claude 3 Opus"

Your conversation history stays intact. No data loss.

### Example 3: Cost Optimization Workflow
1. Use Minimax for most work (cheapest)
2. Switch to Claude when you need stronger reasoning
3. Use GPT-4 for specialized tasks
4. All within one interface, one persistent history

---

## Agent & Memory Files

Sage supports persistent agent definitions and memory documents, editable directly in the UI:

- **Agent Files** — Define custom system prompts, instructions, or model-specific behaviors
- **Memory Files** — Maintain long-term context, preferences, and reference documents

These files sync to your database and are available across all conversations and providers.

**UI Location:** Conversation → Files sidebar → Create/Edit Agent or Memory file

---

## Architecture

```
sage/
├── frontend/          # React + pixel art UI
├── backend/           # Node.js/Express API
├── src/
│   ├── server/
│   │   ├── providers/ # LLM provider implementations
│   │   ├── auth/      # OAuth & token management
│   │   ├── db/        # Database models & migrations
│   │   └── api/       # REST endpoints
│   └── client/
│       ├── pages/     # React pages
│       ├── components/ # Reusable UI components
│       └── styles/    # Pixel art theming
├── .env.local         # Your local secrets (git-ignored)
└── package.json
```

**Single monorepo** — frontend and backend together, deployed as one unit.

---

## Deployment to Heroku

### 1. Create a Heroku App
```bash
heroku create sage-yourname
```

### 2. Add PostgreSQL
```bash
heroku addons:create heroku-postgresql:standard-0 --app sage-yourname
```

### 3. Set Environment Variables
```bash
heroku config:set OAUTH_CLIENT_ID=xxx OAUTH_CLIENT_SECRET=xxx \
  OPENAI_API_KEY=xxx ANTHROPIC_API_KEY=xxx MINIMAX_API_KEY=xxx \
  --app sage-yourname
```

### 4. Deploy
```bash
git push heroku main
```

Your Sage instance is now live. Visit `https://sage-yourname.herokuapp.com`.

---

## Security

**API Keys** — Stored encrypted in your database. Never logged, never exposed to the frontend. Backend-only access.

**OAuth** — GitHub OAuth (or your choice). No passwords stored locally. No plaintext credentials in the browser.

**HTTPS** — Always use HTTPS in production. Heroku provides this by default.

**Token Encryption** — All API keys are encrypted at rest using industry-standard encryption (AES-256).

**Rate Limiting** — Respect provider rate limits. Implement backoff/retry logic.

---

## Development

### Local Setup
```bash
npm install
npm run dev
```

Runs on `http://localhost:3000` with hot reload.

### Database Migrations
```bash
npm run migrate:latest
npm run migrate:rollback
```

### Testing
```bash
npm run test
```

### Contributing
Pull requests welcome. For major changes, open an issue first.

---

## Roadmap

- [ ] Support for more providers (Cohere, Together AI, local models via Ollama)
- [ ] Conversation search & tagging
- [ ] Team sharing & collaboration
- [ ] Model comparison (side-by-side responses)
- [ ] Batch processing for conversations
- [ ] Custom provider templates

---

## License

MIT

---

## Questions?

Open an issue or reach out. Sage is built for flexibility—if something doesn't work the way you need it to, let's fix it.

**Built with ❤️ by a seeker of better tools.**
