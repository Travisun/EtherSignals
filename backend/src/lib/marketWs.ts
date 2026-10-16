'use client';

/**
 * Browser-side direct WebSocket to Bitget public v2 — lowest-latency market
 * data for the UI (tickers / candles / books / trades), refcounted subs.
 * Synthetic timeframes (2m/2h) are aggregated locally from their base series.
 */
import React from 'react';
import { create } from 'zustand';
import { wsInstType } from '@/lib/format';
import { SYNTH_TF, aggregateCandles, upsertCandle } from '@/lib/candles';
import type { Book, Candle, MarketType, PublicTrade, Ticker, Timeframe } from '@/core/types';

const WS_URL = 'wss://ws.bitget.com/v2/ws/public';
const PING_MS = 24_000;

interface MarketState {
  status: 'connecting' | 'open' | 'closed';
  tickers: Record<string, Ticker>; // key: `${marketType}:${symbol}`
  candles: Record<string, Candle[]>; // key: `${marketType}:${symbol}:${tf}`
  books: Record<string, Book>; // key: `${marketType}:${symbol}`
  trades: Record<string, PublicTrade[]>;
  ready: boolean;
}

interface MarketActions {
  setStatus: (s: MarketState['status']) => void;
  upsertTicker: (t: Ticker, marketType: MarketType) => void;
  setCandles: (key: string, candles: Candle[]) => void;
  mergeCandle: (key: string, c: Candle) => void;
  setBook: (key: string, b: Book) => void;
  pushTrade: (key: string, t: PublicTrade) => void;
}

export const useMarketStore = create<MarketState & MarketActions>((set) => ({
  status: 'connecting',
  tickers: {},
  candles: {},
  books: {},
  trades: {},
  ready: false,
  setStatus: (status) => set({ status, ready: status === 'open' }),
  upsertTicker: (t, marketType) =>
    set((s) => ({ tickers: { ...s.tickers, [`${marketType}:${t.symbol}`]: t } })),
  setCandles: (key, candles) => set((s) => ({ candles: { ...s.candles, [key]: candles } })),
  mergeCandle: (key, c) =>
    set((s) => {
      const arr = s.candles[key];
      if (!arr) return s;
      const next = arr.slice();
      // shared sorted-insert: relayed reconnect/catch-up frames can carry
      // older bars — blind push would corrupt the series for the chart
      upsertCandle(next, c);
      if (next.length > 1500) next.splice(0, next.length - 1500);
      return { candles: { ...s.candles, [key]: next } };
    }),
  setBook: (key, b) => set((s) => ({ books: { ...s.books, [key]: b } })),
  pushTrade: (key, t) =>
    set((s) => {
      const arr = s.trades[key];
      const next = arr ? [t, ...arr].slice(0, 60) : [t];
      return { trades: { ...s.trades, [key]: next } };
    }),
}));

export const marketKey = (marketType: MarketType, symbol: string) => `${marketType}:${symbol}`;
export const candleKey = (marketType: MarketType, symbol: string, tf: Timeframe) => `${marketType}:${symbol}:${tf}`;

type SubArgs = { instType: string; channel: string; instId: string };

class BitgetBrowserWs {
  private ws: WebSocket | null = null;
  private subs = new Map<string, { args: SubArgs; refs: number }>();
  private pingTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private backoff = 1000;
  private queue: SubArgs[] = [];
  /** server-relay fallback while the browser WS is unreachable (restricted
   *  networks): refresh subscribed book/trades/candles via REST with its own
   *  exponential backoff so a dead exchange path never spams the console */
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private fallbackBackoff = 5_000;

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const store = useMarketStore.getState();
    store.setStatus('connecting');
    this.scheduleFallback();
    try {
      this.ws = new WebSocket(WS_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.backoff = 1000;
      useMarketStore.getState().setStatus('open');
      this.startPing();
      const all = [...this.subs.values()].map((s) => s.args);
      if (all.length) this.send({ op: 'subscribe', args: all });
      while (this.queue.length) {
        const args = this.queue.splice(0);
        this.send({ op: 'subscribe', args });
      }
    };
    this.ws.onmessage = (ev) => {
      const text = String(ev.data);
      if (text === 'pong') return;
      try {
        const msg = JSON.parse(text) as { arg?: SubArgs; data?: unknown[]; action?: string };
        if (msg.arg && msg.data) this.dispatch(msg.arg, msg.data);
      } catch {
        // ignore
      }
    };
    this.ws.onclose = () => {
      this.stopPing();
      useMarketStore.getState().setStatus('closed');
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private dispatch(arg: SubArgs, data: unknown[]) {
    const store = useMarketStore.getState();
    const marketType: MarketType = arg.instType === 'SP' ? 'spot' : 'futures';
    if (arg.channel === 'ticker') {
      for (const row of data as Record<string, string>[]) {
        const t = {
          symbol: String(row.instId ?? row.symbol ?? ''),
          last: parseFloat(row.lastPr ?? '0'),
          ask: row.askPr != null ? parseFloat(row.askPr) : undefined,
          bid: row.bidPr != null ? parseFloat(row.bidPr) : undefined,
          high24h: parseFloat(row.high24h ?? '0'),
          low24h: parseFloat(row.low24h ?? '0'),
          change24h: parseFloat(row.change24h ?? '0'),
          baseVolume: parseFloat(row.baseVolume ?? '0'),
          quoteVolume: parseFloat(row.quoteVolume ?? row.usdtVolume ?? '0'),
          indexPrice: row.indexPrice != null ? parseFloat(row.indexPrice) : undefined,
          fundingRate: row.fundingRate != null ? parseFloat(row.fundingRate) : undefined,
          ts: Date.now(),
        };
        if (Number.isFinite(t.last)) store.upsertTicker(t, marketType);
      }
    } else if (arg.channel.startsWith('candle')) {
      const baseTf = channelToTf(arg.channel);
      const key = `${marketType}:${arg.instId}:${baseTf}`;
      const rows = data as string[][];
      for (const row of rows) {
        const c = parseWsRow(row);
        if (c) store.mergeCandle(key, c);
      }
      // synthetic windows (2m/2h) fed by this base series
      const watchers = synthWatchers.get(key);
      if (watchers) {
        for (const synKey of watchers) {
          const spec = SYNTH_TF[synKey.split(':')[2] as Timeframe];
          if (!spec) continue;
          const baseArr = synthBase.get(synKey) ?? [];
          for (const row of rows) {
            const c = parseWsRow(row);
            if (c) upsertCandle(baseArr, c);
          }
          if (baseArr.length > 4000) baseArr.splice(0, baseArr.length - 4000);
          synthBase.set(synKey, baseArr);
          mergeAggregated(synKey, aggregateCandles(baseArr, spec.seconds));
        }
      }
    } else if (arg.channel === 'books' || arg.channel === 'books5' || arg.channel === 'books15') {
      const key = marketKey(marketType, arg.instId);
      for (const row of data as { asks: string[][]; bids: string[][]; ts?: string }[]) {
        const parse = (rows: string[][]) =>
          rows.slice(0, 15).map((r) => ({ price: parseFloat(r[0]), size: parseFloat(r[1]) })).filter((l) => Number.isFinite(l.price));
        store.setBook(key, { asks: parse(row.asks), bids: parse(row.bids), ts: Number(row.ts) || Date.now() });
      }
    } else if (arg.channel === 'trade') {
      // v2 WS trade rows: [ts, price, size, side]
      const key = marketKey(marketType, arg.instId);
      for (const row of data as string[][]) {
        const price = parseFloat(row[1]);
        if (!Number.isFinite(price)) continue;
        store.pushTrade(key, {
          ts: Number(row[0]) || Date.now(),
          price,
          size: parseFloat(row[2]) || 0,
          side: (row[3] as 'buy' | 'sell') ?? 'buy',
        });
      }
    }
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('ping');
    }, PING_MS);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30_000);
  }

  /** REST fallback while the browser cannot reach the exchange WS. The server
   *  may still reach it (its own proxy config), so the UI stays alive at a
   *  lower tick rate instead of showing a dead book/chart. */
  private scheduleFallback() {
    if (this.fallbackTimer) return;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = undefined;
      const open = this.ws?.readyState === WebSocket.OPEN;
      if (open) {
        this.fallbackBackoff = 5_000;
        return; // WS is live again — fallback idle
      }
      // background tab: skip the work, retry on the next tick
      if (typeof document !== 'undefined' && document.hidden) {
        this.scheduleFallback();
        return;
      }
      const args = [...this.subs.values()].map((s) => s.args);
      if (args.length) {
        const books = new Set<string>();
        const candles = new Set<string>();
        let needTickers = false;
        for (const a of args) {
          const mt: MarketType = a.instType === 'SP' ? 'spot' : 'futures';
          if (a.channel.startsWith('candle')) candles.add(`${mt}:${a.instId}:${channelToTf(a.channel)}`);
          else if (a.channel === 'ticker') needTickers = true;
          else books.add(`${mt}:${a.instId}`);
        }
        // synchronous-ish batch; failures inside reject the whole batch and
        // simply grow the backoff — the console stays quiet
        void Promise.all([
          needTickers ? loadTickers(marketTypeOfArgs(args)) : Promise.resolve(),
          ...[...books].map((key) => {
            const [mt, instId] = splitKey(key);
            return Promise.all([loadBook(mt, instId), loadTrades(mt, instId)]);
          }),
          ...[...candles].map((key) => {
            const [mt, instId, tf] = splitKey(key) as [MarketType, string, Timeframe];
            return loadCandles(mt, instId, tf, 300);
          }),
        ])
          .then(() => {
            this.fallbackBackoff = 5_000;
          })
          .catch(() => {
            this.fallbackBackoff = Math.min(this.fallbackBackoff * 2, 60_000);
          });
      }
      this.scheduleFallback();
    }, this.fallbackBackoff);
  }

  private send(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
    else this.queue.push(...((payload as { args: SubArgs[] }).args ?? []));
  }

  subscribe(args: SubArgs[]) {
    const fresh: SubArgs[] = [];
    for (const arg of args) {
      const key = `${arg.instType}:${arg.channel}:${arg.instId}`;
      const cur = this.subs.get(key);
      if (cur) cur.refs += 1;
      else {
        this.subs.set(key, { args: arg, refs: 1 });
        fresh.push(arg);
      }
    }
    this.connect();
    if (fresh.length && this.ws?.readyState === WebSocket.OPEN) this.send({ op: 'subscribe', args: fresh });
  }

  unsubscribe(args: SubArgs[]) {
    const removed: SubArgs[] = [];
    for (const arg of args) {
      const key = `${arg.instType}:${arg.channel}:${arg.instId}`;
      const cur = this.subs.get(key);
      if (!cur) continue;
      cur.refs -= 1;
      if (cur.refs <= 0) {
        this.subs.delete(key);
        removed.push(arg);
      }
    }
    if (removed.length && this.ws?.readyState === WebSocket.OPEN) this.send({ op: 'unsubscribe', args: removed });
  }
}

function channelToTf(channel: string): Timeframe {
  const map: Record<string, Timeframe> = {
    candle1m: '1m', candle5m: '5m', candle15m: '15m', candle30m: '30m', candle1H: '1h',
    candle4H: '4h', candle6H: '6h', candle12H: '12h', candle1D: '1d', candle3D: '3d',
    candle1W: '1w', candle1M: '1M',
  };
  return map[channel] ?? '1m';
}

/** "futures:BTCUSDT:15m" → ["futures","BTCUSDT","15m"] */
function splitKey(key: string): [MarketType, string, string] {
  const [mt, inst, tf] = key.split(':');
  return [mt as MarketType, inst, tf];
}

/** dominant market type of the subscribed args (tickers load per market) */
function marketTypeOfArgs(args: SubArgs[]): MarketType {
  return args[0]?.instType === 'SP' ? 'spot' : 'futures';
}

function parseWsRow(row: string[]): Candle | null {
  if (!Array.isArray(row) || row.length < 5) return null;
  const time = Math.floor(Number(row[0]) / 1000);
  if (!Number.isFinite(time)) return null;
  return {
    time,
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    baseVol: row[5] != null ? parseFloat(row[5]) : undefined,
    quoteVol: row[6] != null ? parseFloat(row[6]) : undefined,
    confirmed: false,
  };
}

// ─── Synthetic timeframe aggregation (2m / 2h) ──────────────────────────────

/** base window key -> synthetic keys fed by it */
const synthWatchers = new Map<string, Set<string>>();
/** synthetic key -> raw base bars backing it */
const synthBase = new Map<string, Candle[]>();

function registerSynthWatcher(baseKey: string, synKey: string) {
  let set = synthWatchers.get(baseKey);
  if (!set) {
    set = new Set();
    synthWatchers.set(baseKey, set);
  }
  set.add(synKey);
}

function unregisterSynthWatcher(baseKey: string, synKey: string) {
  const set = synthWatchers.get(baseKey);
  if (!set) return;
  set.delete(synKey);
  if (!set.size) {
    synthWatchers.delete(baseKey);
    synthBase.delete(synKey);
  }
}

/** Upsert an aggregated series into the store, preserving bootstrap bars. */
function mergeAggregated(synKey: string, agg: Candle[]) {
  if (!agg.length) return;
  const store = useMarketStore.getState();
  const existing = store.candles[synKey] ?? [];
  const map = new Map(existing.map((c) => [c.time, c]));
  for (const c of agg) map.set(c.time, c);
  const merged = [...map.values()].sort((a, b) => a.time - b.time);
  if (merged.length > 1500) merged.splice(0, merged.length - 1500);
  const a = existing.at(-1);
  const b = merged.at(-1);
  const changed =
    !a || !b || a.time !== b.time || a.open !== b.open || a.high !== b.high || a.low !== b.low || a.close !== b.close;
  if (!existing.length || changed || merged.length !== existing.length) {
    store.setCandles(synKey, merged);
  }
}

const client = new BitgetBrowserWs();
if (typeof window !== 'undefined') {
  client.connect();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') client.connect();
  });
}

// ─── Hook API ────────────────────────────────────────────────────────────────

export function useMarketSubscriptions(subs: { channel: string; marketType: MarketType; instId: string }[]) {
  const key = JSON.stringify(subs);
  React.useEffect(() => {
    if (!subs.length) return;
    const args: SubArgs[] = subs.map((s) => ({ instType: wsInstType(s.marketType), channel: s.channel, instId: s.instId }));
    // register synthetic timeframe watchers for subscribed base candle channels
    const cleanups: (() => void)[] = [];
    for (const s of subs) {
      if (!s.channel.startsWith('candle')) continue;
      const baseTf = channelToTf(s.channel);
      const baseKey = `${s.marketType}:${s.instId}:${baseTf}`;
      for (const [synthTf, spec] of Object.entries(SYNTH_TF) as [Timeframe, { base: Timeframe; seconds: number }][]) {
        if (spec.base !== baseTf) continue;
        const synKey = `${s.marketType}:${s.instId}:${synthTf}`;
        registerSynthWatcher(baseKey, synKey);
        cleanups.push(() => unregisterSynthWatcher(baseKey, synKey));
      }
    }
    client.subscribe(args);
    return () => {
      cleanups.forEach((fn) => fn());
      client.unsubscribe(args);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Subscribe REST bootstrap candles into the store (used on symbol/tf change). */
export async function loadCandles(marketType: MarketType, symbol: string, tf: Timeframe, limit = 300): Promise<void> {
  const key = candleKey(marketType, symbol, tf);
  try {
    const res = await fetch(`/api/market/candles?marketType=${marketType}&symbol=${symbol}&tf=${tf}&limit=${limit}`);
    const j = await res.json();
    if (j?.ok) {
      useMarketStore.getState().setCandles(key, j.data.candles);
      if (j.data.ticker) useMarketStore.getState().upsertTicker(j.data.ticker, marketType);
      return;
    }
  } catch {
    // network-level failure — fall through
  }
  // seed an empty window so live WS updates still have somewhere to land,
  // then surface the failure for the relay-fallback backoff
  useMarketStore.getState().setCandles(key, []);
  throw new Error(`candles bootstrap failed: ${marketType} ${symbol} ${tf}`);
}

export async function loadTickers(marketType: MarketType) {
  const res = await fetch(`/api/market/tickers?marketType=${marketType}`);
  const j = await res.json();
  if (j?.ok) {
    const store = useMarketStore.getState();
    for (const t of j.data.tickers as Ticker[]) store.upsertTicker(t, marketType);
  }
}

export async function loadBook(marketType: MarketType, symbol: string): Promise<void> {
  const res = await fetch(`/api/market/book?marketType=${marketType}&symbol=${symbol}`);
  const j = await res.json();
  if (j?.ok) useMarketStore.getState().setBook(marketKey(marketType, symbol), j.data);
  else throw new Error(`book bootstrap failed: ${symbol}`);
}

export async function loadTrades(marketType: MarketType, symbol: string): Promise<void> {
  const res = await fetch(`/api/market/trades?marketType=${marketType}&symbol=${symbol}`);
  const j = await res.json();
  if (j?.ok) {
    const key = marketKey(marketType, symbol);
    useMarketStore.setState((s) => ({ trades: { ...s.trades, [key]: j.data.trades } }));
  } else throw new Error(`trades bootstrap failed: ${symbol}`);
}
