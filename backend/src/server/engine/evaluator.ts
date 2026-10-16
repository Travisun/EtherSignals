import { bollinger, macd as macdCalc, rsi as rsiCalc, sma } from '@/core/indicators';
import { describeCondition } from '@/core/conditionTexts';
import type { Candle, Condition, ConditionLogic, MarketType, Timeframe } from '@/core/types';

export interface WindowSelector {
  tf?: Timeframe;
  symbol?: string;
  marketType?: MarketType;
}

export interface EvalCtx {
  /** base window — the strategy's own symbol/timeframe (ascending, last bar may be forming) */
  candles: Candle[];
  /** latest price of the strategy's own symbol */
  price: number;
  llmBias?: { bias: 'long' | 'short' | 'neutral'; confidence: number };
  /**
   * Window resolver for cross-timeframe / cross-symbol conditions. Returns
   * undefined when the referenced series is unavailable (condition = false).
   */
  getWindow?: (sel: WindowSelector) => Candle[] | undefined;
}

export interface EvalResult {
  matched: boolean;
  matchedIds: string[];
  /** {code, params} pairs for localized rendering */
  matchedDetails: { code: string; params: Record<string, string | number> }[];
}

const n = (v: unknown, def = 0) => {
  const x = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(x) ? x : def;
};

/**
 * Pure condition evaluator, shared by the live rule engine and the
 * backtester. Conditions may reference their own timeframe / symbol /
 * market (multi-timeframe & cross-symbol factor conditions); all cross
 * detections compare the last two bars of the referenced window.
 */
export function evaluateConditions(
  conditions: Condition[],
  logic: ConditionLogic,
  ctx: EvalCtx,
): EvalResult {
  if (!conditions.length) return { matched: false, matchedIds: [], matchedDetails: [] };
  const results = conditions.map((c) => checkOne(c, ctx));
  const matchedIdx = results.map((r) => r.matched);
  const matched = logic === 'all' ? matchedIdx.every(Boolean) : matchedIdx.some(Boolean);
  if (!matched) return { matched: false, matchedIds: [], matchedDetails: [] };
  const matchedConditions = conditions.filter((_, i) => matchedIdx[i]);
  return {
    matched: true,
    matchedIds: matchedConditions.map((c) => c.id),
    matchedDetails: matchedConditions.map((c) => ({
      code: c.type,
      params: Object.fromEntries(Object.entries(c.params).map(([k, v]) => [k, String(v)])),
    })),
  };
}

/** Resolve the candle window a condition applies to. */
function windowFor(cond: Condition, ctx: EvalCtx): { candles: Candle[]; price: number } | null {
  const scoped = Boolean(cond.tf || cond.symbol || cond.marketType);
  if (!scoped) {
    return ctx.candles.length ? { candles: ctx.candles, price: ctx.price || ctx.candles.at(-1)!.close } : null;
  }
  const win = ctx.getWindow?.({ tf: cond.tf, symbol: cond.symbol, marketType: cond.marketType });
  if (!win || win.length < 2) return null;
  return { candles: win, price: win.at(-1)!.close };
}

function checkOne(c: Condition, ctx: EvalCtx): { matched: boolean } {
  const w = windowFor(c, ctx);
  if (!w) return { matched: false };
  const candles = w.candles;
  const p = w.price;
  const i = candles.length - 1;
  const prev = candles[i - 1];
  const closes = candles.map((x) => x.close);

  switch (c.type) {
    case 'price_above':
      return { matched: p > n(c.params.value) };
    case 'price_below':
      return { matched: p < n(c.params.value) };
    case 'price_cross_up':
      return { matched: prev.close <= n(c.params.value) && p > n(c.params.value) };
    case 'price_cross_down':
      return { matched: prev.close >= n(c.params.value) && p < n(c.params.value) };
    case 'price_change_pct': {
      const bars = Math.max(1, Math.floor(n(c.params.bars, 5)));
      const j = Math.max(0, i - bars);
      const base = closes[j];
      const changePct = base ? ((p - base) / base) * 100 : 0;
      const target = n(c.params.pct, 3);
      return { matched: target >= 0 ? changePct >= target : changePct <= target };
    }
    case 'rsi_above':
    case 'rsi_below': {
      const period = Math.max(2, Math.floor(n(c.params.period, 14)));
      if (closes.length < period + 2) return { matched: false };
      const series = rsiCalc(closes, period);
      const v = series[i];
      if (v == null) return { matched: false };
      return c.type === 'rsi_above'
        ? { matched: v > n(c.params.value, 70) }
        : { matched: v < n(c.params.value, 30) };
    }
    case 'macd_golden':
    case 'macd_death': {
      if (closes.length < 40) return { matched: false };
      const { macd, signal } = macdCalc(closes);
      const m0 = macd[i], s0 = signal[i], m1 = macd[i - 1], s1 = signal[i - 1];
      if (m0 == null || s0 == null || m1 == null || s1 == null) return { matched: false };
      const golden = m1 <= s1 && m0 > s0;
      const death = m1 >= s1 && m0 < s0;
      return { matched: c.type === 'macd_golden' ? golden : death };
    }
    case 'ma_cross_up':
    case 'ma_cross_down': {
      const fast = Math.max(2, Math.floor(n(c.params.fast, 5)));
      const slow = Math.max(fast + 1, Math.floor(n(c.params.slow, 20)));
      if (closes.length < slow + 2) return { matched: false };
      const maF = sma(closes, fast);
      const maS = sma(closes, slow);
      const f0 = maF[i], s0v = maS[i], f1 = maF[i - 1], s1v = maS[i - 1];
      if (f0 == null || s0v == null || f1 == null || s1v == null) return { matched: false };
      const up = f1 <= s1v && f0 > s0v;
      const down = f1 >= s1v && f0 < s0v;
      return { matched: c.type === 'ma_cross_up' ? up : down };
    }
    case 'volume_spike': {
      const ratio = n(c.params.ratio, 3);
      if (candles.length < 21) return { matched: false };
      const vols = candles.map((x) => x.baseVol ?? 0);
      const avg = sma(vols, 20)[i - 1];
      return { matched: avg != null && avg > 0 && (vols[i] ?? 0) > avg * ratio };
    }
    case 'boll_break_up':
    case 'boll_break_down': {
      const period = Math.max(5, Math.floor(n(c.params.period, 20)));
      const mult = n(c.params.mult, 2);
      if (closes.length < period + 2) return { matched: false };
      const { upper, lower } = bollinger(closes, period, mult);
      const u = upper[i], l = lower[i];
      if (u == null || l == null) return { matched: false };
      return c.type === 'boll_break_up'
        ? { matched: p > u && prev.close <= u }
        : { matched: p < l && prev.close >= l };
    }
    case 'llm_bias': {
      if (!ctx.llmBias) return { matched: false };
      const want = String(c.params.bias ?? 'long') as 'long' | 'short' | 'neutral';
      const minConf = n(c.params.minConfidence, 60);
      return { matched: ctx.llmBias.bias === want && ctx.llmBias.confidence >= minConf };
    }
    default:
      return { matched: false };
  }
}

export { describeCondition };

/** Distinct external windows referenced by a condition set (excl. base). */
export function requiredWindows(
  conditions: Condition[],
  base: { symbol: string; marketType: MarketType; timeframe: Timeframe },
): { marketType: MarketType; symbol: string; tf: Timeframe }[] {
  const out = new Map<string, { marketType: MarketType; symbol: string; tf: Timeframe }>();
  for (const c of conditions) {
    if (c.type === 'llm_bias') continue;
    if (!c.tf && !c.symbol && !c.marketType) continue;
    const marketType = c.marketType ?? base.marketType;
    const symbol = (c.symbol ?? base.symbol).toUpperCase();
    const tf = c.tf ?? base.timeframe;
    const key = `${marketType}:${symbol}:${tf}`;
    if (!out.has(key)) out.set(key, { marketType, symbol, tf });
  }
  return [...out.values()];
}
