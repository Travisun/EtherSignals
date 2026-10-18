/**
 * MIRROR of backend/src/server/engine/signalCore.ts (model math only —
 * constants, vote table, suite computation, regime walk, replay stats).
 * Keep formulas in sync with the backend when the model changes; the
 * chart page runs this client-side so every historical candle carries the
 * model's per-candle forecast without any extra network calls.
 */
import { adx, atr, bollinger, ema, kdj, linregSlope, macd, sma, supertrend, rsi } from "./indicators";

export type TrendRegime = "strong_up" | "up" | "neutral" | "down" | "strong_down";

export interface ModelCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  baseVol?: number;
}

// ─── regime thresholds ───
export const ENTER_TREND = 0.16;
export const ENTER_STRONG = 0.42;
export const EXIT_TREND = 0.08;
export const STRONG_ADX_GATE = 20;
/** walk-forward horizon (bars ahead) and the ATR move that counts as a hit.
 * HIT_ATR is deliberately large enough to filter random noise: a 3-bar net
 * move beyond 0.5×ATR is decisive, whereas 0.15×ATR would make nearly every
 * sample "decisive" and pin all probabilities near 50%. */
export const HORIZON_BARS = 3;
export const HIT_ATR = 0.5;
/** neutral "range held" test: |move| below 1.0×ATR over the horizon */
export const RANGE_HOLD_ATR = 1.0;
export const SQUEEZE_HIT_ATR = 1.2;
export const MIN_PROB_SAMPLES = 15;
/** telegram channel rate limit: minimum spacing between trend pushes.
 *  Conservative vs Telegram's ~50 msg/min channel budget — bursts are
 *  coalesced into one 10s-fresh board rather than dropped. */
export const TG_MIN_INTERVAL_MS = 10_000;


export interface Suite {
  candles: ModelCandle[];
  closes: number[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  ema200: (number | null)[];
  rsi14: (number | null)[];
  macd: ReturnType<typeof macd>;
  boll: ReturnType<typeof bollinger>;
  kdj: ReturnType<typeof kdj>;
  atr14: (number | null)[];
  adx14: ReturnType<typeof adx>;
  st: ReturnType<typeof supertrend>;
  slope: (number | null)[];
  volMa: (number | null)[];
  /** bollinger bandwidth (upper-lower)/mid, for squeeze detection */
  bandwidth: (number | null)[];
}
export function computeSuite(candles: ModelCandle[]): Suite {
  const closes = candles.map((c) => c.close);
  const boll = bollinger(closes);
  const bandwidth = boll.mid.map((m, i) => {
    const u = boll.upper[i];
    const l = boll.lower[i];
    return m != null && u != null && l != null && m !== 0 ? (u - l) / m : null;
  });
  return {
    candles,
    closes,
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    boll,
    kdj: kdj(candles),
    atr14: atr(candles, 14),
    adx14: adx(candles, 14),
    st: supertrend(candles, 10, 3),
    slope: linregSlope(closes, 20),
    volMa: sma(candles.map((c) => c.baseVol ?? 0), 20),
    bandwidth,
  };
}
export const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
/** Base (prior) vote weights — the optimizer adapts these per timeframe. */
export const BASE_WEIGHTS: Record<string, number> = {
  ema_stack: 1.4,
  adx_dmi: 1.4,
  macd: 1.2,
  supertrend: 1.2,
  linreg_drift: 1.1,
  donchian: 0.9,
  prev_break: 0.7,
  volume_flow: 0.8,
  rsi: 0.7,
  boll_pctb: 0.6,
  kdj: 0.6,
};

/** One indicator's vote in [-1, 1] at bar i. All are standard, published formulas. */
type Vote = (s: Suite, i: number) => number | null;

/**
 * Weighted votes. Every entry is a textbook indicator (Wilder DMI, MACD,
 * SuperTrend, RSI, KDJ, Bollinger %B, EMA stack, volume flow, regression
 * drift); the composite is a weighted mean. Weights are resolved through
 * `weightOf` so the optimizer can adapt them per timeframe.
 */
export const VOTES: { name: string; fn: Vote }[] = [
  {
    name: 'ema_stack',
    fn: (s, i) => {
      const c = s.closes[i];
      const e20 = s.ema20[i];
      const e50 = s.ema50[i];
      const e200 = s.ema200[i];
      if (e20 == null || e50 == null) return null;
      let sum = 0;
      let n = 0;
      sum += c > e20 ? 1 : -1; n += 1;
      sum += e20 > e50 ? 1 : -1; n += 1;
      if (e200 != null) { sum += e50 > e200 ? 1 : -1; n += 1; }
      return sum / n;
    },
  },
  {
    name: 'adx_dmi',
    fn: (s, i) => {
      const a = s.adx14.adx[i];
      const p = s.adx14.plusDI[i];
      const m = s.adx14.minusDI[i];
      if (a == null || p == null || m == null) return null;
      const dir = p > m ? 1 : p < m ? -1 : 0;
      // strength ramps 18→40 so a marginal ADX barely tilts the composite
      return dir * clamp((a - 18) / 22, 0, 1);
    },
  },
  {
    name: 'macd',
    fn: (s, i) => {
      const h = s.macd.hist[i];
      const a = s.atr14[i];
      if (h == null || a == null || a === 0) return null;
      return clamp((h / a) * 3);
    },
  },
  {
    name: 'supertrend',
    fn: (s, i) => (i === 0 ? null : s.st.trend[i] === s.st.trend[i - 1] ? s.st.trend[i] * 0.85 : s.st.trend[i]),
  },
  {
    name: 'linreg_drift',
    fn: (s, i) => {
      const sl = s.slope[i];
      const a = s.atr14[i];
      if (sl == null || a == null || a === 0) return null;
      // 0.05 ATR/bar drift over the 20-bar window = full bullish vote
      return clamp((sl / a) * 20);
    },
  },
  {
    name: 'volume_flow',
    fn: (s, i) => {
      if (i < 10) return null;
      let up = 0;
      let down = 0;
      for (let j = i - 9; j <= i; j++) {
        const v = s.candles[j].baseVol ?? 0;
        if (s.candles[j].close >= s.candles[j].open) up += v;
        else down += v;
      }
      if (up + down === 0) return null;
      return clamp((up - down) / (up + down));
    },
  },
  {
    name: 'rsi',
    fn: (s, i) => {
      const r = s.rsi14[i];
      if (r == null) return null;
      let v = clamp((r - 50) / 20);
      // exhaustion cap: extreme readings argue for fading, not chasing
      if (r > 72) v = Math.min(v, 0.25);
      if (r < 28) v = Math.max(v, -0.25);
      return v;
    },
  },
  {
    name: 'boll_pctb',
    fn: (s, i) => {
      const u = s.boll.upper[i];
      const l = s.boll.lower[i];
      if (u == null || l == null || u === l) return null;
      const pctB = (s.closes[i] - l) / (u - l);
      let v = clamp((pctB - 0.5) * 2);
      if (pctB > 1) v = 0.3; // riding above the band: bullish but overextended
      if (pctB < 0) v = -0.3;
      return v;
    },
  },
  {
    name: 'kdj',
    fn: (s, i) => {
      const k = s.kdj.k[i];
      const d = s.kdj.d[i];
      if (k == null || d == null) return null;
      return clamp((k - d) / 15);
    },
  },
  {
    // NHNL family — position within the PREVIOUS bar's range: a close above
    // the prior bar's high (previous-bar break) votes full bullish, below its
    // low full bearish, inside scales linearly. Pure candle math, so the
    // optimizer's walk-forward replay grades it like any other component.
    name: 'prev_break',
    fn: (s, i) => {
      if (i < 1) return null;
      const prev = s.candles[i - 1];
      const mid = (prev.high + prev.low) / 2;
      const half = (prev.high - prev.low) / 2;
      if (!(half > 0)) return null;
      return clamp((s.closes[i] - mid) / half);
    },
  },
  {
    // NHNL family — position within the Donchian-20 channel of CLOSED bars:
    // a fresh 20-bar high votes full bullish, a fresh low full bearish, and
    // the mid-channel position scales linearly toward the extremes.
    name: 'donchian',
    fn: (s, i) => {
      if (i < 20) return null;
      let hi = -Infinity;
      let lo = Infinity;
      for (let j = i - 20; j < i; j++) {
        hi = Math.max(hi, s.candles[j].high);
        lo = Math.min(lo, s.candles[j].low);
      }
      if (!(hi > lo)) return null;
      return clamp(((s.closes[i] - lo) / (hi - lo)) * 2 - 1);
    },
  },
];

export function scoreAt(
  s: Suite,
  i: number,
  weightOf: (name: string) => number,
): { score: number; votes: Record<string, number> } {
  let wsum = 0;
  let vsum = 0;
  const votes: Record<string, number> = {};
  for (const v of VOTES) {
    const val = v.fn(s, i);
    if (val == null) continue;
    votes[v.name] = val;
    const w = weightOf(v.name);
    wsum += w;
    vsum += val * w;
  }
  return { score: wsum > 0 ? vsum / wsum : 0, votes };
}
function regimeFromScore(score: number, adxVal: number | null): TrendRegime {
  const strongGate = (adxVal ?? 0) >= STRONG_ADX_GATE;
  if (score >= ENTER_STRONG) return strongGate ? 'strong_up' : 'up';
  if (score <= -ENTER_STRONG) return strongGate ? 'strong_down' : 'down';
  if (score >= ENTER_TREND) return 'up';
  if (score <= -ENTER_TREND) return 'down';
  return 'neutral';
}

/** Asymmetric exit band: an active trend survives a mild score pullback. */
export function regimeWithHysteresis(prev: TrendRegime, score: number, adxVal: number | null): TrendRegime {
  const raw = regimeFromScore(score, adxVal);
  if (raw === prev) return prev;
  if ((prev === 'up' || prev === 'strong_up') && raw === 'neutral' && score >= EXIT_TREND) return prev;
  if ((prev === 'down' || prev === 'strong_down') && raw === 'neutral' && score <= -EXIT_TREND) return prev;
  return raw;
}

export const regimeDir = (r: TrendRegime): 1 | -1 | 0 =>
  r === 'up' || r === 'strong_up' ? 1 : r === 'down' || r === 'strong_down' ? -1 : 0;
export interface Stat { wins: number; n: number; wHit: number; wAll: number }
export const EMPTY_STAT = (): Stat => ({ wins: 0, n: 0, wHit: 0, wAll: 0 });
/** half-life (bars) of the recency weight: a sample from 250 bars ago counts half */
export const HALF_LIFE_BARS = 250;
/** Laplace-smoothed probability over recency-weighted samples */
export const laplace = (st: Stat): number | null =>
  st.n >= MIN_PROB_SAMPLES && st.wAll > 0 ? (st.wHit + 1) / (st.wAll + 2) : null;

