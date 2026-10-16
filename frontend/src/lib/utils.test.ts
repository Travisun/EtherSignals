import { describe, expect, it } from "vitest";
import { formatPrice, relativeTime, clampInt } from "@/lib/utils";

describe("formatPrice", () => {
  it("handles null/invalid gracefully", () => {
    expect(formatPrice(null)).toBe("n/a");
    expect(formatPrice("abc")).toBe("n/a");
  });

  it("formats large prices with 2 decimals and thousands separators", () => {
    expect(formatPrice("314159.42")).toBe("314,159.42");
    expect(formatPrice(1234.5)).toBe("1,234.5");
  });

  it("keeps precision for small prices", () => {
    expect(formatPrice("0.123456")).toBe("0.123456");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");

  it("buckets seconds/minutes/hours/days", () => {
    expect(relativeTime(new Date(now - 3000).toISOString(), now)).toBe("just now");
    expect(relativeTime(new Date(now - 30_000).toISOString(), now)).toBe("30s ago");
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5m ago");
    expect(relativeTime(new Date(now - 3 * 3600_000).toISOString(), now)).toBe("3h ago");
    expect(relativeTime(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe("2d ago");
  });

  it("never shows negative times on clock skew", () => {
    expect(relativeTime(new Date(now + 5000).toISOString(), now)).toBe("just now");
  });
});

describe("clampInt", () => {
  it("clamps and falls back", () => {
    expect(clampInt(500, 1, 100, 50)).toBe(100);
    expect(clampInt(-5, 1, 100, 50)).toBe(1);
    expect(clampInt("abc", 1, 100, 50)).toBe(50);
    expect(clampInt(7.9, 1, 100, 50)).toBe(7);
  });
});
