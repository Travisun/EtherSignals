import { describe, expect, it, beforeEach } from "vitest";
import {
  RateLimitError,
  rateLimit,
  resetRateLimits,
} from "@/lib/security/rate-limit";
import { IP_POLICIES, checkIpRateLimit, clientIpFromHeaders, normalizeIp } from "@/lib/security/ip";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit then throws", () => {
    for (let i = 0; i < 4; i++) {
      expect(() => rateLimit("k", 4, 60_000)).not.toThrow();
    }
    expect(() => rateLimit("k", 4, 60_000)).toThrowError(RateLimitError);
  });

  it("isolates keys", () => {
    rateLimit("a", 1, 60_000);
    expect(() => rateLimit("a", 1, 60_000)).toThrowError(RateLimitError);
    expect(() => rateLimit("b", 1, 60_000)).not.toThrow();
  });

  it("reports retry-after in whole seconds", () => {
    try {
      rateLimit("x", 1, 30_000);
      rateLimit("x", 1, 30_000);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const e = err as RateLimitError;
      expect(e.retryAfterSec).toBeGreaterThanOrEqual(1);
      expect(e.retryAfterSec).toBeLessThanOrEqual(30);
    }
  });
});

describe("checkIpRateLimit (signalsApi = 15/min)", () => {
  beforeEach(() => resetRateLimits());

  it("enforces the documented 15/min policy per IP", () => {
    for (let i = 0; i < IP_POLICIES.signalsApi.limit; i++) {
      expect(() => checkIpRateLimit("signalsApi", "1.2.3.4")).not.toThrow();
    }
    expect(() => checkIpRateLimit("signalsApi", "1.2.3.4")).toThrowError(
      RateLimitError,
    );
    // Different IP unaffected.
    expect(() => checkIpRateLimit("signalsApi", "5.6.7.8")).not.toThrow();
  });
});

describe("clientIpFromHeaders (Cloudflare → nginx chain)", () => {
  const H = (init: Record<string, string>): Headers => new Headers(init);

  it("prefers CF-Connecting-IP over the XFF chain (nginx appends the CF edge IP)", () => {
    const h = H({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "203.0.113.7, 104.16.0.1", // last hop = Cloudflare edge
      "x-real-ip": "104.16.0.1",
    });
    expect(clientIpFromHeaders(h, true)).toBe("203.0.113.7");
  });

  it("supports IPv6 clients through Cloudflare", () => {
    const h = H({ "cf-connecting-ip": "2001:DB8::AB" });
    expect(clientIpFromHeaders(h, true)).toBe("2001:db8::ab");
  });

  it("falls back to left-most XFF without Cloudflare (plain nginx)", () => {
    const h = H({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" });
    expect(clientIpFromHeaders(h, true)).toBe("198.51.100.9");
  });

  it("unwraps IPv4-mapped IPv6", () => {
    const h = H({ "cf-connecting-ip": "::ffff:203.0.113.7" });
    expect(clientIpFromHeaders(h, true)).toBe("203.0.113.7");
  });

  it("still resolves the real client behind Cloudflare even if TRUST_PROXY was misconfigured", () => {
    // presence of CF-Connecting-IP implies the CF chain — trusting it beats
    // collapsing every visitor under the Cloudflare edge IP
    const h = H({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "104.16.0.1" });
    expect(clientIpFromHeaders(h, false)).toBe("203.0.113.7");
  });

  it("buckets unknown when TRUST_PROXY=false and no proxy headers exist", () => {
    expect(clientIpFromHeaders(H({}), false)).toBe("unknown");
  });
});

describe("normalizeIp", () => {
  it("unwraps IPv4-mapped IPv6", () => {
    expect(normalizeIp("::ffff:192.168.0.1")).toBe("192.168.0.1");
  });

  it("lowercases and passes through regular addresses", () => {
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeIp("")).toBe("unknown");
  });
});
