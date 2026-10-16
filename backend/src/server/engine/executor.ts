import { BitgetRest, BitgetApiError } from '@/server/bitget/rest';
import { paperBroker } from './paper';
import { settingsRepo } from '@/server/store/repos';
import { notify } from '@/server/events/notifier';
import { logAudit } from '@/server/store/pg';
import { candleService } from './candleService';
import { preTradeCheck } from './risk';
import { uid, floorTo, toNum } from '@/lib/utils';
import type { ActionOrder, MarketType } from '@/core/types';

export interface ExecuteOrderInput {
  symbol: string;
  marketType: MarketType;
  order: ActionOrder;
  paper: boolean;
  /** live execution account; omit for the active account (paper ignores) */
  accountId?: string;
  strategyId?: string;
  /** audit category for this order (default: strategy when strategyId set) */
  category?: 'manual' | 'strategy' | 'grid';
  /**
   * Deterministic idempotency tag: the exchange rejects a duplicate clientOid,
   * so retries of the same logical order can never double-fill. Callers should
   * derive it from the trigger (strategyId + trigger ts + action index).
   */
  clientTag?: string;
  /** precision info */
  pricePrecision?: number;
  quantityPrecision?: number;
  /** exchange price tick (futures priceEndTick) — prices snap to its multiple */
  priceTick?: number;
  /** spot quote-amount decimals for market buys */
  quotePrecision?: number;
  /** spot minimum order value in USDT */
  minTradeUSDT?: number;
  /** minimum order size in base coin (futures minTradeNum / spot minTradeAmount) */
  minTradeAmount?: number;
}

export interface ExecuteOrderResult {
  ok: boolean;
  orderId?: string;
  error?: string;
  paper: boolean;
  accountId?: string;
}

/** Cached hold-side mode per account (Bitget default is hedge mode). */
const holdModeCache = new Map<string, 'hedge_mode' | 'one_way_mode'>();

export function cacheHoldMode(accountId: string, holdMode: 'hedge_mode' | 'one_way_mode') {
  holdModeCache.set(accountId, holdMode);
}

export function clearAccountCaches(accountId?: string) {
  if (accountId) {
    holdModeCache.delete(accountId);
    for (const key of [...leverageCache.keys()]) {
      if (key.startsWith(`${accountId}:`)) leverageCache.delete(key);
    }
  } else {
    holdModeCache.clear();
    leverageCache.clear();
  }
}

function getHoldMode(accountId?: string): 'hedge_mode' | 'one_way_mode' | undefined {
  const settings = settingsRepo.get();
  const account = accountId
    ? settings.accounts.find((a) => a.id === accountId)
    : settings.accounts.find((a) => a.active);
  return account ? holdModeCache.get(account.id) : undefined;
}

/** Last leverage successfully applied per account+symbol (set is rate-limited). */
const leverageCache = new Map<string, number>();

/** Snap a price down to the exchange tick, keeping the tick's own decimals. */
function floorToTick(price: number, tick?: number, fallbackDecimals = 2): string {
  if (tick && tick > 0) {
    const tickStr = String(tick);
    const dot = tickStr.indexOf('.');
    const decimals = dot >= 0 ? tickStr.length - dot - 1 : 0;
    return (Math.floor(price / tick + Number.EPSILON) * tick).toFixed(decimals);
  }
  return String(floorTo(price, fallbackDecimals));
}

/** Spread an instrument's precision/min-trade fields into an execute call. */
export function precisionFields(
  i?: { pricePrecision: number; quantityPrecision: number; priceTick?: number; quotePrecision?: number; minTradeUSDT?: number; minTradeAmount?: number } | undefined,
) {
  return {
    pricePrecision: i?.pricePrecision,
    quantityPrecision: i?.quantityPrecision,
    priceTick: i?.priceTick,
    quotePrecision: i?.quotePrecision,
    minTradeUSDT: i?.minTradeUSDT,
    minTradeAmount: i?.minTradeAmount,
  };
}

/**
 * Reference price for an order: explicit price, else the latest ticker —
 * used for risk checks, market-order presets and paper fills so that no
 * order ever executes against price 0.
 */
function refPrice(marketType: MarketType, symbol: string, explicit?: number): number {
  if (explicit && explicit > 0) return explicit;
  return candleService.lastPrice(marketType, symbol);
}

/**
 * Executes one order action — either against the paper account or the live
 * Bitget account. All paths run the pre-trade risk gate first, emit localized
 * notifications and tag the order with the originating strategy (clientOid
 * prefix `gt`).
 */
export async function executeOrderAction(input: ExecuteOrderInput): Promise<ExecuteOrderResult> {
  const { symbol, marketType, order, paper, strategyId } = input;
  const qPrec = input.quantityPrecision ?? 4;
  const pPrec = input.pricePrecision ?? 2;

  if (!Number.isFinite(order.size) || order.size <= 0) {
    return { ok: false, error: `invalid size: ${order.size}`, paper };
  }
  const size = Math.max(floorTo(order.size, qPrec), Math.pow(10, -qPrec));
  const price = refPrice(marketType, symbol, order.price);
  if (!(price > 0)) {
    // a zero price poisons paper fills (margin 0, PnL 0) and gets rejected live
    const err = `no reference price for ${symbol} — refusing to trade blind`;
    notify('order.placed.fail', { symbol, side: order.side, size, reason: err }, {
      level: 'error', channel: 'trade', strategyId,
    });
    return { ok: false, error: err, paper };
  }
  if (input.minTradeAmount && size < input.minTradeAmount) {
    const err = `size ${size} below minimum trade amount ${input.minTradeAmount}`;
    notify('order.placed.fail', { symbol, side: order.side, size, reason: err }, {
      level: 'error', channel: 'trade', strategyId,
    });
    return { ok: false, error: err, paper };
  }

  // ── pre-trade risk gate: kill switch, notional cap, exposure, volatility ──
  const risk = await preTradeCheck({ symbol, marketType, order, refPrice: price, size });
  if (!risk.ok) {
    notify('order.placed.fail', { symbol, side: order.side, size, reason: risk.reason ?? 'risk check failed' }, {
      level: 'error', channel: 'trade', strategyId,
    });
    logAudit({
      category: input.category ?? (strategyId ? 'strategy' : 'manual'), action: 'order.risk_blocked',
      level: 'warning', strategyId, symbol,
      payload: { side: order.side, orderType: order.orderType, size, price, code: risk.code },
      result: 'fail', error: risk.reason,
    });
    return { ok: false, error: risk.reason, paper };
  }

  if (paper) {
    const res = paperBroker.marketFill({
      symbol,
      marketType,
      side: order.side,
      tradeSide: marketType === 'futures' ? (order.tradeSide === 'close' ? 'close' : 'open') : undefined,
      size,
      price,
      leverage: order.leverage,
      stopLossPct: order.stopLossPct,
      takeProfitPct: order.takeProfitPct,
      strategyId,
    });
    if (res.error) {
      notify('order.placed.fail', { symbol, side: order.side, size, reason: res.error }, {
        level: 'error', channel: 'trade', strategyId,
      });
      logAudit({
        category: input.category ?? (strategyId ? 'strategy' : 'manual'), action: 'order.paper',
        level: 'error', strategyId, symbol,
        payload: { side: order.side, orderType: order.orderType, size, price, tradeSide: order.tradeSide },
        result: 'fail', error: res.error,
      });
      return { ok: false, error: res.error, paper: true };
    }
    notify('order.placed.paper', { symbol, side: order.side, size, price: res.order.avgPrice ?? price }, {
      level: 'success', channel: 'trade', strategyId,
    });
    logAudit({
      category: input.category ?? (strategyId ? 'strategy' : 'manual'), action: 'order.paper.filled',
      level: 'success', strategyId, symbol,
      payload: { side: order.side, orderType: order.orderType, size, price: res.order.avgPrice ?? price, tradeSide: order.tradeSide, leverage: order.leverage },
      result: 'ok',
    });
    return { ok: true, orderId: res.order.orderId, paper: true };
  }

  const settings = settingsRepo.get();
  const account = input.accountId
    ? settings.accounts.find((a) => a.id === input.accountId)
    : settings.accounts.find((a) => a.active);
  if (!account) {
    const err = input.accountId ? `account ${input.accountId} not found` : 'no active account';
    return { ok: false, error: err, paper: false };
  }

  const rest = new BitgetRest(account);
  // deterministic idempotency: retries of the same logical order reuse the tag
  const clientOid = input.clientTag
    ? `gt${input.clientTag.replace(/[^a-zA-Z0-9]/g, '').slice(0, 30)}`
    : uid('gt');

  // ── hold-side mode must be KNOWN before a futures order leaves — guessing
  // hedge for a one-way account (or vice versa) gets the order rejected, and
  // a "close" order without tradeSide/reduceOnly in one-way mode can flip
  if (marketType === 'futures' && !holdModeCache.has(account.id)) {
    const info = await rest.futuresAccountConfig().catch(() => undefined);
    if (info?.holdMode != null) {
      cacheHoldMode(account.id, String(info.holdMode) === 'one_way_mode' ? 'one_way_mode' : 'hedge_mode');
    } else {
      const err = `hold mode unknown for ${account.label} — prefetch failed, order blocked`;
      notify('order.placed.fail', { symbol, side: order.side, size, reason: err }, {
        level: 'error', channel: 'trade', strategyId,
      });
      return { ok: false, error: err, paper: false };
    }
  }

  try {
    if (marketType === 'futures') {
      const body: Record<string, unknown> = {
        symbol,
        marginMode: 'crossed',
        marginCoin: 'USDT',
        size: String(size),
        side: order.side,
        orderType: order.orderType,
        force: order.orderType === 'limit' ? 'gtc' : 'ioc',
        clientOid,
      };
      const holdMode = getHoldMode(input.accountId);
      if (holdMode === 'hedge_mode') {
        body.tradeSide = order.tradeSide === 'close' ? 'close' : 'open';
      } else if (order.tradeSide === 'close') {
        // one-way mode: a close MUST be reduce-only or the residual fill
        // silently opens a position in the opposite direction
        body.reduceOnly = true;
      }
      if (order.orderType === 'limit') {
        body.price = floorToTick(order.price ?? price, input.priceTick, pPrec);
      }
      // preset TP/SL (attached to the position once the order fills); the
      // levels anchor to the limit price for limit orders, else the ref price
      const slTpBase = order.orderType === 'limit' ? (order.price ?? price) : price;
      if (order.stopLossPct) {
        const dir = order.side === 'buy' ? -1 : 1;
        body.presetStopLossPrice = floorToTick(slTpBase * (1 + (dir * order.stopLossPct) / 100), input.priceTick, pPrec);
      }
      if (order.takeProfitPct) {
        const dir = order.side === 'buy' ? 1 : -1;
        body.presetStopSurplusPrice = floorToTick(slTpBase * (1 + (dir * order.takeProfitPct) / 100), input.priceTick, pPrec);
      }
      // only call set-leverage when it actually changes (10/s rate limit);
      // a silent failure would trade at the WRONG leverage — block instead
      if (order.leverage && order.leverage > 1) {
        const levKey = `${account.id}:${symbol}`;
        if (leverageCache.get(levKey) !== order.leverage) {
          try {
            await rest.setLeverage(symbol, String(order.leverage));
            leverageCache.set(levKey, order.leverage);
          } catch (e) {
            const msg = e instanceof BitgetApiError ? `${e.code} ${e.message}` : String(e);
            const err = `setLeverage(${symbol}, ${order.leverage}x) failed: ${msg} — order blocked to prevent wrong-leverage exposure`;
            notify('order.placed.fail', { symbol, side: order.side, size, reason: err }, {
              level: 'error', channel: 'trade', strategyId,
            });
            logAudit({
              category: input.category ?? (strategyId ? 'strategy' : 'manual'), action: 'order.leverage_fail',
              level: 'error', accountId: account.id, strategyId, symbol,
              payload: { leverage: order.leverage },
              result: 'fail', error: msg,
            });
            return { ok: false, error: err, paper: false };
          }
        }
      }
      const res = await rest.placeFuturesOrder(body);
      notify('order.placed', {
        symbol, side: order.side, orderType: order.orderType, size, price: order.price ?? 'market',
      }, { level: 'success', channel: 'trade', strategyId });
      logAudit({
        category: input.category ?? (strategyId ? 'strategy' : 'manual'), action: 'order.futures.placed',
        level: 'success', accountId: account.id, strategyId, symbol,
        payload: { side: order.side, orderType: order.orderType, size, price: order.orderType === 'limit' ? order.price : 'market', tradeSide: body.tradeSide, reduceOnly: body.reduceOnly, leverage: order.leverage, sl: order.stopLossPct, tp: order.takeProfitPct, clientOid, label: account.label },
        result: 'ok',
      });
      return { ok: true, orderId: res.orderId, paper: false, accountId: account.id };
    }

    // spot — v2 place-order: `size` is the base amount for limit and market
    // sells, the quote amount for market buys
    const body: Record<string, unknown> = {
      symbol,
      side: order.side,
      orderType: order.orderType,
      clientOid,
    };
    if (order.orderType === 'limit') {
      body.price = floorToTick(order.price ?? price, input.priceTick, pPrec);
      body.size = String(size);
      body.force = 'gtc';
      if (input.minTradeUSDT && size * (order.price ?? price) < input.minTradeUSDT) {
        const err = `order below minimum value ${input.minTradeUSDT} USDT`;
        notify('order.placed.fail', { symbol, side: order.side, size, reason: err }, {
          level: 'error', channel: 'trade', strategyId,
        });
        return { ok: false, error: err, paper: false };
      }
    } else if (order.side === 'buy') {
      const quoteAmount = floorTo(size * price, Math.min(input.quotePrecision ?? 2, 8));
      if (input.minTradeUSDT && quoteAmount < input.minTradeUSDT) {
        const err = `market buy below minimum order value ${input.minTradeUSDT} USDT`;
        notify('order.placed.fail', { symbol, side: order.side, size, reason: err }, {
          level: 'error', channel: 'trade', strategyId,
        });
        return { ok: false, error: err, paper: false };
      }
      body.size = String(quoteAmount);
    } else {
      body.size = String(size);
    }
    const res = await rest.placeSpotOrder(body);
    notify('order.placed', {
      symbol, side: order.side, orderType: order.orderType, size, price: order.price ?? 'market',
    }, { level: 'success', channel: 'trade', strategyId });
    logAudit({
      category: input.category ?? (strategyId ? 'strategy' : 'manual'), action: 'order.spot.placed',
      level: 'success', accountId: account.id, strategyId, symbol,
      payload: { side: order.side, orderType: order.orderType, size, quoteQty: body.size, price: order.orderType === 'limit' ? order.price : 'market', clientOid, label: account.label },
      result: 'ok',
    });
    return { ok: true, orderId: res.orderId, paper: false, accountId: account.id };
  } catch (e) {
    const msg = e instanceof BitgetApiError ? `${e.code} ${e.message}` : String(e);
    notify('order.placed.fail', { symbol, side: order.side, size, reason: msg }, {
      level: 'error', channel: 'trade', strategyId,
    });
    logAudit({
      category: input.category ?? (strategyId ? 'strategy' : 'manual'), action: 'order.placed',
      level: 'error', accountId: account.id, strategyId, symbol,
      payload: { side: order.side, size },
      result: 'fail', error: msg,
    });
    return { ok: false, error: msg, paper: false };
  }
}

/** Close every position of a symbol (paper or live, spot & futures). */
export async function closeSymbolPositions(
  symbol: string, marketType: MarketType, paper: boolean, markPrice: number, strategyId?: string, accountId?: string,
): Promise<ExecuteOrderResult[]> {
  const results: ExecuteOrderResult[] = [];
  const instrument = await candleService.instrument(marketType, symbol).catch(() => undefined);

  if (paper) {
    const st = paperBroker.state();
    const positions = st.positions.filter((p) => p.symbol === symbol);
    for (const p of positions) {
      results.push(
        await executeOrderAction({
          symbol, marketType,
          order: {
            type: 'order', orderType: 'market',
            side: p.side === 'long' ? 'sell' : 'buy',
            tradeSide: 'close', size: p.available,
          },
          paper: true, strategyId,
          ...precisionFields(instrument),
        }),
      );
    }
    return results;
  }

  const settings = settingsRepo.get();
  const account = accountId
    ? settings.accounts.find((a) => a.id === accountId)
    : settings.accounts.find((a) => a.active);
  if (!account) return [{ ok: false, error: 'no active account', paper: false }];
  const rest = new BitgetRest(account);

  try {
      if (marketType === 'futures') {
        const positions = await rest.positions(symbol);
        for (const row of positions) {
          const holdMode = String(row.holdMode ?? 'hedge_mode');
          if (row.holdMode != null) cacheHoldMode(account.id, holdMode === 'one_way_mode' ? 'one_way_mode' : 'hedge_mode');
          const side = String(row.holdSide ?? 'long') === 'long' ? 'long' : 'short';
          const available = toNum(row.available);
          if (!available) continue;
          results.push(
            await executeOrderAction({
              symbol, marketType: 'futures',
              order: {
                type: 'order', orderType: 'market',
                side: side === 'long' ? 'sell' : 'buy',
                tradeSide: 'close', size: available,
              },
              paper: false, strategyId,
              ...precisionFields(instrument),
            }),
          );
        }
      } else {
        // spot: flatten the base-coin balance with a market sell
        const base = symbol.replace(/(USDT|USDC|BTC|ETH|USD)$/, '');
        const assets = await rest.spotAssets().catch(() => []);
        const row = assets.find((a) => String(a.coin) === base);
        const available = row ? toNum(row.available) : 0;
        if (available > 0) {
          results.push(
            await executeOrderAction({
              symbol, marketType: 'spot',
              order: { type: 'order', orderType: 'market', side: 'sell', size: available },
              paper: false, strategyId,
              ...precisionFields(instrument),
            }),
          );
        }
      }
  } catch (e) {
    const msg = e instanceof BitgetApiError ? `${e.code} ${e.message}` : String(e);
    notify('order.placed.fail', { symbol, side: 'close', size: 0, reason: msg }, { level: 'error', channel: 'trade', strategyId });
    results.push({ ok: false, error: msg, paper: false });
  }
  void markPrice;
  return results;
}
