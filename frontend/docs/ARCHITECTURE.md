# EtherSignals — Architecture

Derivative of the TensorSave/BlackFridayList reference architecture, cut down
to a single-page, no-accounts product.

## Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 16.4, App Router, React 19.3 | `output: "standalone"` for Docker |
| Language | TypeScript strict | path alias `@/*` |
| Styling | Tailwind CSS v4, pure-CSS config | tokens in `src/app/globals.css` (`@theme inline`) |
| Data | Prisma 6 + PostgreSQL 18 | migrations committed, applied on boot |
| UI | Hand-written cva components | zero Radix dependency |
| Push | web-push (VAPID) + local SW notifications | optional, graceful degrade |
| Tests | Vitest | pure-logic layers only |

## Layers

```
components (thin, presentational)
   → app/api routes (transport: rate limit, HMAC, zod boundary)
      → lib/signals/* (schema, dto, signature — pure, unit-tested)
         → lib/db (Prisma singleton)
```

- **No "use server" actions** — the site is read-only for visitors; the only
  write path is the webhook, so the API route is the single guarded boundary.
- **Pure functions live in `lib/`** and are what the Vitest suite covers
  (`signature`, `schema`, `rate-limit`, `utils`).

## Data flow

```
GTrading model server                          visitor browser
      │ POST /api/webhooks/signals                   │ GET /            ← SSR reads PG directly
      │ (Bearer token; full signal.trend snapshot)   │ GET /api/signals ← poll every 20s
      ▼                                              ▼
  verify token ─ zod parse ─ create (unique on ts)  rate limit (4/min/IP)
      │                                              │
  Signal table ◄──────── reads ───────────────────── ┘
      │
      └─ after(): web-push fan-out to PushSubscription table
```

Key decisions:

1. **SSR reads the DB directly** (no self-fetch). The page costs the visitor
   zero API quota; the client poller takes over afterwards with a `sinceId`
   cursor.
2. **Cursor polling**: `/api/signals?sinceId=<newest-held-id>` returns only
   newer rows; when nothing changed the server skips the stats queries and
   returns `stats: null` (client keeps its copy). Idle 20s cycles ≈ one
   indexed `findMany` with `take: 100`.
3. **Deadline-driven countdown**: the refresh ring computes from
   `deadlineRef` wall-clock timestamps, never a decremented counter, so
   throttled timers can't drift the cycle.
4. **Visibility-aware polling**: hidden tabs defer fetches (2s re-check) and
   catch up immediately on focus — mobile users don't burn quota in
   background.
5. **Rate-limit budget**: 4/min/IP = 3 auto polls + 1 manual refresh. On 429
   the client backs off for the server's `Retry-After` and shows a calm
   "rate limited" state instead of breaking.

## Notification pipeline

- **Local notifications** (no VAPID needed): the poller calls
  `registration.showNotification()` through the service worker — works while
  the tab is open in the background; toast in-page when visible.
- **Web Push** (VAPID configured): the alerts button subscribes the browser
  and POSTs the subscription to `/api/push` (anonymous, endpoint-host
  allow-listed). On each accepted webhook ingest, `after()` fans out to all
  subscriptions; 404/410 endpoints are pruned.
- VAPID public key reaches the client via `data-vapid-key` on `<html>`.

## Design system

Brand tokens sampled from the logo artwork (blue disc gradient
`#62a6ff → #3b86f6`, ice diamond `#fafdff → #add3fb`):

- Dark (default): deep navy surfaces `#050a14/#0a1220`, brand blue
  `#4e96fb`, exchange-convention green `#16c784` / red `#f6465d`.
- Light: ice-white `#f2f6fc/#ffffff`, deeper blue `#2f7bf0` for contrast.
- Geist + Geist Mono; tabular numerals (`.tnum`) on all data cells.
- All icons/PWA assets/OG card are generated from the source PNG by
  `scripts/generate-icons.mjs` (sharp; ICC profile applied).

## PWA

Hand-written `public/sw.js` (versioned cache + activate cleanup):

- `/_next/static`, `/icons`, `/og.png` → cache-first (immutable)
- navigations → network-first with `/offline` fallback
- `/api/**` → never cached
- `push` / `notificationclick` handlers for Web Push
- served with `Cache-Control: no-cache` so updates propagate

## Scaling notes

The rate limiter is in-process (correct for the single-container compose
deployment, ~O(1) memory with sweeps + a 100k-bucket cap). For multi-instance
deployment, swap the `buckets` Map for Redis with the same interface —
`lib/security/rate-limit.ts` is the only file that changes.
