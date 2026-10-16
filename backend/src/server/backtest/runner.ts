import { evaluateConditions, requiredWindows } from '@/server/engine/evaluator';
import { candleService } from '@/server/engine/candleService';
import { BitgetRest } from '@/server/bitget/rest';
import { tfSeconds } from '@/lib/format';
import type { BacktestConfig, BacktestResult, BacktestStats, BacktestTrade, Candle, Condition, ConditionLogic, ConditionType, MarketType, Timeframe } from '@/core/types';

const EVAL_WINDOW = 300; // bars passed to the evaluator each step
const WARMUP_BARS = 100; // indicator seed stabilisation — no signals before this
const MAINT_MARGIN_RATE = 0.005; // simplified Bitget tier-1 maintenance margin

interface OpenPos {
  side: 'long' | 'short';
  entryPrice: number;
  size: number; // base qty
  entryTs: number;
}

interface WindowSel {
  tf?: Timeframe;
  symbol?: string;
  marketType?: MarketType;
}

/** Static directional bias of a condition (type + params) — used to attribute
 *  the TRADE DIRECTION of a matched signal set instead of the old "colour of
 *  the last candle" heuristic, which made every short condition backtest long. */
function conditionDirection(type: ConditionType, params?: Record<string, string | number>): 'long' | 'short' | 'neutral' {
  switch (type) {
    case 'price_cross_up':
    case 'ma_cross_up':
    case 'macd_golden':
    case 'boll_break_up':
    case 'price_above':
      return 'long';
    case 'price_cross_down':
    case 'ma_cross_down':
    case 'macd_death':
    case 'boll_break_down':
    case 'price_below':
      return 'short';
    case 'price_change_pct': {
      const pct = Number(params?.pct ?? 3);
      return pct >= 0 ? 'long' : 'short';
    }
    case 'llm_bias': {
      const bias = String(params?.bias ?? 'long');
      return bias === 'long' ? 'long' : bias === 'short' ? 'short' : 'neutral';
    }
    default:
      // rsi_above/rsi_below/volume_spike are direction-agnostic without context
      return 'neutral';
  }
}

/** Majority vote of the matched conditions' directional bias. */
function signalDirection(
  matched: { code: string; params: Record<string, string | number> }[],
  fallback: 'long' | 'short',
): 'long' | 'short' {
  const votes = matched
    .map((m) => conditionDirection(m.code as ConditionType, m.params))
    .filter((d) => d !== 'neutral');
  if (!votes.length) return fallback;
  const longs = votes.filter((v) => v === 'long').length;
  const shorts = votes.length - longs;
  if (longs === shorts) return fallback;
  return longs > shorts ? 'long' : 'short';
}

/**
 * Event-driven backtester over historical candles with multi-timeframe /
 * cross-symbol condition support. External series are aligned by CLOSE time:
 * a reference bar is only visible once it has fully closed at or before the
 * base bar's close (no look-ahead). Shares the exact same condition evaluator
 * as the live rule engine, includes intrabar SL/TP with gap-through fills,
 * liquidation approximation and funding settlement for leveraged futures.
 */
export async function runBacktest(
  config: BacktestConfig,
  onProgress?: (p: number) => void,
): Promise<BacktestResult> {
  // 1. fetch base series
  let candles = await candleService.fetchHistory(
    config.marketType, config.symbol, config.timeframe, config.maxCandles, config.end,
  );
  if (config.start) {
    const startSec = Math.floor(config.start / 1000);
    const idx = candles.findIndex((c) => c.time >= startSec);
    if (idx > 0) candles.splice(0, idx);
  }
  if (candles.length < 40) {
    throw new Error(`not enough candles (${candles.length}) for ${config.symbol} ${config.timeframe}`);
  }

  // 2. fetch & index external factor windows (multi-TF / cross-symbol)
  const series = new Map<string, Candle[]>();
  const setSeries = (marketType: MarketType, symbol: string, tf: Timeframe, arr: Candle[]) =>
    series.set(`${marketType}:${symbol}:${tf}`, arr);
  setSeries(config.marketType, config.symbol, config.timeframe, candles);
  const externals = requiredWindows(config.conditions as Condition[], {
    symbol: config.symbol,
    marketType: config.marketType,
    timeframe: config.timeframe,
  });
  for (const w of externals) {
    const arr = await candleService
      .fetchHistory(w.marketType, w.symbol, w.tf, config.maxCandles, config.end)
      .catch(() => [] as Candle[]);
    if (config.start) {
      const startSec = Math.floor(config.start / 1000);
      const idx = arr.findIndex((c) => c.time >= startSec - tfSeconds(w.tf) * 50);
      if (idx > 0) arr.splice(0, idx);
    }
    setSeries(w.marketType, w.symbol, w.tf, arr);
  }

  const baseTfSec = tfSeconds(config.timeframe);

  /** aligned view of a referenced window as of the base bar — a reference bar
   *  is usable only when its CLOSE time <= the base bar's close time */
  const getWindow = (sel: WindowSel): Candle[] | undefined => {
    const marketType = sel.marketType ?? config.marketType;
    const symbol = (sel.symbol ?? config.symbol).toUpperCase();
    const tf = sel.tf ?? config.timeframe;
    const arr = series.get(`${marketType}:${symbol}:${tf}`);
    if (!arr || arr.length < 2) return undefined;
    if (marketType === config.marketType && symbol === config.symbol && tf === config.timeframe) {
      return baseWindow;
    }
    const refTfSec = tfSeconds(tf);
    const baseCloseTime = baseBarTime + baseTfSec; // when the base bar completes
    let lo = 0;
    let hi = arr.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].time + refTfSec <= baseCloseTime) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (idx < 0) return undefined;
    return arr.slice(Math.max(0, idx - EVAL_WINDOW + 1), idx + 1);
  };

  // funding history for leveraged futures (best effort — silently skipped)
  const fundingByTs = new Map<number, number>();
  if (config.marketType === 'futures' && config.allowLeverage > 1) {
    try {
      const rest = new BitgetRest();
      const rows = await rest.historyFundRate(config.symbol, 500).catch(() => []);
      for (const r of rows) {
        const rate = Number(r.fundingRate);
        const ts = Number(r.ts ?? r.fundingTime);
        if (Number.isFinite(rate) && Number.isFinite(ts)) fundingByTs.set(Math.floor(ts / 1000), rate);
      }
    } catch {
      // no funding data → proceed without it
    }
  }

  const feeRate = config.feeBps / 10_000;
  const slip = config.slippageBps / 10_000;
  const dirFilter = config.direction;
  const leveraged = config.allowLeverage > 1 && config.marketType === 'futures';

  const pos: { current: OpenPos | null } = { current: null };
  let equity = config.initialCapital;

  const trades: BacktestTrade[] = [];
  const equityCurve: { ts: number; value: number }[] = [];
  const drawdownCurve: { ts: number; value: number }[] = [];
  let peak = equity;
  let maxDrawdownPct = 0;
  let signalCount = 0;
  let liquidations = 0;
  let fundingPaid = 0;
  let pendingSignal: 'long' | 'short' | null = null;
  let baseWindow: Candle[] = [];
  let baseBarTime = 0;
  let lastFundingTs = 0;

  const markEquity = (price: number) => {
    const p = pos.current;
    if (!p) return equity;
    const dir = p.side === 'long' ? 1 : -1;
    return equity + (price - p.entryPrice) * p.size * dir;
  };

  const closePosition = (price: number, ts: number, reason: BacktestTrade['reason']) => {
    const p = pos.current;
    if (!p) return;
    const dir = p.side === 'long' ? 1 : -1;
    const exitPrice = price * (1 - dir * slip);
    const gross = (exitPrice - p.entryPrice) * p.size * dir;
    const fees = (p.entryPrice + exitPrice) * p.size * feeRate;
    const pnl = gross - fees;
    equity += pnl;
    trades.push({
      entryTs: p.entryTs,
      exitTs: ts,
      side: p.side,
      entryPrice: p.entryPrice,
      exitPrice,
      size: p.size,
      pnl,
      pnlPct: (pnl / (p.entryPrice * p.size)) * 100,
      reason,
    });
    pos.current = null;
  };

  const openPosition = (side: 'long' | 'short', price: number, ts: number) => {
    const entryPrice = price * (1 + (side === 'long' ? slip : -slip));
    pos.current = {
      side,
      entryPrice,
      size: (equity * config.allowLeverage) / entryPrice,
      entryTs: ts,
    };
  };

  /** approximate liquidation: mark equity fell below maintenance margin */
  const liquidationPrice = (p: OpenPos): number => {
    const dir = p.side === 'long' ? 1 : -1;
    // entry margin ratio (1/lev) minus maintenance rate, applied to entry
    return p.entryPrice * (1 - dir * (1 / config.allowLeverage - MAINT_MARGIN_RATE));
  };

  for (let i = 1; i < candles.length; i++) {
    const bar = candles[i];
    baseBarTime = bar.time;
    baseWindow = candles.slice(Math.max(0, i - EVAL_WINDOW + 1), i + 1);

    // 1. act on the signal decided at previous close
    if (pendingSignal) {
      const p = pos.current;
      if (!p) {
        if (dirFilter === 'both' || dirFilter === pendingSignal) {
          openPosition(pendingSignal, bar.open, bar.time * 1000);
        }
      } else if (p.side !== pendingSignal) {
        closePosition(bar.open, bar.time * 1000, 'signal');
        if (dirFilter === 'both' || dirFilter === pendingSignal) {
          openPosition(pendingSignal, bar.open, bar.time * 1000);
        }
      }
      pendingSignal = null;
    }

    // 2. funding settlement at 8h marks while holding (long pays positive rate)
    if (leveraged && pos.current && fundingByTs.size) {
      const bucket = Math.floor(bar.time / (8 * 3600)) * 8 * 3600;
      if (bucket > lastFundingTs && bar.time >= bucket) {
        const rate = fundingByTs.get(bucket) ?? fundingByTs.get(bucket - 8 * 3600);
        if (rate != null) {
          const p = pos.current;
          const dir = p.side === 'long' ? 1 : -1;
          const pay = p.size * p.entryPrice * rate * dir;
          equity -= pay;
          fundingPaid += pay;
        }
        lastFundingTs = bucket;
      }
    }

    // 3. intrabar liquidation check (before SL/TP — it takes precedence)
    const p = pos.current;
    if (p && leveraged) {
      const liq = liquidationPrice(p);
      const hitLiq = p.side === 'long' ? bar.low <= liq : bar.high >= liq;
      if (hitLiq) {
        liquidations += 1;
        closePosition(liq, bar.time * 1000, 'liquidation');
      }
    }

    // 4. intrabar stop-loss / take-profit (gap-aware: fill at the worse of
    //    the stop level and the bar open when the bar gaps through)
    const q = pos.current;
    if (q && (config.stopLossPct || config.takeProfitPct)) {
      const dir = q.side === 'long' ? 1 : -1;
      const stop = config.stopLossPct
        ? q.entryPrice * (1 - (dir * config.stopLossPct) / 100)
        : null;
      const target = config.takeProfitPct
        ? q.entryPrice * (1 + (dir * config.takeProfitPct) / 100)
        : null;
      const hitStop = stop != null && (q.side === 'long' ? bar.low <= stop : bar.high >= stop);
      const hitTarget = target != null && (q.side === 'long' ? bar.high >= target : bar.low <= target);
      if (hitStop) {
        // gap through the stop → filled at the open, not at the stop price
        const fill = q.side === 'long' ? Math.min(stop!, bar.open) : Math.max(stop!, bar.open);
        closePosition(fill, bar.time * 1000, 'stop_loss');
      } else if (hitTarget) {
        closePosition(target!, bar.time * 1000, 'take_profit');
      }
    }

    // 5. evaluate conditions on the closed bar (act on next bar open);
    //    warm-up bars train the indicators but never emit signals
    if (i < candles.length - 1 && i >= WARMUP_BARS) {
      const result = evaluateConditions(config.conditions as Condition[], config.logic, {
        candles: baseWindow,
        price: baseWindow.at(-1)!.close,
        getWindow,
      });
      if (result.matched) {
        signalCount++;
        const lastClose = baseWindow.at(-1)!.close;
        const prevClose = baseWindow.at(-2)!.close;
        const fallback: 'long' | 'short' = lastClose >= prevClose ? 'long' : 'short';
        pendingSignal = signalDirection(result.matchedDetails, fallback);
      }
    }

    // 6. equity bookkeeping
    const eq = markEquity(bar.close);
    equityCurve.push({ ts: bar.time * 1000, value: eq });
    peak = Math.max(peak, eq);
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, dd * 100);
    drawdownCurve.push({ ts: bar.time * 1000, value: -dd * 100 });

    if (onProgress && i % 200 === 0) {
      onProgress(0.1 + (i / candles.length) * 0.85);
    }
  }

  const lastBar = candles.at(-1)!;
  if (pos.current) closePosition(lastBar.close, lastBar.time * 1000, 'end');

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].value;
    if (prev > 0) returns.push((equityCurve[i].value - prev) / prev);
  }
  const mean = returns.length ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const variance = returns.length
    ? returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
    : 0;
  const barsPerYear = (365 * 24 * 3600) / tfSeconds(config.timeframe);
  const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(barsPerYear) : 0;

  // in-sample / out-of-sample split (70/30) for overfit detection
  let isReturnPct: number | undefined;
  let oosReturnPct: number | undefined;
  if (equityCurve.length >= 60) {
    const split = Math.floor(equityCurve.length * 0.7);
    const startEq = config.initialCapital;
    const splitEq = equityCurve[split].value;
    const endEq = equityCurve.at(-1)!.value;
    isReturnPct = ((splitEq - startEq) / startEq) * 100;
    oosReturnPct = ((endEq - splitEq) / splitEq) * 100;
  }

  const first = candles[0].close;
  const lastClose = lastBar.close;
  const buyHoldReturnPct = ((lastClose - first) / first) * 100;

  const stats: BacktestStats = {
    netProfit: equity - config.initialCapital,
    totalReturnPct: ((equity - config.initialCapital) / config.initialCapital) * 100,
    tradeCount: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0,
    maxDrawdownPct,
    sharpe,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    buyHoldReturnPct,
    signalCount,
    fundingPaid: fundingPaid !== 0 ? fundingPaid : undefined,
    liquidations: liquidations > 0 ? liquidations : undefined,
    oosReturnPct,
    isReturnPct,
  };

  onProgress?.(1);
  return {
    stats,
    equity: equityCurve.length > 2000 ? downsample(equityCurve, 2000) : equityCurve,
    drawdown: drawdownCurve.length > 2000 ? downsample(drawdownCurve, 2000) : drawdownCurve,
    trades,
    candlesUsed: candles.length,
  };
}

function downsample(arr: { ts: number; value: number }[], target: number) {
  const step = Math.ceil(arr.length / target);
  const out: { ts: number; value: number }[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  if (out.at(-1) !== arr.at(-1)) out.push(arr.at(-1)!);
  return out;
}
