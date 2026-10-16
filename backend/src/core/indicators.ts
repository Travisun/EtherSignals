import type { Candle, Timeframe } from '@/core/types';

// ─── Primitive series math ───────────────────────────────────────────────────

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i === period - 1) {
      prev = sum / period;
      out[i] = prev;
    } else if (prev !== null) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function stdDev(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += values[j];
    mean /= period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - mean) ** 2;
    out[i] = Math.sqrt(variance / period);
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );
  const defined = macdLine.map((v) => v ?? 0);
  const firstIdx = macdLine.findIndex((v) => v != null);
  const signalRaw = ema(defined.slice(firstIdx), signalPeriod);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    for (let i = 0; i < signalRaw.length; i++) signal[firstIdx + i] = signalRaw[i];
  }
  const hist = macdLine.map((v, i) =>
    v != null && signal[i] != null ? v - (signal[i] as number) : null,
  );
  return { macd: macdLine, signal, hist };
}

export interface BollResult {
  mid: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export function bollinger(values: number[], period = 20, mult = 2): BollResult {
  const mid = sma(values, period);
  const sd = stdDev(values, period);
  return {
    mid,
    upper: mid.map((m, i) => (m != null && sd[i] != null ? m + mult * (sd[i] as number) : null)),
    lower: mid.map((m, i) => (m != null && sd[i] != null ? m - mult * (sd[i] as number) : null)),
  };
}

export interface KdjResult {
  k: (number | null)[];
  d: (number | null)[];
  j: (number | null)[];
}

export function kdj(candles: Candle[], period = 9, kSmooth = 3, dSmooth = 3): KdjResult {
  const n = candles.length;
  const rsv: number[] = new Array(n).fill(50);
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - period + 1);
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = from; j <= i; j++) {
      hh = Math.max(hh, candles[j].high);
      ll = Math.min(ll, candles[j].low);
    }
    rsv[i] = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;
  }
  const k: (number | null)[] = new Array(n).fill(null);
  const d: (number | null)[] = new Array(n).fill(null);
  const j: (number | null)[] = new Array(n).fill(null);
  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < n; i++) {
    prevK = (rsv[i] + (kSmooth - 1) * prevK) / kSmooth;
    prevD = (prevK + (dSmooth - 1) * prevD) / dSmooth;
    k[i] = prevK;
    d[i] = prevD;
    j[i] = 3 * prevK - 2 * prevD;
  }
  return { k, d, j };
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  return ema(tr, period);
}

// ─── Trend-regime indicators (signal engine) ─────────────────────────────────

/** Wilder's smoothing (RMA): seeded with a simple average, then prev + (v - prev)/n */
function wilder(values: number[], period: number): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      prev += values[i];
      if (i === period - 1) {
        prev /= period;
        out.push(prev);
      } else {
        out.push(NaN);
      }
    } else {
      prev = prev + (values[i] - prev) / period;
      out.push(prev);
    }
  }
  return out;
}

export interface AdxResult {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
}

/**
 * Average Directional Index with +DI/-DI (Wilder 1978). The canonical
 * trend-strength measure: ADX>25 strong trend, <20 range.
 */
export function adx(candles: Candle[], period = 14): AdxResult {
  const n = candles.length;
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  const tr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prevClose), Math.abs(candles[i].low - prevClose));
  }
  const smTR = wilder(tr, period);
  const smPlus = wilder(plusDM, period);
  const smMinus = wilder(minusDM, period);
  const plusDI: (number | null)[] = new Array(n).fill(null);
  const minusDI: (number | null)[] = new Array(n).fill(null);
  const dx: number[] = new Array(n).fill(NaN);
  for (let i = period; i < n; i++) {
    if (!Number.isFinite(smTR[i]) || smTR[i] === 0) continue;
    const p = (100 * smPlus[i]) / smTR[i];
    const m = (100 * smMinus[i]) / smTR[i];
    plusDI[i] = p;
    minusDI[i] = m;
    const sum = p + m;
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(p - m)) / sum;
  }
  const firstDx = dx.findIndex((v) => Number.isFinite(v));
  const adxOut: (number | null)[] = new Array(n).fill(null);
  if (firstDx >= 0 && firstDx + period <= n) {
    const seeded = wilder(dx.slice(firstDx), period);
    for (let i = 0; i < seeded.length; i++) {
      if (Number.isFinite(seeded[i])) adxOut[firstDx + i] = seeded[i];
    }
  }
  return { adx: adxOut, plusDI, minusDI };
}

export interface SuperTrendResult {
  /** per-bar direction: 1 bull (price above line), -1 bear */
  trend: (1 | -1)[];
  line: (number | null)[];
}

/**
 * SuperTrend (Olivier Seban) — ATR bands that trail price and flip on
 * penetration. Implemented per the common formulation used by freqtrade /
 * TradingView: band only ratchets in the trend direction.
 */
export function supertrend(candles: Candle[], period = 10, mult = 3): SuperTrendResult {
  const n = candles.length;
  const atrs = atr(candles, period);
  const trend: (1 | -1)[] = new Array(n).fill(1);
  const line: (number | null)[] = new Array(n).fill(null);
  let finalUpper = Infinity;
  let finalLower = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = atrs[i];
    if (a == null) continue;
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const upperBasic = hl2 + mult * a;
    const lowerBasic = hl2 - mult * a;
    const prevClose = i > 0 ? candles[i - 1].close : candles[i].close;
    finalUpper = upperBasic < finalUpper || prevClose > finalUpper ? upperBasic : finalUpper;
    finalLower = lowerBasic > finalLower || prevClose < finalLower ? lowerBasic : finalLower;
    const prevTrend = i > 0 ? trend[i - 1] : 1;
    let cur: 1 | -1 = prevTrend;
    if (candles[i].close > finalUpper) cur = 1;
    else if (candles[i].close < finalLower) cur = -1;
    trend[i] = cur;
    line[i] = cur === 1 ? finalLower : finalUpper;
  }
  return { trend, line };
}

/**
 * Least-squares regression slope over a trailing window, per bar.
 * Positive = upward drift, measured in price units per bar.
 */
export function linregSlope(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const n = period;
  const meanT = (n - 1) / 2;
  let varT = 0;
  for (let t = 0; t < n; t++) varT += (t - meanT) ** 2;
  for (let i = period - 1; i < values.length; i++) {
    let meanY = 0;
    for (let j = i - period + 1; j <= i; j++) meanY += values[j];
    meanY /= n;
    let cov = 0;
    let j = 0;
    for (let k = i - period + 1; k <= i; k++, j++) cov += (j - meanT) * (values[k] - meanY);
    out[i] = cov / varT;
  }
  return out;
}

// ─── Indicator series container used by the chart & rule engine ─────────────

export interface IndicatorSeries {
  ma?: (number | null)[][];
  ema?: (number | null)[][];
  boll?: BollResult;
  rsi?: (number | null)[];
  macd?: MacdResult;
  kdj?: KdjResult;
  volMa?: (number | null)[];
  atr?: (number | null)[];
}

export function computeIndicators(
  candles: Candle[],
  opts: { maPeriods?: number[]; emaPeriods?: number[]; boll?: boolean; rsi?: boolean; macd?: boolean; kdj?: boolean; atr?: boolean } = {},
): IndicatorSeries {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.baseVol ?? 0);
  const s: IndicatorSeries = {};
  if (opts.maPeriods?.length) s.ma = opts.maPeriods.map((p) => sma(closes, p));
  if (opts.emaPeriods?.length) s.ema = opts.emaPeriods.map((p) => ema(closes, p));
  if (opts.boll) s.boll = bollinger(closes);
  if (opts.rsi) s.rsi = rsi(closes, 14);
  if (opts.macd) s.macd = macd(closes);
  if (opts.kdj) s.kdj = kdj(candles);
  if (opts.atr) s.atr = atr(candles);
  if (candles.length >= 20) s.volMa = sma(volumes, 20);
  return s;
}

/** tfLabel for chart display */
export function tfLabel(tf: Timeframe): string {
  return tf.toUpperCase().replace('D', 'D');
}
