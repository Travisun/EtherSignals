# Security notes

EtherSignals has no accounts, so the attack surface is: the public feed API,
the ingest webhook, push subscription management, and the static client.

## Transport & headers (`next.config.ts`)

- CSP: `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`,
  no third-party script/style origins; dev-only `unsafe-eval`.
- `X-Frame-Options: DENY`, `nosniff`, strict `Referrer-Policy`, locked-down
  `Permissions-Policy`.
- `/sw.js` served with `no-cache` + `Service-Worker-Allowed: /`.

## Ingest endpoint (the critical surface)

| Threat | Mitigation |
| --- | --- |
| Forged signals | `Authorization: Bearer <token>` (GTrading native) with constant-time comparison against the `WEBHOOK_SECRETS` list; optional HMAC-SHA256 mode for other senders |
| Credential leakage in logs | Tokens never logged; ingest audit stores IP + outcome only |
| Oversized / hostile bodies | 64 KB hard cap (header + actual bytes), zod schema with per-field bounds (scores ∈ [-1,1], prob ∈ [0,1], board ≤ 5, message ≤ 4000 chars), `raw` audit copy truncated to 16 KB |
| DB flooding | 120 req/min/IP ingest limit; single snapshot per request |
| Replay / duplicate delivery | Unique index on the producer's `ts` — retries and merge-window repeats are idempotent no-ops |
| Log flooding | `IngestLog` rows are bounded, 30-day opportunistic trim |
| Prod misconfig | empty `WEBHOOK_SECRETS` in production → endpoint refuses everything loudly |

## Public feed API

- 4 req/min/IP sliding window (the UI's own budget: 3 polls + 1 manual).
- `429` responses carry `Retry-After`; no cache serves stale data.
- DTO serialization converts Prisma `Decimal` → strings; no internals leak.
- Errors are generic server-side; stack traces stay in logs.

## Push subscriptions (anonymous)

- Only HTTPS endpoints on an allow-list of known push services → cannot be
  turned into an SSRF relay.
- Payloads validated with zod (URL length ≤ 2048, key shapes bounded).
- Dead endpoints pruned on 404/410; per-IP 10/hour management limit.

## Client

- React escapes all rendered values; the only `dangerouslySetInnerHTML` is
  static server-generated JSON-LD.
- No third-party scripts, fonts are self-hosted via `next/font`, no
  analytics — cookie consent covers only necessary storage + optional push.
- localStorage keys: consent choice, theme, telegram-drawer dismissal — all
  documented in the Privacy Policy.

## Operational

- PostgreSQL access only via Prisma parameterized queries (no string SQL
  except the `SELECT 1` health probe).
- Container runs as non-root `nodejs` user; healthcheck via internal fetch.
- Secrets live in env only; nothing secret is embedded in client bundles
  (VAPID public key is public by design).
- Swap the in-process rate limiter for Redis before scaling horizontally
  (see ARCHITECTURE.md).

## Known trade-offs

- In-memory rate limiting resets on restart and is per-instance — acceptable
  for the single-container deployment; documented upgrade path exists.
- `occurredAt` is sender-claimed (validated only against the future); the
  feed orders by our own `receivedAt`, so a lying sender can only mislabel
  its own rows, not reorder the feed.
