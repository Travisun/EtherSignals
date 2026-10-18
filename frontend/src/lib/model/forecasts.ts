/**
 * Per-candle model forecast — client-side replay of the same formulas the
 * producer's engine runs (see ./core.ts, a mirror of signalCore.ts).
 * One pass over the candles: multi-vote score → regime state machine
 * (hysteresis + confirm bars) → regime continuation probability
 * (Laplace-smoothed over recency-weighted walk-forward grades).
 */
import {
  BASE_WEIGHTS,
  computeSuite,
  laplace,
  regimeDir,
  regimeWithHysteresis,
  scoreAt,
  type ModelCandle,
  type TrendRegime,
} from "./core";

const HALF_LIFE = 250;
const HORIZON = 3;
const HIT_ATR = 0.5;
/** trend changes must persist this many closed bars (mirrors CONFIRM_BARS) */
const CONFIRM: Record<string, number> = { "1m": 2, "2m": 2 };

export interface ForecastBar {
  time: number;
  dir: 1 | -1 | 0;
  regime: TrendRegime;
  score: number;
  /** Laplace-smoothed regime continuation probability (null while warming) */
  prob: number | null;
}

/**
 * @param candles ascending candles (any timeframe)
 * @param tf     the timeframe of those candles (drives the confirm-bar rule)
 * @returns one entry per input candle; null before the indicator warmup
 */
export function computeForecasts(
  candles: ModelCandle[],
  tf: string,
): (ForecastBar | null)[] {
  const out: (ForecastBar | null)[] = candles.map(() => null);
  if (candles.length < 80) return out;
  const suite = computeSuite(candles);
  const weightOf = (name: string) => BASE_WEIGHTS[name] ?? 1;
  const confirmBars = CONFIRM[tf] ?? 1;
  const regimeStats = new Map<TrendRegime, { wins: number; n: number; wHit: number; wAll: number }>();
  let confirmed: TrendRegime = "neutral";
  let pending: TrendRegime | null = null;
  let pendingCount = 0;
  const n = candles.length;
  const gradedEnd = n - HORIZON;

  const grade = (i: number, dir: 1 | -1): 1 | -1 | 0 => {
    const a = suite.atr14[i];
    if (a == null) return 0;
    const move = suite.closes[i + HORIZON] - suite.closes[i];
    const thr = HIT_ATR * a;
    if (dir === 1 && move > thr) return 1;
    if (dir === -1 && move < -thr) return 1;
    if (dir === 1 && move < -thr) return -1;
    if (dir === -1 && move > thr) return -1;
    return 0;
  };

  for (let i = 60; i < n; i++) {
    const { score } = scoreAt(suite, i, weightOf);
    const adxVal = suite.adx14.adx[i] ?? null;
    const next = regimeWithHysteresis(confirmed, score, adxVal);
    if (next !== confirmed) {
      if (pending === next) pendingCount += 1;
      else {
        pending = next;
        pendingCount = 1;
      }
      if (pendingCount >= confirmBars) {
        confirmed = next;
        pending = null;
        pendingCount = 0;
      }
    } else {
      pending = null;
      pendingCount = 0;
    }

    const dir = regimeDir(confirmed);
    let prob: number | null = null;
    if (i < gradedEnd && dir !== 0) {
      // walk-forward grading: recency-weighted, Laplace-smoothed
      const st = regimeStats.get(confirmed) ?? { wins: 0, n: 0, wHit: 0, wAll: 0 };
      const w = Math.pow(0.5, (gradedEnd - 1 - i) / HALF_LIFE);
      st.n += 1;
      st.wAll += w;
      const outcome = grade(i, dir);
      if (outcome === 1) {
        st.wins += 1;
        st.wHit += w;
      }
      regimeStats.set(confirmed, st);
      prob = laplace(st);
    } else if (dir !== 0) {
      const st = regimeStats.get(confirmed);
      prob = st ? laplace(st) : null;
    }
    out[i] = {
      time: candles[i].time,
      dir,
      regime: confirmed,
      score: Number(score.toFixed(3)),
      prob,
    };
  }
  return out;
}
