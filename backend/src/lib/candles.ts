import type { Candle, Timeframe } from '@/core/types';
import { tfSeconds } from '@/lib/format';

/**
 * Synthetic timeframes: Bitget does not natively provide 2-minute / 2-hour
 * candles, so they are aggregated locally from their base series (1m / 1h)
 * on every layer — server engine windows, backtests and the browser chart.
 */
export const SYNTH_TF: Partial<Record<Timeframe, { base: Timeframe; seconds: number }>> = {
  '2m': { base: '1m', seconds: 120 },
  '2h': { base: '1h', seconds: 7200 },
  '8h': { base: '1h', seconds: 28800 },
  '2d': { base: '1d', seconds: 172800 },
};

export function synthSpec(tf: Timeframe) {
  return SYNTH_TF[tf] ?? null;
}

/** Bar multiplier vs. the base series (2m→2×1m, 8h→8×1h, others→1). */
export function tfMultiplier(tf: Timeframe): number {
  const spec = SYNTH_TF[tf];
  return spec ? spec.seconds / tfSeconds(spec.base) : 1;
}

export function upsertCandle(arr: Candle[], c: Candle): void {
  // insert in time order — reconnect snapshot/catch-up batches can deliver
  // older bars after newer ones, and charts assert on non-ascending input
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].time === c.time) {
      arr[i] = c;
      return;
    }
    if (arr[i].time < c.time) {
      arr.splice(i + 1, 0, c);
      return;
    }
  }
  arr.unshift(c);
}

/**
 * Aggregate base candles into fixed buckets (UTC-aligned).
 * open = first open, high/low = extremes, close = last close, volumes summed.
 */
export function aggregateCandles(base: Candle[], bucketSeconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  const sorted = base.length > 1 && base[1].time < base[0].time ? [...base].sort((a, b) => a.time - b.time) : base;
  for (const c of sorted) {
    const bucket = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    const cur = buckets.get(bucket);
    if (!cur) {
      buckets.set(bucket, { ...c, time: bucket });
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.baseVol = (cur.baseVol ?? 0) + (c.baseVol ?? 0);
      cur.quoteVol = (cur.quoteVol ?? 0) + (c.quoteVol ?? 0);
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
