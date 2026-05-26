# Deploying Sage to Fly.io

## Prerequisites
- Fly CLI: https://fly.io/docs/hands-on/install-flyctl/
- Fly account with payment method
- Cloudflare R2 bucket + API token

## First deploy

1. **Sign up and authenticate**
   ```bash
   fly auth login
   ```

2. **Launch the app** (creates app + provisions Postgres)
   ```bash
   fly launch --no-deploy
   # When prompted:
   # - Use existing fly.toml? Yes
   # - Tweak settings? No
   # - Setup Postgres? Yes (pick Development plan for testing, ~$5/mo)
   # - Setup Upstash Redis? No
   # - Deploy now? No (we need to set secrets first)
   ```

3. **Set required secrets**
   ```bash
   fly secrets set \
     SESSION_SECRET="$(openssl rand -hex 32)" \
     SAGE_ENC_KEY="$(openssl rand -hex 32)" \
     GITHUB_CLIENT_ID="<from GitHub OAuth App>" \
     GITHUB_CLIENT_SECRET="<from GitHub OAuth App>" \
     OAUTH_REDIRECT_URI="https://<your-app>.fly.dev/api/auth/github/callback" \
     CLIENT_URL="https://<your-app>.fly.dev" \
     R2_ACCOUNT_ID="<from Cloudflare>" \
     R2_ACCESS_KEY_ID="<from Cloudflare>" \
     R2_SECRET_ACCESS_KEY="<from Cloudflare>" \
     R2_BUCKET="<your bucket name>" \
     OWNER_GITHUB_ID="<your github id, integer>"
   ```
   Note: `DATABASE_URL` is set automatically by `fly postgres attach`.

4. **Update your GitHub OAuth App callback URL**
   - Go to GitHub → Settings → Developer Settings → OAuth Apps → your app
   - Homepage URL: `https://<your-app>.fly.dev`
   - Authorization callback URL: `https://<your-app>.fly.dev/api/auth/github/callback`

5. **Deploy**
   ```bash
   fly deploy
   ```

6. **Check pgvector** (Fly Postgres includes it by default but verify)
   ```bash
   fly postgres connect -a <your-postgres-app>
   ```
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'vector';
   -- if empty:
   CREATE EXTENSION vector;
   \q
   ```

7. **Verify**
   - Visit `https://<your-app>.fly.dev` — should redirect to GitHub login
   - After login, settings page loads
   - Send a chat turn — within ~5s, check `fly logs` for `[wiki-ingest-turn] complete`
   - Visit `/wiki` — created pages appear
   - Visit `/facts` — extracted facts appear

## Common operations

- View logs: `fly logs`
- Scale worker memory: `fly scale memory 2048 --process-group worker`
- Connect to Postgres: `fly postgres connect -a <your-postgres-app>`
- Set/update a secret: `fly secrets set KEY=value`
- Rollback: `fly releases` then `fly deploy --image <previous-image>`

## Things to know

- **SearXNG (web_search) is disabled** on Fly by default. Tool calls return `{ok:false, error:"search_unavailable"}` gracefully. To enable: deploy SearXNG as a separate Fly app and set `SEARXNG_URL` secret to its internal URL.
- **OBJECT_STORE must be `r2`** — Fly machines have no persistent disk for the app. R2 holds the wiki corpus.
- **First boot**: web process runs `release_command` (migrations) before starting. Worker process boots in parallel and retries pg-boss startup until migrations finish. Expect 30–90s for first successful health check.
- **Cost estimate**: web (512MB shared) + worker (1GB shared) + Postgres Dev ≈ $20-25/mo. Scale up `[[vm]]` memory if either process OOMs (see `fly logs` for OOM events).
- **Owner-only migration endpoint** (Phase 7) checks `OWNER_GITHUB_ID` — set this secret to your numeric GitHub user ID so the Phase 7 cutover endpoint authorizes you.
