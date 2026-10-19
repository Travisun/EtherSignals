# Region blocking (GeoLite2-Country) — CN mainland gate

The public site blocks visitors from mainland China (ISO `CN` by default) with
a self-contained bilingual "not available in your region" page (HTTP 403).
Everything lives in three places:

| Piece | File |
|---|---|
| Policy + block-page UI (pure, unit-tested) | `src/lib/geoip/geo.ts` |
| GeoLite2 reader (lazy singleton, mtime hot-reload) | `src/lib/geoip/reader.ts` |
| Request gate (Next 16 proxy — the renamed middleware) | `src/proxy.ts` |
| Database bootstrap/refresh | `scripts/geoip-download.mjs` (entrypoint calls it) |

## Request flow

```
Client → Cloudflare → nginx → Next proxy (src/proxy.ts, Node.js runtime)
                               1. exempt? /api/health, /api/webhooks/* → pass
                               2. GEOIP_BLOCK=false? → pass (kill switch)
                               3. real client IP via clientIpFromHeaders()
                                  (CF-Connecting-IP → left-most XFF when
                                  TRUST_PROXY — same trust model as rate
                                  limiting, see src/lib/security/ip.ts)
                               4. private/unknown IP → pass (fail-open)
                               5. GeoLite2 lookup → CN (or GEOIP_BLOCKED_COUNTRIES)?
                                  page requests → 403 HTML block page
                                  /api/*          → 403 JSON region_blocked
                               6. otherwise pass, stamped x-es-region: <CC>
                                  upstream (overwrites any client claim)
```

Design properties:

- **Fail-open everywhere.** Missing/corrupt database, unknown country,
  private address or a lookup error all serve the request. Feed availability
  outranks block completeness; `/api/health` reports
  `geoip.loaded: false` so an inert blocker is visible in monitoring.
- **The block page makes zero external requests** (inline CSS + SVG) so it
  renders under hostile networking, and is `noindex` with
  `Cache-Control: no-store, private` (the decision is per-IP — never cached
  for a shared audience).
- **Exemptions** keep region-independent infrastructure working: uptime
  probes (`/api/health`) and the backend signal ingest (`/api/webhooks/*`,
  Bearer-authenticated server-to-server).
- **Default scope is mainland China only** — HK (`HK`), Macau (`MO`) and
  Taiwan (`TW`) stay accessible. Extend with
  `GEOIP_BLOCKED_COUNTRIES="CN,HK"` etc. if policy ever changes.

## Database provisioning

GeoLite2 is free but license-gated: create a MaxMind account
(<https://www.maxmind.com/en/geolite2/signup>), then note the **Account ID**
and a **License Key**. The image ships no database (credentials never enter
git or the image); the entrypoint downloads into the `geoip` docker volume at
boot when the file is missing or older than `GEOIP_REFRESH_DAYS` (default 4).

```bash
# .env (frontend)
GEOIP_ACCOUNT_ID="123456"
GEOIP_LICENSE_KEY="xxxxxxxxxxxxxx"
```

Alternative sources: `GEOIP_MMDB_URL` (direct raw `.mmdb` URL — wins over the
API when set) or pre-place the file and point `GEOIP_MMDB_PATH` at it.
Manual local run: `npm run geoip:download` (behind a proxy add
`NODE_USE_ENV_PROXY=1`).

While the server is running, a swapped-in database is picked up within a
minute (mtime hot-reload); a database that appears after boot is retried
every 30 s. To refresh without redeploying: restart the container, or drop a
fresh `.mmdb` into the volume.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `GEOIP_BLOCKED_COUNTRIES` | `CN` | Comma/space-separated ISO codes to block |
| `GEOIP_BLOCK` | `true` | `false` = serve every region (incident kill switch) |
| `GEOIP_ACCOUNT_ID` / `GEOIP_LICENSE_KEY` | — | MaxMind credentials for the entrypoint download |
| `GEOIP_MMDB_URL` | — | Direct `.mmdb` URL, overrides the API |
| `GEOIP_MMDB_PATH` | `<app>/geoip/GeoLite2-Country.mmdb` | Database path override |
| `GEOIP_REFRESH_DAYS` | `4` | Entrypoint re-download threshold |

## Verification

```bash
# blocker armed? (loaded must be true)
curl -s https://ethersignals.com/api/health | jq .geoip

# real CN address → 403 block page / JSON for APIs
curl -i -H 'CF-Connecting-IP: 223.5.5.5' https://ethersignals.com/
curl -i -H 'CF-Connecting-IP: 223.5.5.5' https://ethersignals.com/api/signals

# non-CN → 200 (8.8.8.8), HK/TW stay open (205.252.144.1 / 101.101.101.101)
```

`CF-Connecting-IP` can be set manually **only when bypassing Cloudflare**
(direct-to-origin); through CF the header is overwritten at the edge, which
is exactly why it is authoritative.

Rollback: set `GEOIP_BLOCK="false"` in `.env` and `docker compose up -d` —
no rebuild needed.

## Hardening: pin the proxy chain in nginx

The app trusts `CF-Connecting-IP` because the only path to nginx is through
Cloudflare — as long as the origin only accepts CF traffic. Someone who
discovers the origin IP could otherwise forge the header (both to rotate
rate-limit buckets and to pose as a non-CN address). Fix at the nginx server
block with Cloudflare's published ranges (refresh from
<https://www.cloudflare.com/ips/>):

```nginx
# restore the real client IP from CF's own header, ignoring client-supplied XFF
set_real_ip_from 173.245.48.0/20;  set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;  set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;  set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;  set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22; set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;   set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;    set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;   set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;   set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;   set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;
real_ip_header CF-Connecting-IP;
```

Optional stricter layer: a Cloudflare WAF rule
(`ip.src.country eq CN → Block`) drops CN traffic at the edge before it ever
reaches the origin. Its block page is Cloudflare's generic one, not our UI —
which is why the in-app gate above remains the user-facing mechanism.
