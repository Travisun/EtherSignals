import { describe, expect, it } from "vitest";
import { parseSignalTrend, toSignalInput } from "@/lib/signals/schema";

/** A valid GTrading signal.trend push (mirrors docs/WEBHOOK.md). */
function validPush(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "signal.trend",
    ts: Date.now() - 1_000,
    message: "[ETHUSDT] 5m trend update\n\n▲ Strong Up (score +0.512)",
    symbol: "ETHUSDT",
    marketType: "futures",
    price: 2440.54,
    timeframe: "5m",
    regime: "strong_up",
    score: 0.512,
    signals: [
      { tf: "2m", regime: "up", score: 0.341, prob: 0.32, patterns: [{ key: "macd_golden", prob: 0.42 }] },
      { tf: "5m", regime: "strong_up", score: 0.512, prob: 0.61, patterns: [] },
      { tf: "30m", regime: "neutral", score: 0.05, prob: null, patterns: [] },
      { tf: "2h", regime: "down", score: -0.22, prob: 0.44, patterns: [{ key: "rsi_fade", prob: null }] },
      { tf: "1d", regime: "up", score: 0.31, prob: 0.55, patterns: [] },
    ],
    levels: {
      resistance: 2489.7,
      pivot: 2402.28,
      support: 2405.71,
      donchianHigh: 2778.0,
      donchianLow: 2405.71,
      breakout: "inside",
    },
    ...overrides,
  };
}

describe("signalTrendSchema", () => {
  it("accepts a full valid push", () => {
    const result = parseSignalTrend(validPush());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.symbol).toBe("ETHUSDT");
      expect(result.data.signals).toHaveLength(5);
    }
  });

  it("sorts the board into canonical 2m→5m→30m→2h→1d order", () => {
    const push = validPush();
    push.signals = [...(push.signals as unknown[])].reverse();
    const result = parseSignalTrend(push);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.signals?.map((e) => e.tf)).toEqual([
        "2m", "5m", "30m", "2h", "1d",
      ]);
    }
  });

  it("defaults marketType to futures and patterns to []", () => {
    const push = validPush({ marketType: undefined });
    delete (push as { marketType?: unknown }).marketType;
    (push as { signals?: unknown }).signals = [
      { tf: "5m", regime: "up", score: 0.3 },
    ];
    const result = parseSignalTrend(push);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.marketType).toBe("futures");
      expect(result.data.signals?.[0].patterns).toEqual([]);
    }
  });

  it("accepts null prob / null levels / missing levels.resistance", () => {
    const push = validPush({
      levels: { pivot: 2402.28, donchianHigh: 2778, donchianLow: 2405, breakout: "up" },
    });
    (push as { signals?: unknown }).signals = [
      { tf: "1d", regime: "neutral", score: 0, prob: null, patterns: [{ key: "bb_squeeze", prob: null }] },
    ];
    const result = parseSignalTrend(push);
    expect(result.ok).toBe(true);
  });

  it("accepts levels: null (daily warmup)", () => {
    const result = parseSignalTrend(validPush({ levels: null }));
    expect(result.ok).toBe(true);
  });

  it("rejects wrong type, bad regime, out-of-range score, bad timeframe", () => {
    expect(parseSignalTrend(validPush({ type: "signal.other" })).ok).toBe(false);
    expect(parseSignalTrend(validPush({ regime: "bullish" })).ok).toBe(false);
    expect(parseSignalTrend(validPush({ score: 1.5 })).ok).toBe(false);
    expect(parseSignalTrend(validPush({ timeframe: "weekly" })).ok).toBe(false);
  });

  it("rejects future ts and >5 board entries", () => {
    expect(
      parseSignalTrend(validPush({ ts: Date.now() + 10 * 60_000 })).ok,
    ).toBe(false);
    const push = validPush();
    push.signals = [
      ...Object.values(validPush().signals as unknown[]),
      { tf: "4h", regime: "up", score: 0.4 },
    ];
    expect(parseSignalTrend(push).ok).toBe(false);
  });

  it("rejects missing required fields", () => {
    const noType = { ...validPush() } as Record<string, unknown>;
    delete noType.type;
    expect(parseSignalTrend(noType).ok).toBe(false);
    expect(parseSignalTrend(validPush({ symbol: undefined })).ok).toBe(false);
  });
});

describe("toSignalInput", () => {
  it("maps ts → pushedAt and JSON fields correctly", () => {
    const result = parseSignalTrend(validPush());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const input = toSignalInput(result.data, { hello: true });
    expect(input.pushedAt).toEqual(new Date((validPush().ts as number)));
    expect(input.symbol).toBe("ETHUSDT");
    expect(input.score).toBeCloseTo(0.512);
    expect(input.price).toBe("2440.54");
    expect(Array.isArray(input.board)).toBe(true);
    expect(input.message).toContain("ETHUSDT");
  });

  it("truncates oversized raw payloads for audit", () => {
    const result = parseSignalTrend(validPush());
    if (!result.ok) return;
    const input = toSignalInput(result.data, { blob: "x".repeat(40 * 1024) });
    expect((input.raw as { truncated: boolean }).truncated).toBe(true);
  });
});
