import { describe, expect, it, beforeEach } from "vitest";
import {
  RateLimitError,
  rateLimit,
  resetRateLimits,
} from "@/lib/security/rate-limit";
import { IP_POLICIES, checkIpRateLimit, normalizeIp } from "@/lib/security/ip";

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

describe("normalizeIp", () => {
  it("unwraps IPv4-mapped IPv6", () => {
    expect(normalizeIp("::ffff:192.168.0.1")).toBe("192.168.0.1");
  });

  it("lowercases and passes through regular addresses", () => {
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeIp("")).toBe("unknown");
  });
});
