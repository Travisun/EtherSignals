import { rateLimit, RateLimitError } from "./rate-limit";

/**
 * Resolve the client IP for rate limiting.
 *
 * TRUST_PROXY=true (default, site is deployed behind nginx/caddy): take the
 * left-most X-Forwarded-For entry, which is the original client as set by our
 * own proxy; spoofed XFF headers from clients are overwritten by the proxy.
 * TRUST_PROXY=false: the socket-level address is the only trustworthy source,
 * and Next exposes it via the x-forwarded-for/x-real-ip internals; we then
 * bucket everything under the socket IP instead.
 */
export function clientIpFromHeaders(
  headers: Headers,
  trustProxy: boolean,
): string {
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
  /** Public feed API: the page polls every 20s (3/min); 4/min leaves headroom for one manual refresh. */
  signalsApi: { limit: 4, windowMs: 60_000 },
  /** Chart candles: the client refreshes once per 10s; exactly 1/10s per IP. */
  marketCandles: { limit: 1, windowMs: 10_000 },
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
