'use client';

/**
 * Market data transport for the UI. Browsers NEVER talk to the exchange:
 * snapshots bootstrap from this server's REST routes and live updates arrive
 * relayed over the app Socket.IO channel (`market:*` events, see server
 * marketRelay.ts). When the app socket is down the client degrades to REST
 * polling of the same server endpoints, so restricted networks still render.
 * Synthetic timeframes (2m/2h/8h/2d) arrive already aggregated — the server
 * owns the windows.
 */
import React from 'react';
import { create } from 'zustand';
import { getSocket } from '@/hooks/useAppSocket';
import { upsertCandle } from '@/lib/candles';
import type { Book, Candle, MarketType, PublicTrade, Ticker, Timeframe } from '@/core/types';

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
      // shared sorted-insert: relayed catch-up batches can carry older bars —
      // blind push would corrupt the series for the chart
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

export interface MarketSub {
  /** 'candle' (needs tf) | 'ticker' | 'books15' | 'books5' | 'trade' */
  channel: string;
  tf?: Timeframe;
  marketType: MarketType;
  instId: string;
}

/**
 * Relay client over the app socket. Subs are refcounted and re-sent on every
 * socket (re)connect; the server joins this socket to per-window rooms.
 */
class MarketRelayClient {
  private subs = new Map<string, { sub: MarketSub; refs: number }>();
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private fallbackBackoff = 5_000;
  private attachAttempts = 0;

  constructor() {
    if (typeof window === 'undefined') return;
    this.attachSocket();
  }

  /** the app socket is created by useAppSocket at the root layout — wait for it */
  private attachSocket() {
    const socket = getSocket();
    if (!socket) {
      if (this.attachAttempts++ < 100) setTimeout(() => this.attachSocket(), 400);
      return;
    }
    if (socket.connected) this.onConnect(socket);
    socket.on('connect', () => this.onConnect(socket));
    socket.on('disconnect', () => {
      useMarketStore.getState().setStatus('closed');
      this.scheduleFallback();
    });
    socket.on('market:candle', (p: { key: string; candles: Candle[] }) => {
      for (const c of p.candles ?? []) useMarketStore.getState().mergeCandle(p.key, c);
    });
    socket.on('market:ticker', (p: { marketType: MarketType; tickers: Ticker[] }) => {
      for (const t of p.tickers ?? []) useMarketStore.getState().upsertTicker(t, p.marketType);
    });
    socket.on('market:book', (p: { key: string; book: Book }) => {
      useMarketStore.getState().setBook(p.key, p.book);
    });
    socket.on('market:trade', (p: { key: string; trades: PublicTrade[] }) => {
      for (const t of p.trades ?? []) useMarketStore.getState().pushTrade(p.key, t);
    });
  }

  private onConnect(socket: { emit: (ev: string, payload: unknown) => unknown }) {
    this.fallbackBackoff = 5_000;
    useMarketStore.getState().setStatus('open');
    const all = [...this.subs.values()].map((s) => this.toWire(s.sub));
    if (all.length) socket.emit('market:sub', { subs: all });
  }

  private toWire(sub: MarketSub) {
    return { channel: sub.channel, tf: sub.tf, marketType: sub.marketType, instId: sub.instId };
  }

  /**
   * REST polling fallback while the app socket is down — targets THIS server
   * (never the exchange), so a relay outage degrades the tick rate instead of
   * killing the UI.
   */
  private scheduleFallback() {
    if (this.fallbackTimer) return;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = undefined;
      const socket = getSocket();
      if (socket?.connected) return; // relay is live again
      if (typeof document !== 'undefined' && document.hidden) {
        this.scheduleFallback(); // background tab: retry on the next tick
        return;
      }
      const candles = new Set<string>(); // `${mt}:${instId}:${tf}`
      const books = new Set<string>();
      const trades = new Set<string>();
      const tickers = new Set<string>(); // marketType (dominant wins)
      for (const { sub } of this.subs.values()) {
        if (sub.channel === 'candle' && sub.tf) candles.add(`${sub.marketType}:${sub.instId}:${sub.tf}`);
        else if (sub.channel === 'ticker') tickers.add(sub.marketType);
        else if (sub.channel === 'trade') trades.add(`${sub.marketType}:${sub.instId}`);
        else books.add(`${sub.marketType}:${sub.instId}`);
      }
      void Promise.all([
        ...[...tickers].map((mt) => loadTickers(mt as MarketType)),
        ...[...books].map((key) => {
          const [mt, instId] = splitKey2(key);
          return loadBook(mt, instId);
        }),
        ...[...trades].map((key) => {
          const [mt, instId] = splitKey2(key);
          return loadTrades(mt, instId);
        }),
        ...[...candles].map((key) => {
          const [mt, instId, tf] = splitKey3(key);
          return loadCandles(mt, instId, tf, 300);
        }),
      ])
        .then(() => {
          this.fallbackBackoff = 5_000;
        })
        .catch(() => {
          this.fallbackBackoff = Math.min(this.fallbackBackoff * 2, 60_000);
        });
      this.scheduleFallback();
    }, this.fallbackBackoff);
  }

  subscribe(subs: MarketSub[]) {
    const fresh: MarketSub[] = [];
    for (const sub of subs) {
      const key = subKey(sub);
      const cur = this.subs.get(key);
      if (cur) cur.refs += 1;
      else {
        this.subs.set(key, { sub, refs: 1 });
        fresh.push(sub);
      }
    }
    if (fresh.length) {
      const socket = getSocket();
      if (socket?.connected) socket.emit('market:sub', { subs: fresh.map((s) => this.toWire(s)) });
      // else: 'connect' resends the full sub list
    }
  }

  unsubscribe(subs: MarketSub[]) {
    const removed: MarketSub[] = [];
    for (const sub of subs) {
      const key = subKey(sub);
      const cur = this.subs.get(key);
      if (!cur) continue;
      cur.refs -= 1;
      if (cur.refs <= 0) {
        this.subs.delete(key);
        removed.push(sub);
      }
    }
    if (removed.length) {
      const socket = getSocket();
      if (socket?.connected) socket.emit('market:unsub', { subs: removed.map((s) => this.toWire(s)) });
    }
  }
}

const subKey = (sub: MarketSub) => `${sub.channel}:${sub.tf ?? ''}:${sub.marketType}:${sub.instId.toUpperCase()}`;
/** "futures:BTCUSDT" → ["futures","BTCUSDT"] */
const splitKey2 = (key: string): [MarketType, string] => {
  const [mt, inst] = key.split(':');
  return [mt as MarketType, inst];
};
/** "futures:BTCUSDT:15m" → ["futures","BTCUSDT","15m"] */
const splitKey3 = (key: string): [MarketType, string, Timeframe] => {
  const [mt, inst, tf] = key.split(':');
  return [mt as MarketType, inst, tf as Timeframe];
};

const client = new MarketRelayClient();

// ─── Hook API ────────────────────────────────────────────────────────────────

export function useMarketSubscriptions(subs: MarketSub[]) {
  const key = JSON.stringify(subs);
  React.useEffect(() => {
    if (!subs.length) return;
    const args: MarketSub[] = subs.map((s) => ({
      channel: s.channel,
      tf: s.tf,
      marketType: s.marketType,
      instId: s.instId.toUpperCase(),
    }));
    client.subscribe(args);
    return () => {
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
  // seed an empty window so live relay updates still have somewhere to land,
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
