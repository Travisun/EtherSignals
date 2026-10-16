# Webhook ingest contract (GTrading `signal.trend`)

`POST /api/webhooks/signals` — the only write path into EtherSignals. Speaks
the native GTrading webhook contract ([GTrading docs/webhook.md] as source of
truth).

Configure the site URL + token in GTrading: Settings → Webhook → URL/Token →
enable → send test.

## Authentication

```
Content-Type: application/json
Authorization: Bearer <token>      ← the GTrading webhook token; it must be
                                     one of the server's WEBHOOK_SECRETS
```

- Token comparison is constant-time.
- Zero-downtime rotation: `WEBHOOK_SECRETS` accepts a comma-separated list.
- Optional hardening for other senders: if `X-EtherSignals-Signature` and
  `X-EtherSignals-Timestamp` headers are present, the endpoint verifies
  `sha256=HMAC(secret, "{timestamp}.{rawBody}")` instead (±300s window).

## Payload — one full `signal.trend` snapshot per request

```jsonc
{
  "type": "signal.trend",        // fixed literal
  "ts": 1792123570978,           // push time, unix ms → idempotency key (unique)
  "message": "[ETHUSDT] ...",    // exact Telegram-channel text (stored verbatim)
  "symbol": "ETHUSDT",
  "marketType": "futures",       // "futures" | "spot" (default futures)
  "price": 2440.54,              // number or numeric string
  "timeframe": "5m",             // triggering timeframe: 2m|5m|30m|2h|1d
  "regime": "strong_down",       // strong_up | up | neutral | down | strong_down
  "score": -0.51,                // [-1, 1]
  "signals": [                   // five-timeframe board, 2m→5m→30m→2h→1d
    {
      "tf": "2m",
      "regime": "up",
      "score": 0.341,
      "prob": 0.32,              // null = insufficient history (<15 samples)
      "patterns": [
        { "key": "macd_golden", "prob": 0.42 }   // prob may be null too
      ]
    }
    // …5 entries
  ],
  "levels": {                    // null = daily warmup
    "resistance": 2489.7,        // omitted entirely when price is above all levels
    "pivot": 2402.28,
    "support": 2405.71,          // omitted when price is below all levels
    "donchianHigh": 2778.0,
    "donchianLow": 2405.71,
    "breakout": "inside"         // "up" | "down" | "inside"
  }
}
```

All nullability documented by GTrading is preserved end-to-end: `prob`,
`patterns[].prob`, `levels.resistance`, `levels.support` may be null/absent;
`levels` itself may be null during warmup. The board is re-sorted into
canonical `2m→5m→30m→2h→1d` order on ingest so display never depends on wire
order.

## Delivery semantics handled by the site

| Producer behavior | Site handling |
| --- | --- |
| Same state may repeat at merge-window boundaries | Unique index on `ts` → counted as duplicate, no-op |
| One automatic retry after failure | Same dedupe — retry is idempotent |
| Strong-regime pushes bypass the merge window | No special casing needed; each push is a full snapshot |
| 10s producer timeout | Ingest responds immediately after persist; push fan-out runs post-response |

## Responses

| Status | Meaning |
| --- | --- |
| `201` | `{ "accepted": 1, "duplicates": 0 }` — stored |
| `200` | `{ "accepted": 0, "duplicates": 1 }` — `ts` already known (retry/duplicate) |
| `400` | invalid JSON, schema violation (field errors listed), wrong content type, body > 64 KB |
| `401` | missing/invalid token or signature, HMAC timestamp outside window |
| `413` | body exceeds 64 KB |
| `429` | ingest rate limit exceeded (120/min/IP) with `Retry-After` |
| `500` | persistence failure (details only in server logs) |

## On success

1. The snapshot is written to PostgreSQL (`Signal`), `ts → pushedAt`.
2. After the response is sent, all web-push subscribers receive a
   notification (`ETHUSDT · Strong Down (5m)` / `Perp · 5m trend → Strong Down @ 2,440.54 · score -0.51`).
3. The homepage picks it up within ≤ 20s; visitors with alerts enabled get a
   desktop notification; Telegram mirrors it via the producer's own channel push.

## Reference sender snippet (GTrading-compatible)

```bash
curl -X POST https://your-site/api/webhooks/signals \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"type":"signal.trend","ts":1792123570978,"symbol":"ETHUSDT","timeframe":"5m","regime":"up","score":0.34,"price":2440.54}'
```
