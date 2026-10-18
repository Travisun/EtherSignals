import type { Candle, NhnlRow, Timeframe } from '@/core/types';

/**
 * Multi-timeframe new-high / new-low ladder — the cross-chart trading
 * reference. For every timeframe in the ladder the row answers three
 * questions about the LIVE price:
 *   1. nh / nl      — is the price AT a new high/low of the still-forming bar?
 *                     (bar extremes include the latest tick, so this is exact)
 *   2. brkUp/brkDown — did the price break the previous CLOSED bar's high/low?
 *   3. donUp/donDown — did the price break the Donchian channel of the `donN`
 *                     closed bars before the current one? (donN=1 ⇒ previous bar)
 */

/** Ladder timeframes: minute ladder up to monthly. */
export const NHNL_TFS: Timeframe[] = ['1m', '1h', '4h', '8h', '12h', '1d', '2d', '3d', '1w', '1M'];

export const DEFAULT_DON_N = 20;

/**
 * Build one timeframe's row. `candles` ascending; the LAST bar is the
 * still-forming bar. Returns null when the window is empty or the price is
 * unusable (rows simply drop out of the ladder instead of showing garbage).
 */
export function computeNhnlRow(tf: Timeframe, candles: Candle[], price: number, donN = DEFAULT_DON_N): NhnlRow | null {
  if (!candles.length || !Number.isFinite(price) || price <= 0) return null;
  const last = candles[candles.length - 1];
  if (![last.high, last.low].every(Number.isFinite)) return null;
  const closed = candles.slice(0, -1);
  const prev = closed.at(-1) ?? null;
  const donSlice = closed.slice(-Math.max(0, donN));
  const donHigh = donSlice.length ? Math.max(...donSlice.map((c) => c.high)) : null;
  const donLow = donSlice.length ? Math.min(...donSlice.map((c) => c.low)) : null;
  return {
    tf,
    barTime: last.time,
    barHigh: last.high,
    barLow: last.low,
    nh: price >= last.high,
    nl: price <= last.low,
    prevHigh: prev ? prev.high : null,
    prevLow: prev ? prev.low : null,
    brkUp: prev != null && price > prev.high,
    brkDown: prev != null && price < prev.low,
    donHigh,
    donLow,
    donUp: donHigh != null && price > donHigh,
    donDown: donLow != null && price < donLow,
    // how far the price must travel (%, non-negative) to reach the forming
    // bar's high / low — 0 exactly when nh / nl
    distHighPct: ((last.high - price) / price) * 100,
    distLowPct: ((price - last.low) / price) * 100,
  };
}

/** Ladder snapshot from a map of per-tf windows (missing windows are skipped). */
export function computeNhnlSnapshot(
  windows: Partial<Record<Timeframe, Candle[]>>,
  price: number,
  donN = DEFAULT_DON_N,
): NhnlRow[] {
  const rows: NhnlRow[] = [];
  for (const tf of NHNL_TFS) {
    const candles = windows[tf];
    if (!candles?.length) continue;
    const row = computeNhnlRow(tf, candles, price, donN);
    if (row) rows.push(row);
  }
  return rows;
}
