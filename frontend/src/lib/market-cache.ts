
/**
 * Process-wide market-data memory cache with single-flight dedup. Browsers
 * hitting /api/market/candles share ONE upstream fetch per 4s window — the
 * public feed distributes from here instead of hammering the exchange.
 * Single-instance assumption, same as the rate limiter.
 */

const TTL_MS = 4_000;

export interface ForecastBar {
  time: number;
  dir: 1 | -1 | 0;
  score: number;
  prob: number | null;
  outcome: "hit" | "miss" | "flat" | "pending";
  realizedPct: number | null;
}

interface Entry {
  data: unknown;
  expiry: number;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of store) if (v.expiry <= now) store.delete(k);
}

export async function getCached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  sweep(now);
  const hit = store.get(key);
  if (hit && hit.expiry > now) return hit.data as T;
  const busy = inflight.get(key);
  if (busy) return busy as Promise<T>;
  const p = loader()
    .then((data) => {
      store.set(key, { data, expiry: Date.now() + TTL_MS });
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

// ─── Bitget public candles (read-only market data, no auth) ──────────────────

import { computeForecasts } from "./model/forecasts";
import type { ModelCandle } from "./model/core";

export interface MarketCandle {
  /** candle open time, unix SECONDS */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** tf → Bitget v2 mix granularity (whitelist: the chart's selectable set). */
// Bitget v2 MIX granularity uses the compact style (1m/5m/1H/4H) — the
// spot-style "5min" vocabulary gets a 400 from this endpoint.
const NATIVE: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "4h": "4H",
  "6h": "6H",
  "12h": "12H",
  "1d": "1D",
  "3d": "3D",
  "1w": "1W",
  "1M": "1M",
};

// Windows the exchange does not provide natively — aggregated here from
// their base series (same 16-tier ladder as the trading workbench).
const SYNTH: Record<string, { base: string; seconds: number }> = {
  "2m": { base: "1m", seconds: 120 },
  "2h": { base: "1h", seconds: 7200 },
  "8h": { base: "1h", seconds: 28800 },
  "2d": { base: "1d", seconds: 172800 },
};

const BASE_SECONDS: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400,
  "6h": 21600, "12h": 43200, "1d": 86400, "3d": 259200, "1w": 604800, "1M": 2592000,
};

/** The full 16-tier ladder in display order. */
export const CHART_TFS = [
  "1m", "2m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "2d", "3d", "1w", "1M",
];

const UPSTREAM_LIMIT = 1000; // Bitget v2 candles max page size

async function fetchNative(tf: string, limit: number): Promise<MarketCandle[]> {
  const granularity = NATIVE[tf];
  if (!granularity) throw new Error(`unsupported timeframe: ${tf}`);
  const url =
    `https://api.bitget.com/api/v2/mix/market/candles` +
    `?symbol=ETHUSDT&productType=USDT-FUTURES&granularity=${granularity}&limit=${Math.min(limit, UPSTREAM_LIMIT)}`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const body = (await res.json()) as { code?: string; data?: string[][] };
  if (body.code !== "00000" || !Array.isArray(body.data)) throw new Error("upstream payload");
  return body.data
    .map((r) => ({
      time: Math.floor(Number(r[0]) / 1000),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .filter((c) => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);
}

/** Aggregate base candles into fixed UTC-aligned buckets (OHLC + volume). */
function aggregate(base: MarketCandle[], bucketSeconds: number): MarketCandle[] {
  const buckets = new Map<number, MarketCandle>();
  for (const c of base) {
    const t = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    const cur = buckets.get(t);
    if (!cur) {
      buckets.set(t, { ...c, time: t });
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export async function fetchCandles(tf: string, limit: number): Promise<MarketCandle[]> {
  const synth = SYNTH[tf];
  if (!synth) return fetchNative(tf, limit);
  const base = await fetchNative(synth.base, Math.min(limit * (synth.seconds / (BASE_SECONDS[synth.base] ?? 1)), UPSTREAM_LIMIT));
  return aggregate(base, synth.seconds).slice(-limit);
}

/**
 * Full market payload for the chart: candles + the model's per-candle
 * forecast, computed SERVER-SIDE (the replay algorithm never ships to
 * browsers). Extra warmup bars feed the indicator suite before slicing.
 */
export async function fetchMarketData(
  tf: string,
  limit: number,
): Promise<{ candles: MarketCandle[]; forecasts: ForecastBar[] }> {
  const warmup = 80;
  const candles = await fetchCandles(tf, Math.min(limit + warmup, UPSTREAM_LIMIT));
  const modelCandles: ModelCandle[] = candles.map((c) => ({ ...c, baseVol: c.volume }));
  const bars = computeForecasts(modelCandles, tf);
  const forecasts: ForecastBar[] = bars.map((b, i) => {
    const base: ForecastBar = {
      time: candles[i].time,
      dir: b?.dir ?? 0,
      score: b?.score ?? 0,
      prob: b?.prob ?? null,
      outcome: "pending",
      realizedPct: null,
    };
    if (!b || b.dir === 0) return base;
    const entry = candles[i].close;
    const exitIdx = Math.min(i + 3, candles.length - 1);
    if (exitIdx <= i) return base; // no realized data yet — pending
    const realizedPct = ((candles[exitIdx].close - entry) / entry) * 100;
    if (Math.abs(realizedPct) < 0.1) {
      base.outcome = "flat";
      base.realizedPct = realizedPct;
    } else if ((realizedPct > 0 && b.dir > 0) || (realizedPct < 0 && b.dir < 0)) {
      base.outcome = "hit";
      base.realizedPct = realizedPct;
    } else {
      base.outcome = "miss";
      base.realizedPct = realizedPct;
    }
    return base;
  });
  const start = Math.max(0, candles.length - limit);
  return {
    candles: candles.slice(start),
    forecasts: forecasts.slice(start),
  };
}
