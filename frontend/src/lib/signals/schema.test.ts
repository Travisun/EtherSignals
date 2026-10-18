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

// ─── nhnl ladder (multi-timeframe new-high/new-low) ──────────────────────────

function nhnlRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tf: "1h",
    barTime: 1_792_281_600,
    barHigh: 2405.0,
    barLow: 2398.2,
    nh: true,
    nl: false,
    prevHigh: 2404.8,
    prevLow: 2397.9,
    brkUp: true,
    brkDown: false,
    donHigh: 2412.0,
    donLow: 2390.5,
    donUp: false,
    donDown: false,
    distHighPct: 0,
    distLowPct: 0.28,
    ...overrides,
  };
}

describe("signalTrendSchema.nhnl", () => {
  it("accepts a push with a valid nhnl block", () => {
    const result = parseSignalTrend(
      validPush({
        nhnl: {
          price: 2405.0,
          donN: 20,
          rows: [nhnlRow(), nhnlRow({ tf: "1M", nh: false, brkUp: false, distHighPct: 1.4 })],
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // case-sensitive ladder tfs: 1m (minute) and 1M (month) both survive
      expect(result.data.nhnl?.rows.map((r) => r.tf)).toEqual(["1h", "1M"]);
      expect(result.data.nhnl?.rows[0].nh).toBe(true);
      expect(result.data.nhnl?.donN).toBe(20);
    }
  });

  it("keeps legacy pushes without nhnl valid (backward compatible)", () => {
    const push = validPush();
    delete push.nhnl;
    expect(parseSignalTrend(push).ok).toBe(true);
    expect(parseSignalTrend(validPush({ nhnl: null })).ok).toBe(true);
  });

  it("rejects malformed rows (bad tf case rule, missing booleans)", () => {
    expect(
      parseSignalTrend(validPush({ nhnl: { donN: 20, rows: [nhnlRow({ tf: "1x" })] } })).ok,
    ).toBe(false);
    expect(
      parseSignalTrend(validPush({ nhnl: { donN: 20, rows: [nhnlRow({ nh: "yes" })] } })).ok,
    ).toBe(false);
  });
});

describe("toSignalInput.nhnl", () => {
  it("stores the ladder as JSON and DbNull when absent", () => {
    const withNhnl = parseSignalTrend(validPush({ nhnl: { donN: 20, rows: [nhnlRow()] } }));
    if (!withNhnl.ok) throw new Error("expected ok");
    const input = toSignalInput(withNhnl.data, {});
    expect(Array.isArray(input.nhnl)).toBe(false); // object, not DbNull
    expect((input.nhnl as { rows: unknown[] }).rows).toHaveLength(1);

    const without = parseSignalTrend(validPush());
    if (!without.ok) throw new Error("expected ok");
    expect(toSignalInput(without.data, {}).nhnl).not.toBeNull(); // DbNull sentinel
  });
});
