import {
  sma, ema, rsi, macd, bollinger, kdj, atr, adx, supertrend, linregSlope,
} from '@/core/indicators';
import type { Candle, MarketType, Timeframe, TrendRegime } from '@/core/types';

// ─── Configuration ───────────────────────────────────────────────────────────
// Shared by the signal engine (live calls) and the optimizer (weight learning).
// Oversubscribing a fast TF is harmless: windows are refcounted and shared
// with the rule engine. Limits are picked so every TF carries enough CLOSED
// bars for EMA200 warmup (~200) plus a ~250-sample walk-forward tail.
export const SIGNAL_TFS: Timeframe[] = ['2m', '5m', '30m', '2h', '1d'];
export const ACQUIRE_LIMIT: Record<Timeframe, number> = { '1m': 500, '2m': 500, '5m': 500, '15m': 500, '30m': 500, '1h': 500, '2h': 500, '4h': 500, '6h': 500, '8h': 500, '12h': 500, '1d': 500, '2d': 500, '3d': 500, '1w': 500, '1M': 500 };
/** trend changes on fast TFs must persist this many closed bars before pushing */
export const CONFIRM_BARS: Record<Timeframe, number> = { '1m': 2, '2m': 2, '5m': 2, '15m': 1, '30m': 1, '1h': 1, '2h': 1, '4h': 1, '6h': 1, '8h': 1, '12h': 1, '1d': 1, '2d': 1, '3d': 1, '1w': 1, '1M': 1 };
export const SYMBOL = (process.env.GT_SIGNAL_SYMBOL || 'ETHUSDT').toUpperCase();
export const MARKET: MarketType = (process.env.GT_SIGNAL_MARKET as MarketType) || 'futures';
export const ENABLED = process.env.GT_SIGNALS !== '0';

// Composite-score parameters. Entry thresholds are symmetric bands; leaving a
// trend into neutral uses a narrower exit band (hysteresis) so a signal does
// not flicker when the score oscillates just around one threshold.
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

// ─── Indicator suite ─────────────────────────────────────────────────────────

export interface Suite {
  candles: Candle[];
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

export function computeSuite(candles: Candle[]): Suite {
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

/** directional outcome over the horizon: 1/-1 decisive, 0 within noise */
export function outcomeAt(s: Suite, i: number): 1 | -1 | 0 {
  const a = s.atr14[i];
  if (a == null) return 0;
  const move = s.closes[i + HORIZON_BARS] - s.closes[i];
  if (move > HIT_ATR * a) return 1;
  if (move < -HIT_ATR * a) return -1;
  return 0;
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

// ─── Patterns (形态) ─────────────────────────────────────────────────────────

export interface DetectedPattern { key: string; dir: 1 | -1 | 0 }

export function patternsAt(s: Suite, i: number): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const e20 = s.ema20[i];
  const e50 = s.ema50[i];
  const e200 = s.ema200[i];
  if (e20 != null && e50 != null && e200 != null) {
    if (e20 > e50 && e50 > e200) out.push({ key: 'ema_align_bull', dir: 1 });
    else if (e20 < e50 && e50 < e200) out.push({ key: 'ema_align_bear', dir: -1 });
  }
  const h = s.macd.hist;
  if (i >= 1 && h[i] != null && h[i - 1] != null) {
    const cur = h[i] as number;
    const prev = h[i - 1] as number;
    if (prev <= 0 && cur > 0) out.push({ key: 'macd_golden', dir: 1 });
    if (prev >= 0 && cur < 0) out.push({ key: 'macd_dead', dir: -1 });
  }
  if (i >= 1 && s.st.trend[i] !== s.st.trend[i - 1]) {
    out.push(s.st.trend[i] === 1 ? { key: 'st_flip_bull', dir: 1 } : { key: 'st_flip_bear', dir: -1 });
  }
  const r = s.rsi14[i];
  const rp = i >= 1 ? s.rsi14[i - 1] : null;
  if (r != null && rp != null) {
    if (rp < 30 && r >= 30) out.push({ key: 'rsi_recovery', dir: 1 });
    if (rp > 70 && r <= 70) out.push({ key: 'rsi_fade', dir: -1 });
  }
  if (i >= 20) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - 20; j < i; j++) {
      hh = Math.max(hh, s.candles[j].high);
      ll = Math.min(ll, s.candles[j].low);
    }
    if (s.closes[i] > hh) out.push({ key: 'donchian_break_up', dir: 1 });
    else if (s.closes[i] < ll) out.push({ key: 'donchian_break_down', dir: -1 });
  }
  // Bollinger squeeze: bandwidth in the lowest 15% of its trailing 120 bars —
  // a direction-neutral compression that precedes expansion (vol clustering).
  const bw = s.bandwidth[i];
  if (bw != null && i >= 119) {
    let rank = 0;
    let n = 0;
    for (let j = i - 119; j <= i; j++) {
      const v = s.bandwidth[j];
      if (v == null) continue;
      n += 1;
      if (v <= bw) rank += 1;
    }
    if (n >= 60 && rank / n <= 0.15) out.push({ key: 'bb_squeeze', dir: 0 });
  }
  return out;
}

/** sample counts for a probability estimate; wHit/wAll carry exponential
 *  recency weights (recent bars matter more than old ones — markets are
 *  non-stationary), n stays the raw count used for the sample-size gate */
export interface Stat { wins: number; n: number; wHit: number; wAll: number }
export const EMPTY_STAT = (): Stat => ({ wins: 0, n: 0, wHit: 0, wAll: 0 });
/** half-life (bars) of the recency weight: a sample from 250 bars ago counts half */
export const HALF_LIFE_BARS = 250;
/** Laplace-smoothed probability over recency-weighted samples */
export const laplace = (st: Stat): number | null =>
  st.n >= MIN_PROB_SAMPLES && st.wAll > 0 ? (st.wHit + 1) / (st.wAll + 2) : null;

/**
 * Walk-forward replay over the whole window: re-derives the regime at every
 * historical bar from indicator data available UP TO that bar, then checks
 * whether price moved in the regime direction ≥ HIT_ATR×ATR within HORIZON_BARS.
 * Both regime continuation rates and per-pattern hit rates come from the same
 * pass, so the probabilities are out-of-sample in the walk-forward sense.
 */
export function replayStats(s: Suite, confirmBars: number, weightOf: (name: string) => number) {
  const regimeStats = new Map<TrendRegime, Stat>();
  const patternStats = new Map<string, Stat>();
  const dirStats: Stat = EMPTY_STAT();
  let confirmed: TrendRegime = 'neutral';
  let pendingRegime: TrendRegime | null = null;
  let pendingCount = 0;
  let flips = 0;
  const regimeBars: Record<TrendRegime, number> = { strong_up: 0, up: 0, neutral: 0, down: 0, strong_down: 0 };
  const n = s.candles.length;
  const end = n - HORIZON_BARS; // need future bars to grade

  const gradeMove = (i: number, dir: 1 | -1 | 0): 1 | -1 | 0 => {
    const a = s.atr14[i];
    if (a == null) return 0;
    const move = s.closes[i + HORIZON_BARS] - s.closes[i];
    const thr = HIT_ATR * a;
    if (dir === 0) return Math.abs(move) < RANGE_HOLD_ATR * a ? 1 : -1; // range held vs broke out
    if (dir === 1 && move > thr) return 1;
    if (dir === -1 && move < -thr) return 1;
    if (dir === 1 && move < -thr) return -1;
    if (dir === -1 && move > thr) return -1;
    return 0;
  };

  for (let i = 1; i < end; i++) {
    const { score } = scoreAt(s, i, weightOf);
    const adxVal = s.adx14.adx[i];
    const next = regimeWithHysteresis(confirmed, score, adxVal == null ? null : adxVal);
    if (next !== confirmed) {
      if (pendingRegime === next) pendingCount += 1;
      else {
        pendingRegime = next;
        pendingCount = 1;
      }
      if (pendingCount >= confirmBars) {
        confirmed = next;
        pendingRegime = null;
        pendingCount = 0;
        flips += 1;
      }
    } else {
      pendingRegime = null;
      pendingCount = 0;
    }

    regimeBars[confirmed] += 1;
    const dir = regimeDir(confirmed);
    // recency weight: exponential decay so a regime change re-anchors the
    // statistics instead of being diluted by hundreds of stale bars
    const w = Math.pow(0.5, (end - 1 - i) / HALF_LIFE_BARS);
    // every regime gets a continuation stat; neutral counts "range held"
    const st = regimeStats.get(confirmed) ?? EMPTY_STAT();
    st.n += 1;
    st.wAll += w;
    const outcome = gradeMove(i, dir);
    if (outcome === 1) {
      st.wins += 1;
      st.wHit += w;
    }
    if (dir !== 0 && outcome !== 0) {
      dirStats.n += 1;
      if (outcome === 1) dirStats.wins += 1;
    }
    regimeStats.set(confirmed, st);
    for (const p of patternsAt(s, i)) {
      const pst = patternStats.get(p.key) ?? EMPTY_STAT();
      if (p.dir === 0) {
        // squeeze: "hit" = any expansion beyond SQUEEZE_HIT_ATR×ATR
        const a = s.atr14[i];
        const move = a == null ? 0 : Math.abs(s.closes[i + HORIZON_BARS] - s.closes[i]);
        if (a != null) { pst.n += 1; pst.wAll += w; if (move > SQUEEZE_HIT_ATR * a) { pst.wins += 1; pst.wHit += w; } }
      } else {
        const outcome2 = gradeMove(i, p.dir);
        if (outcome2 !== 0) { pst.n += 1; pst.wAll += w; if (outcome2 === 1) { pst.wins += 1; pst.wHit += w; } }
      }
      patternStats.set(p.key, pst);
    }
  }
  return { regimeStats, patternStats, dirStats, flips, regimeBars, bars: end - 1 };
}
