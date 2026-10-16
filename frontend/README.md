# EtherSignals

Real-time Ethereum signal feed — a single-page official site that ingests
machine-generated signals over a signed webhook, stores them in PostgreSQL and
publishes the latest 100 as a live, auto-refreshing feed.

> ⚠️ **Personal research & educational reference project.** Nothing here is
> financial advice. Signals may be wrong, delayed or meaningless. Never trade
> based on them. See [/disclaimer](docs) on the site.

Derived from the TensorSave/BlackFridayList reference architecture:
Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4
(CSS-based config) · Prisma 6 + PostgreSQL · hand-rolled shadcn-style UI ·
hand-written service worker.

## Quick start (local development)

Prerequisites: Node ≥ 22, a PostgreSQL instance (a dedicated dev container is
fine), npm.

```bash
# 1. Dev database (once — the container persists)
docker run -d --name ethersignals-pg-dev \
  -e POSTGRES_USER=ether -e POSTGRES_PASSWORD=ether -e POSTGRES_DB=ethersignals \
  -p 127.0.0.1:54329:5432 postgres:18-alpine

# 2. Configure
cp .env.example .env            # then edit DATABASE_URL / WEBHOOK_SECRETS

# 3. Install, migrate, seed demo data
npm install
npm run db:deploy               # prisma migrate deploy
npm run db:seed                 # 24 fake signals (dev only!)

# 4. Run
npm run dev                     # http://localhost:3000
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js lifecycle (`start` expects a prod build) |
| `npm test` | Vitest — rate limiter, HMAC, payload schema, utils |
| `npm run lint` | ESLint (next/core-web-vitals + TS) |
| `npm run db:migrate` | Create/apply a dev migration |
| `npm run db:deploy` | Apply migrations (used by Docker entrypoint) |
| `npm run db:seed` | Insert demo signals (refuses when table non-empty) |
| `npm run icons` | Regenerate all brand assets from the source PNG |

## Testing the webhook locally

The ingest endpoint speaks the native GTrading `signal.trend` contract
(Bearer token auth, full details in [docs/WEBHOOK.md](docs/WEBHOOK.md)):

```bash
TOKEN="dev-webhook-secret-change-me"      # matches WEBHOOK_SECRETS in .env

curl -X POST http://localhost:3000/api/webhooks/signals \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "type": "signal.trend",
    "ts": '"$(date +%s000)"',
    "symbol": "ETHUSDT",
    "marketType": "futures",
    "price": 2440.54,
    "timeframe": "5m",
    "regime": "strong_down",
    "score": -0.51,
    "signals": [
      {"tf":"2m","regime":"down","score":-0.4,"prob":0.4,"patterns":[]},
      {"tf":"5m","regime":"strong_down","score":-0.51,"prob":0.58,"patterns":[{"key":"macd_dead","prob":0.52}]},
      {"tf":"30m","regime":"down","score":-0.3,"prob":null,"patterns":[]},
      {"tf":"2h","regime":"neutral","score":0.1,"prob":0.42,"patterns":[]},
      {"tf":"1d","regime":"up","score":0.25,"prob":0.51,"patterns":[]}
    ],
    "levels": {"pivot":2402.28,"support":2405.71,"donchianHigh":2778.0,"donchianLow":2405.71,"breakout":"inside"}
  }'
# → {"accepted":1,"duplicates":0}
```

Point GTrading at `https://<your-site>/api/webhooks/signals` and paste the
matching token into its webhook settings.

## Production deployment

PostgreSQL is external (e.g. the BaoTa-managed instance on 127.0.0.1:5432 —
create a database and user for the app first). Then:

```bash
cp .env.example .env             # DATABASE_URL, WEBHOOK_SECRETS, SITE_URL, VAPID_*
docker compose -f docker-compose.prod.yml up -d --build
```

- The app binds `127.0.0.1:${PORT:-3021}` (host network) — point your reverse
  proxy (BaoTa/nginx/caddy with TLS) at it. `TRUST_PROXY=true` (default) so
  client IPs come from `X-Forwarded-For` for rate limiting.
- `NEXT_PUBLIC_*` values are baked in at **build** time: after changing them
  in `.env`, re-run the compose command (it rebuilds the image).
- Migrations apply at **image build** time (`DATABASE_URL` build arg +
  `build.network: host`), idempotent on every build — schema changes always
  ship together with a new image. Container restarts don't touch the database.
- Health probe: `GET /api/health` (used by the Docker HEALTHCHECK).

For Web Push (optional desktop notifications with the browser closed):

```bash
npx web-push generate-vapid-keys   # put the pair into VAPID_* envs
```

Without VAPID keys the alerts button still works for local notifications while
the site is open — everything degrades gracefully.

## Feature map (requirements → implementation)

| Requirement | Where |
| --- | --- |
| PostgreSQL storage | `prisma/schema.prisma`, `src/lib/db.ts` |
| Single homepage, no auth | `src/app/page.tsx` (only content route) |
| Webhook ingest, latest 100 on the page, 20s refresh + countdown | `src/app/api/webhooks/signals/route.ts`, `src/components/signals/signal-feed.tsx` |
| 4 req/min/IP rate limit | `src/lib/security/rate-limit.ts`, `ip.ts` |
| Logo/favicon/PWA/chrome app + desktop notifications | `scripts/generate-icons.mjs`, `src/app/manifest.ts`, `public/sw.js`, `src/components/notifications/notification-button.tsx` |
| Privacy / terms / disclaimer + cookie consent | `src/lib/legal.ts`, `src/components/consent/consent-banner.tsx` |
| Brand color system | `src/app/globals.css` (tokens sampled from the logo) |
| Telegram invite + mobile auto drawer | `src/components/telegram/*` |
| Mobile-app experience (PWA, offline page, safe-areas) | `public/sw.js`, `src/app/offline/page.tsx`, manifest |

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, data flow, design decisions
- [docs/WEBHOOK.md](docs/WEBHOOK.md) — ingest contract, signing, batching, idempotency
- [docs/SECURITY.md](docs/SECURITY.md) — threat model and mitigations

## License / status

Private research project. The feed is provided as-is, without warranty of any
kind. Not affiliated with the Ethereum Foundation.
