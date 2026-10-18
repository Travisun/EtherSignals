
/**
 * Process-wide market-data memory cache with single-flight dedup. Browsers
 * hitting /api/market/candles share ONE upstream fetch per 10s window — the
 * public feed distributes from here instead of hammering the exchange.
 * Single-instance assumption, same as the rate limiter.
 */

const TTL_MS = 10_000;

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
const GRANULARITY: Record<string, string> = {
  // Bitget v2 MIX granularity uses the compact style (1m/5m/1H/4H) — the
  // spot-style "5min" vocabulary gets a 400 from this endpoint
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "4h": "4H",
};

export const CHART_TFS = Object.keys(GRANULARITY);

export async function fetchCandles(tf: string, limit: number): Promise<MarketCandle[]> {
  const granularity = GRANULARITY[tf];
  if (!granularity) throw new Error(`unsupported timeframe: ${tf}`);
  const url =
    `https://api.bitget.com/api/v2/mix/market/candles` +
    `?symbol=ETHUSDT&productType=USDT-FUTURES&granularity=${granularity}&limit=${Math.min(limit, 500)}`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const body = (await res.json()) as { code?: string; data?: string[][] };
  if (body.code !== "00000" || !Array.isArray(body.data)) throw new Error("upstream payload");
  const rows = body.data
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
  return rows;
}
