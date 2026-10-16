import { BitgetRest, BitgetApiError, normalizeOrder } from '@/server/bitget/rest';
import { settingsRepo, paperRepo } from '@/server/store/repos';
import { executeOrderAction, closeSymbolPositions, precisionFields } from '@/server/engine/executor';
import { candleService, isPaperMode } from '@/server/engine/candleService';
import { getAccountSummary } from '@/server/engine/accountService';
import { paperBroker } from '@/server/engine/paper';
import { notify } from '@/server/events/notifier';
import { logAudit } from '@/server/store/pg';
import type { MarketType, OrderRecord } from '@/core/types';

interface AccountScope {
  symbol?: string;
  accountId?: string;
  limit?: number;
}

function activeRest(accountId?: string): BitgetRest {
  const accounts = settingsRepo.get().accounts;
  const account = accountId ? accounts.find((a) => a.id === accountId) : accounts.find((a) => a.active);
  if (!account) throw new Error(accountId ? `account ${accountId} not found` : 'no active exchange account configured');
  return new BitgetRest(account);
}

export interface PlaceOrderInput {
  symbol: string;
  marketType: MarketType;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  size: number;
  price?: number;
  leverage?: number;
  tradeSide?: 'open' | 'close';
  stopLossPct?: number;
  takeProfitPct?: number;
  paper?: boolean;
  accountId?: string;
  strategyId?: string;
}

export async function placeOrder(input: PlaceOrderInput) {
  const paper = input.paper ?? isPaperMode();
  const instrument = await candleService.instrument(input.marketType, input.symbol).catch(() => undefined);
  // min-trade validation per the exchange instrument spec (skipped when the
  // instrument table is unavailable — the exchange re-validates anyway)
  if (instrument) {
    const notional = input.size * (input.price && input.price > 0 ? input.price : 0);
    if (input.marketType === 'futures') {
      if (instrument.minTradeAmount && input.size < instrument.minTradeAmount) {
        throw new Error(`size below min trade amount ${instrument.minTradeAmount}`);
      }
    } else {
      if (instrument.minTradeAmount && input.size < instrument.minTradeAmount) {
        throw new Error(`size below min trade amount ${instrument.minTradeAmount}`);
      }
      const quoteRef = input.side === 'buy' && input.orderType === 'market' ? 0 : notional;
      const minUsd = instrument.minTradeUSDT;
      if (minUsd && quoteRef > 0 && quoteRef < minUsd) {
        throw new Error(`order value below min ${minUsd} USDT`);
      }
    }
  }
  return executeOrderAction({
    symbol: input.symbol,
    marketType: input.marketType,
    order: {
      type: 'order',
      orderType: input.orderType,
      side: input.side,
      tradeSide: input.tradeSide ?? (input.marketType === 'futures' ? 'open' : undefined),
      size: input.size,
      price: input.price,
      leverage: input.leverage,
      stopLossPct: input.stopLossPct,
      takeProfitPct: input.takeProfitPct,
    },
    paper,
    accountId: input.accountId,
    strategyId: input.strategyId,
    ...precisionFields(instrument),
  });
}

export async function cancelOrder(orderId: string, symbol: string, marketType: MarketType, accountId?: string) {
  if (isPaperMode() || orderId.startsWith('pp_')) {
    const st = paperBroker.state();
    const idx = st.orders.findIndex((o) => o.orderId === orderId);
    if (idx >= 0) {
      st.orders.splice(idx, 1);
      paperRepo.save(st);
      return { ok: true };
    }
    return { ok: false, error: 'paper order not found' };
  }
  const rest = activeRest(accountId);
  try {
    if (marketType === 'futures') await rest.cancelFuturesOrder(orderId, symbol);
    else await rest.cancelSpotOrder(orderId, symbol);
    notify('order.canceled', { orderId, symbol }, { level: 'info', channel: 'trade' });
    logAudit({ category: 'manual', action: 'order.canceled', accountId, symbol, payload: { orderId }, result: 'ok' });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof BitgetApiError ? `${e.code} ${e.message}` : String(e);
    notify('order.cancel.fail', { orderId, reason: msg }, { level: 'error', channel: 'trade' });
    logAudit({ category: 'manual', action: 'order.cancel', accountId, symbol, payload: { orderId }, result: 'fail', error: msg });
    return { ok: false, error: msg };
  }
}

export async function pendingOrders(marketType: MarketType, opts: AccountScope = {}): Promise<OrderRecord[]> {
  if (isPaperMode()) {
    // paper orders fill instantly — only genuine leftovers would be live
    return paperBroker
      .state()
      .orders.filter((o) => o.status === 'live' && o.symbol === (opts.symbol ?? o.symbol))
      .map((o) => ({ ...o, status: 'live' as const }));
  }
  const rest = activeRest(opts.accountId);
  const rows = marketType === 'futures'
    ? await rest.pendingFuturesOrders(opts.symbol)
    : await rest.pendingSpotOrders(opts.symbol);
  return rows.map((r) => ({ ...normalizeOrder(r, marketType), source: 'manual' as const }));
}

export async function historyOrders(marketType: MarketType, opts: AccountScope = {}): Promise<OrderRecord[]> {
  if (isPaperMode()) {
    return paperBroker
      .state()
      .trades.filter((o) => o.symbol === (opts.symbol ?? o.symbol))
      .slice(0, opts.limit ?? 100);
  }
  const rest = activeRest(opts.accountId);
  const params = { symbol: opts.symbol, limit: opts.limit ?? 100 };
  const rows = marketType === 'futures'
    ? await rest.historyFuturesOrders(params)
    : await rest.historySpotOrders(params);
  return rows.map((r) => ({ ...normalizeOrder(r, marketType), source: 'manual' as const }));
}

export async function fillHistory(marketType: MarketType, opts: AccountScope = {}): Promise<OrderRecord[]> {
  if (isPaperMode()) {
    return paperBroker.state().trades.slice(0, opts.limit ?? 100);
  }
  const rest = activeRest(opts.accountId);
  const params = { symbol: opts.symbol, limit: opts.limit ?? 100 };
  const rows = marketType === 'futures' ? await rest.futuresFills(params) : await rest.spotFills(params);
  return rows.map((r) => ({
    ...normalizeOrder(r, marketType),
    orderType: 'market' as const,
    status: 'filled' as const,
    source: 'manual' as const,
  }));
}

export { closeSymbolPositions, getAccountSummary };
