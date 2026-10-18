import { rateLimit, RateLimitError } from "./rate-limit";

/**
 * Resolve the client IP for rate limiting.
 *
 * Production chain: Client → Cloudflare → nginx → Next.
 *  1. `CF-Connecting-IP` — set by Cloudflare from the TCP peer and
 *     overwritten for clients, so it is the authoritative real client
 *     address (IPv4 or IPv6). Always preferred when present; without it a
 *     CF chain would rate-limit everyone under the Cloudflare edge IP.
 *  2. TRUST_PROXY=true (nginx/caddy directly in front): left-most
 *     X-Forwarded-For entry — the original client as written by our own
 *     proxy (`$proxy_add_x_forwarded_for` style). Spoofed XFF from clients
 *     is overwritten by the proxy.
 *  3. TRUST_PROXY=false: bucket everything under "unknown" — the socket
 *     address is the only trustworthy source and Next does not expose it.
 *
 * IPv4 and IPv6 are both valid bucket keys (normalizeIp lowercases IPv6 and
 * unwraps IPv4-mapped `::ffff:a.b.c.d` so dual-stack clients share a bucket).
 *
 * Hardening note: a client hitting the origin DIRECTLY (bypassing
 * Cloudflare) can forge CF-Connecting-IP and rotate buckets. Strict
 * deployments should additionally allowlist Cloudflare's published IP
 * ranges in the nginx server block (`allow`/`deny` or real_ip module).
 */
export function clientIpFromHeaders(
  headers: Headers,
  trustProxy: boolean,
): string {
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return normalizeIp(cfIp.trim());
  if (trustProxy) {
    const xff = headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return normalizeIp(first);
    }
    const real = headers.get("x-real-ip");
    if (real) return normalizeIp(real.trim());
  }
  return "unknown";
}

/** Collapse IPv4-mapped IPv6 so dual-stack clients share one bucket. */
export function normalizeIp(ip: string): string {
  if (!ip) return "unknown";
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  return ip.toLowerCase();
}

export const IP_POLICIES = {
  /** Public feed API: the page polls every 4s (15/min) — the limit matches the auto-refresh cadence. */
  signalsApi: { limit: 15, windowMs: 60_000 },
  /** Chart candles: the client refreshes every 4s (15/min), matching the upstream cache TTL. */
  marketCandles: { limit: 15, windowMs: 60_000 },
  /** Signed strategy pushes. Generous, but bounded. */
  webhookIngest: { limit: 120, windowMs: 60_000 },
  /** Push subscription management. */
  pushManage: { limit: 10, windowMs: 3_600_000 },
  /** Health probe. */
  health: { limit: 30, windowMs: 60_000 },
} as const;

export type IpPolicyName = keyof typeof IP_POLICIES;

export function checkIpRateLimit(policy: IpPolicyName, ip: string): void {
  const { limit, windowMs } = IP_POLICIES[policy];
  rateLimit(`${policy}:${ip}`, limit, windowMs);
}

export function rateLimitHeaders(err: RateLimitError): Record<string, string> {
  return {
    "Retry-After": String(err.retryAfterSec),
    "X-RateLimit-Remaining": "0",
  };
}
