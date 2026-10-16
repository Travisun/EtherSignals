import { paperRepo, strategiesRepo, settingsRepo } from '@/server/store/repos';
import { bus, Events } from '@/server/events/bus';
import { uid } from '@/lib/utils';
import type { MarketType, OrderRecord, PositionRecord } from '@/core/types';

const TAKER_FEE = 0.0006; // 0.06% per side, Bitget USDT-FUTURES taker reference

/** consecutive-loss counters per strategy (circuit breaker input) */
const consecutiveLosses = new Map<string, number>();

export interface PaperFillInput {
  symbol: string;
  marketType: MarketType;
  side: 'buy' | 'sell';
  tradeSide?: 'open' | 'close';
  size: number; // base quantity
  price: number;
  leverage?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  strategyId?: string;
}

/**
 * Paper trading broker: instant market fills against the paper USDT balance,
 * isolated from the live account. Positions track entry price and optional
 * SL/TP levels; unrealized PnL is computed on demand at the latest mark price.
 */
export class PaperBroker {
  state() {
    return paperRepo.get();
  }

  balances() {
    return this.state().balances;
  }

  private fee(size: number, price: number) {
    return size * price * TAKER_FEE;
  }

  /** Execute an instant market fill; returns the synthetic order record. */
  marketFill(input: PaperFillInput): { order: OrderRecord; error?: string } {
    const st = this.state();
    const notional = input.size * input.price;
    const fee = this.fee(input.size, input.price);
    const leverage = input.leverage && input.leverage > 1 ? input.leverage : 1;
    const margin = notional / leverage;
    const isClose = input.tradeSide === 'close';

    if (!isClose) {
      const usdt = st.balances.USDT ?? 0;
      if (margin + fee > usdt) {
        return {
          order: this.record(input, 'failed'),
          error: `insufficient paper balance: need ${(margin + fee).toFixed(2)}, have ${usdt.toFixed(2)}`,
        };
      }
    }

    const order: OrderRecord = this.record(input, 'filled');

    // open: lock margin + pay fee. close: balance is settled by realize()
    // below (margin release + pnl - fee), never here (would double-count).
    if (!isClose && input.symbol.endsWith('USDT')) {
      st.balances.USDT = Math.max(0, (st.balances.USDT ?? 0) - (margin + fee));
    }

    // Position handling
    const openSide = input.side === 'buy' ? 'long' : 'short';
    const idx = st.positions.findIndex((p) => p.symbol === input.symbol);
    if (!isClose) {
      if (idx >= 0 && st.positions[idx].side !== openSide) {
        // reverse: realize pnl of the old position first
        this.realize(st, idx, input.price);
        st.positions.splice(idx, 1);
      }
      const existing = st.positions.findIndex((p) => p.symbol === input.symbol && p.side === openSide);
      if (existing >= 0) {
        const p = st.positions[existing];
        const total = p.size + input.size;
        p.openPriceAvg = (p.openPriceAvg * p.size + input.price * input.size) / total;
        p.size = total;
        p.available = total;
        p.leverage = leverage;
        p.slPct = input.stopLossPct ?? p.slPct;
        p.tpPct = input.takeProfitPct ?? p.tpPct;
        p.strategyId = input.strategyId ?? p.strategyId;
        p.uTime = Date.now();
      } else {
        st.positions.push({
          symbol: input.symbol,
          marginCoin: 'USDT',
          marginMode: 'crossed',
          holdMode: 'one_way_mode',
          side: openSide,
          size: input.size,
          available: input.size,
          leverage,
          openPriceAvg: input.price,
          markPrice: input.price,
          unrealizedPL: 0,
          cTime: Date.now(),
          uTime: Date.now(),
          paper: true,
          marketType: input.marketType,
          slPct: input.stopLossPct,
          tpPct: input.takeProfitPct,
          strategyId: input.strategyId,
        });
      }
    } else {
      const closeSide = input.side === 'sell' ? 'long' : 'short';
      const ci = st.positions.findIndex((p) => p.symbol === input.symbol && p.side === closeSide);
      if (ci < 0) {
        // never book a phantom "filled" close against a nonexistent position
        const failed = this.record(input, 'failed');
        return { order: failed, error: `no ${closeSide} position on ${input.symbol}` };
      }
      const p = st.positions[ci];
      const closeSize = Math.min(p.size, input.size);
      // realize() releases margin + pnl - fee for the closed size and updates
      // the strategy's win/loss ledger
      const pnl = this.realize(st, ci, input.price, closeSize);
      p.size -= closeSize;
      p.available = p.size;
      if (p.size <= 0) st.positions.splice(ci, 1);
      order.pnl = pnl;
      bus.emit(Events.POSITION_CLOSED, {
        symbol: input.symbol, side: closeSide, price: input.price, size: closeSize, pnl, paper: true, strategyId: input.strategyId,
      });
    }

    st.trades.unshift(order);
    paperRepo.save(st);
    return { order };
  }

  /** Realize PnL of a position (or part of it) into the USDT balance and the
   *  strategy's performance ledger (win/loss, realized PnL, loss streak). */
  private realize(st: ReturnType<PaperBroker['state']>, idx: number, price: number, size?: number): number {
    const p = st.positions[idx];
    const s = size ?? p.size;
    const dir = p.side === 'long' ? 1 : -1;
    const pnl = (price - p.openPriceAvg) * s * dir;
    const fee = s * price * TAKER_FEE;
    const releasedMargin = (s * p.openPriceAvg) / p.leverage;
    st.balances.USDT = (st.balances.USDT ?? 0) + releasedMargin + pnl - fee;
    this.trackStrategyPnl(p.strategyId, pnl);
    return pnl;
  }

  /** Attribute a closed PnL to the strategy and run the loss-streak breaker. */
  private trackStrategyPnl(strategyId: string | undefined, pnl: number) {
    if (!strategyId) return;
    try {
      const s = strategiesRepo.get(strategyId);
      if (!s) return;
      const win = pnl > 0;
      const stats = {
        ...s.stats,
        winCount: (s.stats.winCount ?? 0) + (win ? 1 : 0),
        lossCount: (s.stats.lossCount ?? 0) + (win ? 0 : 1),
        realizedPnl: (s.stats.realizedPnl ?? 0) + pnl,
      };
      strategiesRepo.update(strategyId, { stats });
      const streak = win ? 0 : (consecutiveLosses.get(strategyId) ?? 0) + 1;
      consecutiveLosses.set(strategyId, streak);
      const maxLosses = settingsRepo.get().risk.maxConsecutiveLosses;
      if (!win && maxLosses && maxLosses > 0 && streak >= maxLosses && s.status === 'running') {
        strategiesRepo.update(strategyId, { status: 'stopped' });
        consecutiveLosses.delete(strategyId);
        // late imports avoid engine ↔ store cycles at module load
        void Promise.all([import('@/server/events/notifier'), import('@/server/store/pg')]).then(([{ notify }, { logAudit }]) => {
          notify('strategy.stopped', { name: s.name }, { level: 'error', channel: 'strategy', strategyId });
          notify('engine.error', { reason: `strategy ${s.name} auto-stopped after ${streak} consecutive losses` }, { level: 'error', strategyId });
          logAudit({ category: 'strategy', action: 'strategy.circuit_break', strategyId, level: 'error', payload: { streak, maxLosses } });
        });
      }
    } catch {
      // stats tracking must never break settlement
    }
  }

  private record(input: PaperFillInput, status: 'filled' | 'failed'): OrderRecord {
    return {
      orderId: uid('pp_'),
      clientOid: input.strategyId ? `gts_${input.strategyId}` : undefined,
      symbol: input.symbol,
      marketType: input.marketType,
      side: input.side,
      tradeSide: input.tradeSide ?? (input.marketType === 'futures' ? 'open' : undefined),
      orderType: 'market',
      size: input.size,
      filledSize: status === 'filled' ? input.size : 0,
      avgPrice: status === 'filled' ? input.price : undefined,
      status,
      ts: Date.now(),
      updateTime: Date.now(),
      source: input.strategyId ? 'strategy' : 'paper',
      strategyId: input.strategyId,
    };
  }

  /** Mark all paper positions at the given prices and return derived summary. */
  summary(markPrices: Record<string, number>) {
    const st = this.state();
    let marginUsed = 0;
    let unrealized = 0;
    const positions = st.positions.map((p) => {
      const mark = markPrices[p.symbol] ?? p.markPrice ?? p.openPriceAvg;
      const dir = p.side === 'long' ? 1 : -1;
      const u = (mark - p.openPriceAvg) * p.size * dir;
      marginUsed += (p.size * p.openPriceAvg) / p.leverage;
      unrealized += u;
      return { ...p, markPrice: mark, unrealizedPL: u };
    });
    const usdt = st.balances.USDT ?? 0;
    const equity = usdt + marginUsed + unrealized;
    return {
      paper: true as const,
      spot: Object.entries(st.balances)
        .filter(([, v]) => v > 0)
        .map(([coin, v]) => ({ coin, available: v, frozen: 0, total: v })),
      futures: [
        {
          marginCoin: 'USDT',
          equity,
          available: usdt,
          unrealizedPL: unrealized,
          marginUsed,
        },
      ],
      totals: { equityUsd: equity, availableUsd: usdt, unrealizedPnl: unrealized },
      ts: Date.now(),
    };
  }

  /**
   * Iterate the SL/TP levels stored on the paper position against a price
   * tick; returns the close order to execute when a level is hit. The hit
   * arms an in-flight guard — releaseClose() after settlement — so two
   * adjacent ticks can never double-fire the same stop.
   */
  private closing = new Set<string>();

  checkStops(symbol: string, price: number): { side: 'buy' | 'sell'; reason: 'stop_loss' | 'take_profit'; size: number } | null {
    if (this.closing.has(symbol)) return null;
    const st = this.state();
    const p = st.positions.find((x) => x.symbol === symbol);
    if (!p || p.size <= 0) return null;
    const dir = p.side === 'long' ? 1 : -1;
    if (p.slPct && p.slPct > 0) {
      const stop = p.openPriceAvg * (1 - (dir * p.slPct) / 100);
      if (p.side === 'long' ? price <= stop : price >= stop) {
        this.closing.add(symbol);
        return { side: p.side === 'long' ? 'sell' : 'buy', reason: 'stop_loss', size: p.available };
      }
    }
    if (p.tpPct && p.tpPct > 0) {
      const target = p.openPriceAvg * (1 + (dir * p.tpPct) / 100);
      if (p.side === 'long' ? price >= target : price <= target) {
        this.closing.add(symbol);
        return { side: p.side === 'long' ? 'sell' : 'buy', reason: 'take_profit', size: p.available };
      }
    }
    return null;
  }

  /** release the in-flight close guard after the stop order settled/failed */
  releaseClose(symbol: string) {
    this.closing.delete(symbol);
  }
}

export const paperBroker = new PaperBroker();
