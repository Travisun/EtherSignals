import { bitgetSign } from './sign';
import { exchangeFetch, proxyConfigured, currentProxyUrl } from './proxy';
import type { AccountConfig } from '@/core/types';

const BASE_URL = 'https://api.bitget.com';
const TIMEOUT_MS = 10_000;

export class BitgetApiError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 0) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
  /** Bitget rate-limit responses (HTTP 429 or code 40035 style). */
  get isRateLimit(): boolean {
    return this.httpStatus === 429 || this.code === '40035';
  }
}

/** Process-wide exchange health metrics surfaced through /api/engine. */
export const exchangeMetrics = {
  rateLimited429: 0,
  last429Ts: 0,
  requests: 0,
  errors: 0,
  /** clock offset (ms) = serverTime - localTime, refreshed periodically */
  clockOffsetMs: 0,
  clockSyncedAt: 0,
};

// ─── server clock sync ───────────────────────────────────────────────────────
// Bitget rejects signatures when the timestamp drifts >30s (NTP-less containers).
let clockSyncTimer: NodeJS.Timeout | undefined;

async function syncClock() {
  try {
    const t0 = Date.now();
    const res = await exchangeFetch(`${BASE_URL}/api/v2/public/time`, { cache: 'no-store' });
    const json = (await res.json()) as { code: string; data: string };
    const rtt = Date.now() - t0;
    if (json.code === '00000') {
      const server = Number(json.data);
      if (Number.isFinite(server)) {
        exchangeMetrics.clockOffsetMs = server - (t0 + rtt / 2);
        exchangeMetrics.clockSyncedAt = Date.now();
      }
    }
  } catch {
    // offline — keep last offset
  }
}

/** Lazily start the 5-min clock-sync loop (first call signs immediately). */
function ensureClockSync() {
  if (clockSyncTimer || process.env.GT_DISABLE_CLOCK_SYNC === '1') {
    if (!clockSyncTimer && process.env.GT_DISABLE_CLOCK_SYNC === '1') void syncClock();
    return;
  }
  void syncClock();
  clockSyncTimer = setInterval(() => void syncClock(), 5 * 60_000);
  clockSyncTimer.unref?.();
}

export interface RestResponse<T = unknown> {
  code: string;
  msg: string;
  data: T;
  requestTime?: number;
}

export class BitgetRest {
  constructor(private account?: AccountConfig | null) {}

  private headers(method: string, requestPath: string, queryString: string, body: string): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      locale: 'en-US',
    };
    if (this.account?.apiKey) {
      ensureClockSync();
      const ts = (Date.now() + exchangeMetrics.clockOffsetMs).toString();
      h['ACCESS-KEY'] = this.account.apiKey;
      h['ACCESS-SIGN'] = bitgetSign({
        secret: this.account.apiSecret,
        timestamp: ts,
        method,
        requestPath,
        queryString,
        body,
      });
      h['ACCESS-TIMESTAMP'] = ts;
      h['ACCESS-PASSPHRASE'] = this.account.passphrase;
      if (this.account.demoMode) h['paptrading'] = '1';
    }
    return h;
  }

  async request<T = unknown>(method: string, path: string, params?: Record<string, unknown>, body?: unknown): Promise<T> {
    const qs = params && method === 'GET'
      ? Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    const fullPath = qs ? `${path}?${qs}` : path;
    const payload = body ? JSON.stringify(body) : '';
    const url = `${BASE_URL}${fullPath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    exchangeMetrics.requests += 1;
    let res: { status: number; text: () => Promise<string>; json: () => Promise<unknown> };
    try {
      res = await exchangeFetch(url, {
        method,
        headers: this.headers(method, path, qs, payload),
        body: method === 'GET' ? undefined : payload || undefined,
        signal: controller.signal,
      });
    } catch (e) {
      // a raw fetch failure (DNS / TLS reset / proxy down) previously surfaced
      // as a mystery 500 — make it an actionable, diagnosable error
      exchangeMetrics.errors += 1;
      const reason = e instanceof Error ? e.message : String(e);
      const causeMsg = e instanceof Error && e.cause instanceof Error ? e.cause.message : '';
      const fullReason = [reason, causeMsg].filter(Boolean).join(' | ');
      const aborted = /abort|timeout/i.test(reason);
      const refused = /ECONNREFUSED|ConnectionRefused/i.test(fullReason);
      const proxy = proxyConfigured() ? currentProxyUrl() : null;
      const hint = refused && proxy
        ? `proxy ${proxy} is not accepting connections — 代理软件未运行或端口不对（macOS 用 scutil --proxy 查实际端口；Clash Verge 默认 7897，旧版 Clash 为 7890）`
        : 'check network/firewall or set HTTPS_PROXY for the server process';
      throw new BitgetApiError(
        aborted ? 'TIMEOUT' : 'NETWORK',
        aborted
          ? `request to ${path} timed out after ${TIMEOUT_MS}ms`
          : `cannot reach api.bitget.com${proxy ? ` via proxy ${proxy}` : ''} — ${hint} (${fullReason})`,
        aborted ? 504 : 0,
      );
    }
    try {
      const text = await res.text();
      let json: RestResponse<T>;
      try {
        json = JSON.parse(text);
      } catch {
        exchangeMetrics.errors += 1;
        throw new BitgetApiError('HTTP_ERROR', text.slice(0, 300), res.status);
      }
      if (json.code !== '00000') {
        exchangeMetrics.errors += 1;
        if (res.status === 429 || json.code === '40035') {
          exchangeMetrics.rateLimited429 += 1;
          exchangeMetrics.last429Ts = Date.now();
        }
        throw new BitgetApiError(json.code || 'UNKNOWN', json.msg || 'request failed', res.status);
      }
      return json.data;
    } finally {
      clearTimeout(timer);
    }
  }

  get<T>(path: string, params?: Record<string, unknown>) {
    return this.request<T>('GET', path, params);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, undefined, body);
  }

  // ─── Public market data ────────────────────────────────────────────────────

  async tickers(marketType: 'spot' | 'futures'): Promise<Record<string, unknown>[]> {
    if (marketType === 'spot') {
      return this.get<Record<string, unknown>[]>('/api/v2/spot/tickers');
    }
    return this.get<Record<string, unknown>[]>('/api/v2/mix/market/tickers', { productType: 'usdt-futures' });
  }

  async ticker(marketType: 'spot' | 'futures', symbol: string): Promise<Record<string, unknown> | undefined> {
    if (marketType === 'spot') {
      const d = await this.get<Record<string, unknown>[]>('/api/v2/spot/tickers', { symbol });
      return d?.[0];
    }
    const d = await this.get<Record<string, unknown>[]>('/api/v2/mix/market/tickers', {
      productType: 'usdt-futures',
      symbol,
    });
    return d?.[0];
  }

  async candles(marketType: 'spot' | 'futures', symbol: string, granularity: string, limit: number, endTs?: number): Promise<string[][]> {
    if (marketType === 'spot') {
      return this.get<string[][]>('/api/v2/spot/market/candles', {
        symbol, granularity, limit, ...(endTs ? { endTime: endTs } : {}),
      });
    }
    return this.get<string[][]>('/api/v2/mix/market/candles', {
      symbol, productType: 'usdt-futures', granularity, limit, ...(endTs ? { endTime: endTs } : {}),
    });
  }

  async historyCandles(marketType: 'spot' | 'futures', symbol: string, granularity: string, limit: number, endTs?: number): Promise<string[][]> {
    if (marketType === 'spot') {
      return this.get<string[][]>('/api/v2/spot/market/history-candles', {
        symbol, granularity, limit, ...(endTs ? { endTime: endTs } : {}),
      });
    }
    return this.get<string[][]>('/api/v2/mix/market/history-candles', {
      symbol, productType: 'usdt-futures', granularity, limit, ...(endTs ? { endTime: endTs } : {}),
    });
  }

  async book(marketType: 'spot' | 'futures', symbol: string, level = '15'): Promise<Record<string, unknown>> {
    if (marketType === 'spot') {
      return this.get<Record<string, unknown>>('/api/v2/spot/market/orderbook', { symbol, type: 'step0', limit: level });
    }
    return this.get<Record<string, unknown>>('/api/v2/mix/market/merge-depth', {
      symbol, productType: 'usdt-futures', limit: level,
    });
  }

  async publicTrades(marketType: 'spot' | 'futures', symbol: string, limit = 50): Promise<string[][]> {
    if (marketType === 'spot') {
      return this.get<string[][]>('/api/v2/spot/market/fills', { symbol, limit });
    }
    return this.get<string[][]>('/api/v2/mix/market/fills', { symbol, productType: 'usdt-futures', limit });
  }

  /** Historical funding rates (futures), newest first: [{fundingRate, fundingRateList?…, ts}] */
  async historyFundRate(symbol: string, limit = 500): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/mix/market/history-fund-rate', {
      symbol,
      productType: 'usdt-futures',
      pageSize: Math.min(limit, 1000),
    });
  }

  /** Futures contracts (precision info). */
  async contracts(): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/mix/market/contracts', { productType: 'usdt-futures' });
  }

  /** Spot symbols (precision info). */
  async spotSymbols(): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/spot/public/symbols');
  }

  // ─── Private: account ──────────────────────────────────────────────────────

  async spotAssets(): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/spot/account/assets');
  }

  async futuresAccounts(): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/mix/account/accounts', { productType: 'usdt-futures' });
  }

  async positions(symbol?: string): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/mix/position/all-position', {
      productType: 'usdt-futures',
      ...(symbol ? { symbol } : {}),
    });
  }

  async setLeverage(symbol: string, leverage: string, marginCoin = 'USDT'): Promise<unknown> {
    return this.post('/api/v2/mix/account/set-leverage', {
      symbol, productType: 'usdt-futures', leverage, marginCoin,
    });
  }

  /** Futures account config (holdMode etc.) for the USDT-FUTURES product. */
  async futuresAccountConfig(): Promise<Record<string, unknown> | undefined> {
    const rows = await this.get<Record<string, unknown>[]>('/api/v2/mix/account/accounts', { productType: 'usdt-futures' });
    return rows?.[0];
  }

  // ─── Private: orders ───────────────────────────────────────────────────────

  async placeFuturesOrder(body: Record<string, unknown>): Promise<{ orderId: string; clientOid: string }> {
    const data = await this.post<{ orderId: string; clientOid: string }>(
      '/api/v2/mix/order/place-order',
      { productType: 'usdt-futures', ...body },
    );
    return data;
  }

  async placeSpotOrder(body: Record<string, unknown>): Promise<{ orderId: string; clientOid: string }> {
    return this.post<{ orderId: string; clientOid: string }>('/api/v2/spot/trade/place-order', body);
  }

  async cancelFuturesOrder(orderId: string, symbol: string): Promise<unknown> {
    // v2 single-order cancel takes marginCoin + symbol + orderId
    return this.post('/api/v2/mix/order/cancel-order', {
      symbol,
      marginCoin: 'USDT',
      orderId,
      productType: 'usdt-futures',
    });
  }

  async cancelSpotOrder(orderId: string, symbol: string): Promise<unknown> {
    // v2 spot cancel: symbolList is an array of {symbol, orderIdList}
    return this.post('/api/v2/spot/trade/cancel-order', {
      symbolList: [{ symbol, orderIdList: [orderId] }],
    });
  }

  /** Cancel every open order (incl. plan orders) of a futures symbol — kill switch primitive. */
  async cancelAllFuturesOrders(symbol: string): Promise<unknown> {
    return this.post('/api/v2/mix/order/cancel-all-orders', {
      productType: 'usdt-futures',
      symbol,
      marginCoin: 'USDT',
    });
  }

  /** Pending TP/SL plan orders for a futures symbol. */
  async pendingPlanOrders(symbol: string): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/mix/order/orders-plan-pending', {
      productType: 'usdt-futures',
      symbol,
      planType: 'profit_loss',
    });
  }

  /** Cancel a single TP/SL plan order. */
  async cancelPlanOrder(orderId: string, symbol: string): Promise<unknown> {
    return this.post('/api/v2/mix/order/cancel-plan-order', {
      productType: 'usdt-futures',
      symbol,
      marginCoin: 'USDT',
      orderIdList: [orderId],
    });
  }

  /**
   * Place a TP/SL trigger plan on a futures position (v2 place-tpsl-order).
   * kind='profit' → profit_plan, 'loss' → loss_plan; executePrice omitted
   * (0) so the trigger fills as a market order.
   */
  async placeTpSlPlan(params: {
    symbol: string;
    kind: 'profit' | 'loss';
    triggerPrice: string;
    holdSide?: 'buy' | 'sell';
    size: string;
    triggerType?: 'fill_price' | 'mark_price' | 'index_price';
  }): Promise<unknown> {
    return this.post('/api/v2/mix/order/place-tpsl-order', {
      marginCoin: 'USDT',
      productType: 'usdt-futures',
      symbol: params.symbol,
      planType: params.kind === 'profit' ? 'profit_plan' : 'loss_plan',
      triggerPrice: params.triggerPrice,
      triggerType: params.triggerType ?? 'mark_price',
      executePrice: '0',
      ...(params.holdSide ? { holdSide: params.holdSide } : {}),
      size: params.size,
    });
  }

  async pendingFuturesOrders(symbol?: string): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/mix/order/orders-pending', {
      productType: 'usdt-futures',
      ...(symbol ? { symbol } : {}),
    });
  }

  async pendingSpotOrders(symbol?: string): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/spot/trade/orders-pending', symbol ? { symbol } : undefined);
  }

  async historyFuturesOrders(params: { symbol?: string; startTime?: number; endTime?: number; limit?: number }): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/mix/order/orders-history', {
      productType: 'usdt-futures',
      ...params,
    });
  }

  async historySpotOrders(params: { symbol?: string; startTime?: number; endTime?: number; limit?: number }): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/spot/trade/orders-history', params);
  }

  async futuresFills(params: { symbol?: string; startTime?: number; endTime?: number; limit?: number }): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/mix/order/fills-history', {
      productType: 'usdt-futures',
      ...params,
    });
  }

  async spotFills(params: { symbol?: string; startTime?: number; endTime?: number; limit?: number }): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>('/api/v2/spot/trade/fills-history', params);
  }
}

/** Normalize a Bitget v2 ticker row into our Ticker shape. */
export function normalizeTicker(row: Record<string, unknown>, marketType: 'spot' | 'futures') {
  const n = (v: unknown) => {
    const x = parseFloat(String(v));
    return Number.isFinite(x) ? x : 0;
  };
  return {
    symbol: String(row.symbol ?? ''),
    last: n(row.lastPr ?? row.close ?? row.price),
    ask: row.askPr != null ? n(row.askPr) : undefined,
    bid: row.bidPr != null ? n(row.bidPr) : undefined,
    high24h: n(row.high24h),
    low24h: n(row.low24h),
    change24h: n(row.change24h),
    baseVolume: n(row.baseVolume),
    quoteVolume: n(row.quoteVolume ?? row.usdtVolume),
    indexPrice: row.indexPrice != null ? n(row.indexPrice) : undefined,
    fundingRate: marketType === 'futures' && row.fundingRate != null ? n(row.fundingRate) : undefined,
    ts: Number(row.ts) || Date.now(),
  };
}

/** Normalize candle rows `[ts, open, high, low, close, baseVol, quoteVol, ...]`.
 *  Order-agnostic: /candles returns ascending rows while /history-candles
 *  returns DESCENDING rows (and pages may overlap) — always output strictly
 *  ascending, deduped series (newest row wins on duplicate timestamps). */
export function normalizeCandles(rows: string[][]) {
  const arr: {
    time: number; open: number; high: number; low: number; close: number;
    baseVol?: number; quoteVol?: number; confirmed: boolean;
  }[] = [];
  for (const r of rows) {
    const time = Math.floor(Number(r[0]) / 1000);
    const open = parseFloat(r[1]);
    const high = parseFloat(r[2]);
    const low = parseFloat(r[3]);
    const close = parseFloat(r[4]);
    // a NaN open/high/low poisons aggregateCandles → ATR → votes → scores
    if (![time, open, high, low, close].every(Number.isFinite)) continue;
    arr.push({
      time,
      open,
      high,
      low,
      close,
      baseVol: r[5] != null ? parseFloat(r[5]) : undefined,
      quoteVol: r[6] != null ? parseFloat(r[6]) : undefined,
      confirmed: true,
    });
  }
  arr.sort((a, b) => a.time - b.time);
  const out: typeof arr = [];
  for (const c of arr) {
    const last = out.at(-1);
    if (last && last.time === c.time) out[out.length - 1] = c;
    else out.push(c);
  }
  return out;
}

export function normalizeOrder(row: Record<string, unknown>, marketType: 'spot' | 'futures') {
  const n = (v: unknown) => {
    const x = parseFloat(String(v));
    return Number.isFinite(x) ? x : undefined;
  };
  const statusMap: Record<string, 'live' | 'partially_filled' | 'filled' | 'canceled' | 'failed'> = {
    new: 'live',
    init: 'live',
    partially_filled: 'partially_filled',
    filled: 'filled',
    filled_success: 'filled',
    canceled: 'canceled',
    cancel_rejected: 'live',
    live: 'live',
    fail_trigger: 'failed',
    fail_execute: 'failed',
  };
  const rawStatus = String(row.status ?? row.state ?? 'new');
  return {
    orderId: String(row.orderId ?? ''),
    clientOid: row.clientOid ? String(row.clientOid) : undefined,
    symbol: String(row.symbol ?? ''),
    marketType,
    side: String(row.side ?? 'buy') as 'buy' | 'sell',
    tradeSide: row.tradeSide ? (String(row.tradeSide) as 'open' | 'close') : undefined,
    orderType: String(row.orderType ?? 'limit') as 'limit' | 'market',
    price: row.price ? n(row.price) : undefined,
    size: n(row.size ?? row.quantity) ?? 0,
    filledSize: n(row.fillQuantity ?? row.baseVolume ?? row.accBaseVolume) ?? 0,
    avgPrice: n(row.fillPrice ?? row.priceAvg) ?? undefined,
    status: statusMap[rawStatus] ?? 'live',
    fee: n(feeOf(row)),
    feeCoin: feeCoinOf(row),
    pnl: marketType === 'futures' ? n(row.achievedProfits ?? row.profit) : undefined,
    leverage: n(row.leverage),
    force: row.force != null ? String(row.force) : undefined,
    ts: Number(row.cTime ?? row.systemCreateTime ?? Date.now()),
    updateTime: Number(row.uTime ?? Date.now()),
  };
}

function feeOf(row: Record<string, unknown>): unknown {
  const detail = row.feeDetail as { newFees?: { feeCoinAmount?: string }[] } | undefined;
  return detail?.newFees?.[0]?.feeCoinAmount ?? row.fillFee ?? row.totalFee;
}

function feeCoinOf(row: Record<string, unknown>): string | undefined {
  const detail = row.feeDetail as { newFees?: { feeCoin?: string }[] } | undefined;
  return detail?.newFees?.[0]?.feeCoin ?? (row.feeCoin != null ? String(row.feeCoin) : undefined);
}

export function normalizePosition(row: Record<string, unknown>) {
  const n = (v: unknown) => {
    const x = parseFloat(String(v));
    return Number.isFinite(x) ? x : undefined;
  };
  return {
    symbol: String(row.symbol ?? ''),
    marginCoin: String(row.marginCoin ?? 'USDT'),
    marginMode: String(row.marginMode ?? 'crossed') as 'crossed' | 'isolated',
    holdMode: String(row.holdMode ?? 'hedge_mode') as 'hedge_mode' | 'one_way_mode',
    side: String(row.holdSide ?? 'long') as 'long' | 'short',
    size: n(row.total) ?? 0,
    available: n(row.available) ?? 0,
    leverage: n(row.leverage) ?? 1,
    openPriceAvg: n(row.openPriceAvg) ?? 0,
    markPrice: n(row.markPrice),
    unrealizedPL: n(row.unrealizedPL) ?? 0,
    liquidationPrice: n(row.liquidationPrice),
    marginSize: n(row.marginSize),
    marginRatio: n(row.marginRatio),
    cTime: Number(row.cTime ?? Date.now()),
    uTime: Number(row.uTime ?? Date.now()),
  };
}
