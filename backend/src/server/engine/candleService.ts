import { BitgetRest, normalizeCandles, normalizeTicker } from '@/server/bitget/rest';
import { BitgetWs, type WsSubArg } from '@/server/bitget/ws';
import { tfToGranularity, tfToWsChannel, tfSeconds, wsInstType } from '@/lib/format';
import { aggregateCandles, synthSpec, tfMultiplier, upsertCandle } from '@/lib/candles';
import { settingsRepo } from '@/server/store/repos';
import { notify } from '@/server/events/notifier';
import { bus, Events } from '@/server/events/bus';
import type { Candle, MarketType, Ticker, Timeframe } from '@/core/types';

export function windowKey(marketType: MarketType, symbol: string, tf: Timeframe) {
  return `${marketType}:${symbol}:${tf}`;
}

/** Exchange instrument constraints used for order placement. */
export interface InstrumentInfo {
  pricePrecision: number;
  quantityPrecision: number;
  /** futures price step (priceEndTick) — prices snap to its multiple */
  priceTick?: number;
  /** spot quote-amount decimals for market buys */
  quotePrecision?: number;
  /** minimum order size in base coin */
  minTradeAmount?: number;
  /** spot minimum order value in USDT */
  minTradeUSDT?: number;
}

/** a window whose WS feed stopped updating (detected by the watchdog) */
export interface WindowHealth {
  key: string;
  lastUpdateTs: number;
  ageMs: number;
  stale: boolean;
}

/**
 * Server-side market data hub: REST history bootstrap + Bitget public WS
 * live updates per (marketType, symbol, timeframe) window with refcounted
 * subscriptions, plus a REST-pooled ticker cache for mark prices.
 */
export class CandleService {
  private windows = new Map<string, Candle[]>();
  private refs = new Map<string, number>();
  private subscribed = new Set<string>();
  /** channel-level consumers: several windows may share one WS channel (1m/2m) —
   *  a channel is only unsubscribed when its LAST consumer goes away */
  private channelConsumers = new Map<string, Set<string>>();
  private pendingLoads = new Map<string, Promise<Candle[]>>();
  /** raw base bars backing each synthetic window (2m/2h) */
  private syntheticBase = new Map<string, Candle[]>();
  /** reverse index: base window key -> synthetic keys fed by it */
  private synthSubs = new Map<string, Set<string>>();
  private ws = new BitgetWs('public');
  private tickerCache = new Map<string, Ticker>();
  private tickerTimer?: NodeJS.Timeout;
  private watchdogTimer?: NodeJS.Timeout;
  /** last data arrival per live window — drives the staleness watchdog */
  private lastUpdate = new Map<string, number>();
  private staleNotified = new Set<string>();
  /** stats for the engine dashboard */
  wsReconnectCount = 0;
  started = false;

  get wsConnected(): boolean {
    return this['ws'].connected;
  }

  get wsPongAge(): number {
    return this.ws.pongAge;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.ws.on('data', (arg: WsSubArg, data: unknown[]) => {
      if (arg.channel.startsWith('candle')) this.onCandleData(arg, data);
    });
    this.ws.on('ws-error', (msg: { msg?: string }) => {
      console.warn('[candles] ws subscribe error:', msg.msg);
    });
    this.ws.on('close', () => {
      this.wsReconnectCount += 1;
    });
    await this.refreshTickers();
    this.tickerTimer = setInterval(() => {
      this.refreshTickers().catch(() => undefined);
    }, 15_000);
    // staleness watchdog: a silently dead feed must never look "connected"
    this.watchdogTimer = setInterval(() => this.checkStaleness(), 30_000);
    this.watchdogTimer.unref?.();
  }

  stop() {
    this.tickerTimer && clearInterval(this.tickerTimer);
    this.watchdogTimer && clearInterval(this.watchdogTimer);
    this.ws.close();
    // full reset — the in-process restart cycle (runtime.stop → start) must
    // re-subscribe from scratch: keeping these maps would make every
    // re-acquire believe its channel is still live (silently frozen windows),
    // and a fresh BitgetWs instance prevents piling up duplicate 'data' handlers
    this.windows.clear();
    this.refs.clear();
    this.channelConsumers.clear();
    this.subscribed.clear();
    this.syntheticBase.clear();
    this.synthSubs.clear();
    this.lastUpdate.clear();
    this.staleNotified.clear();
    this.pendingLoads.clear();
    this.ws = new BitgetWs('public');
    this.started = false;
  }

  /** Detect live windows that stopped receiving data (shared-channel bug class). */
  private checkStaleness() {
    const now = Date.now();
    for (const [key, ts] of this.lastUpdate) {
      if ((this.refs.get(key) ?? 0) <= 0) continue;
      const tf = key.split(':')[2] as Timeframe;
      const freshWindowMs = Math.max(tfSeconds(tf) * 3, 120) * 1000;
      if (now - ts > freshWindowMs) {
        if (!this.staleNotified.has(key)) {
          this.staleNotified.add(key);
          notify('engine.error', { reason: `market data stale: ${key} (no updates for ${Math.round((now - ts) / 1000)}s)` }, { level: 'error' });
        }
      } else {
        this.staleNotified.delete(key);
      }
    }
  }

  /** Health snapshot for /api/engine (stale live windows first). */
  windowHealth(): WindowHealth[] {
    const now = Date.now();
    const out: WindowHealth[] = [];
    for (const [key, ts] of this.lastUpdate) {
      if ((this.refs.get(key) ?? 0) <= 0) continue;
      const tf = key.split(':')[2] as Timeframe;
      const freshWindowMs = Math.max(tfSeconds(tf) * 3, 120) * 1000;
      out.push({ key, lastUpdateTs: ts, ageMs: now - ts, stale: now - ts > freshWindowMs });
    }
    return out.sort((a, b) => b.ageMs - a.ageMs).slice(0, 20);
  }

  async refreshTickers() {
    try {
      const rest = new BitgetRest();
      const [spot, futures] = await Promise.all([
        rest.tickers('spot').catch(() => []),
        rest.tickers('futures').catch(() => []),
      ]);
      for (const row of spot) {
        const t = normalizeTicker(row, 'spot');
        if (t.symbol) this.tickerCache.set(`spot:${t.symbol}`, t);
      }
      for (const row of futures) {
        const t = normalizeTicker(row, 'futures');
        if (t.symbol) this.tickerCache.set(`futures:${t.symbol}`, t);
      }
      bus.emit(Events.TICKER, null);
    } catch {
      // offline; keep stale cache
    }
  }

  ticker(marketType: MarketType, symbol: string): Ticker | undefined {
    return this.tickerCache.get(`${marketType}:${symbol}`);
  }

  allTickers(marketType: MarketType): Ticker[] {
    const prefix = `${marketType}:`;
    return [...this.tickerCache.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  }

  lastPrice(marketType: MarketType, symbol: string): number {
    return this.ticker(marketType, symbol)?.last ?? this.windows.get(windowKey(marketType, symbol, '1m'))?.at(-1)?.close ?? 0;
  }

  private onCandleData(arg: WsSubArg, data: unknown[]) {
    const baseTf = channelToTf(arg.channel);
    if (!baseTf) return;
    const marketType = arg.instType === 'SP' ? 'spot' : 'futures';
    const parsed: Candle[] = [];
    for (const row of data as string[][]) {
      const c = parseWsCandle(row);
      if (c) parsed.push(c);
    }
    if (!parsed.length) return;
    const baseKey = `${marketType}:${arg.instId}:${baseTf}`;

    // real base window (existing behaviour)
    if (this.windows.has(baseKey)) {
      this.applyToWindow(baseKey, parsed);
    }

    // synthetic windows (2m/2h) fed by this base series
    const synths = this.synthSubs.get(baseKey);
    if (!synths) return;
    for (const synKey of synths) {
      const spec = synthSpec(synKey.split(':')[2] as Timeframe);
      if (!spec) continue;
      const baseArr = this.syntheticBase.get(synKey) ?? [];
      const prev = this.windows.get(synKey);
      for (const c of parsed) upsertCandle(baseArr, c);
      if (baseArr.length > 4000) baseArr.splice(0, baseArr.length - 4000);
      this.syntheticBase.set(synKey, baseArr);

      const agg = aggregateCandles(baseArr, spec.seconds);
      this.windows.set(synKey, agg);
      this.lastUpdate.set(synKey, Date.now());
      bus.emit('market.candle.updated', { key: synKey });
      if (prev?.length && agg.length && agg.at(-1)!.time > prev.at(-1)!.time) {
        bus.emit(Events.CANDLE_CLOSED, { key: synKey, candle: prev.at(-1)! });
      }
    }
  }

  /** Upsert parsed candles into a live window with close/roll detection. */
  private applyToWindow(key: string, parsed: Candle[]) {
    const window = this.windows.get(key);
    if (!window) return;
    let changed = false;
    const closedBars: Candle[] = [];
    const tf = key.split(':')[2] as Timeframe;
    // reconnect catch-up batches may roll several old bars at once — emit a
    // close event per bar, but never fire stale closes older than 5 minutes
    // (they would trigger outdated signals on the strategy engine)
    const freshCloseBefore = Date.now() - 5 * 60_000;
    for (const c of parsed) {
      const last = window.at(-1);
      if (last && c.time > last.time) {
        last.confirmed = true;
        if ((last.time + tfSeconds(tf)) * 1000 >= freshCloseBefore) {
          closedBars.push({ ...last });
        }
      }
      upsertCandle(window, c);
      changed = true;
    }
    if (changed && window.length > 1000) window.splice(0, window.length - 1000);
    if (changed) {
      this.lastUpdate.set(key, Date.now());
      bus.emit('market.candle.updated', { key });
    }
    for (const bar of closedBars) {
      bus.emit(Events.CANDLE_CLOSED, { key, candle: bar });
    }
  }

  /** REST snapshot + live WS subscription (refcounted). Synthetic TFs (2m/2h)
   *  load and subscribe their base series, aggregated locally. */
  async acquire(marketType: MarketType, symbol: string, tf: Timeframe, limit = 200): Promise<Candle[]> {
    await this.start();
    const key = windowKey(marketType, symbol, tf);
    const spec = synthSpec(tf);
    const channelKey = `${wsInstType(marketType)}:${tfToWsChannel(tf)}:${symbol}`;
    const shouldSubscribe = !this.channelConsumers.has(channelKey);
    this.refs.set(key, (this.refs.get(key) ?? 0) + 1);
    if (!this.windows.has(key)) {
      // concurrent acquires of the same window share one REST load
      let load = this.pendingLoads.get(key);
      if (!load) {
        load = this.loadHistory(marketType, symbol, tf, limit);
        this.pendingLoads.set(key, load);
      }
      try {
        const candles = await load;
        this.windows.set(key, candles);
      } catch (e) {
        // don't cache failed loads; roll the refcount back
        this.refs.set(key, Math.max(0, (this.refs.get(key) ?? 1) - 1));
        throw e;
      } finally {
        this.pendingLoads.delete(key);
      }
    } else {
      const pending = this.pendingLoads.get(key);
      if (pending) await pending.catch(() => undefined);
    }
    // a release() while the load was in flight deleted the refcount — never
    // resurrect the window + subscription as a refcount-0 orphan
    if ((this.refs.get(key) ?? 0) <= 0) {
      return this.windows.get(key) ?? [];
    }
    // register the window as a consumer of its (possibly shared) WS channel
    let consumers = this.channelConsumers.get(channelKey);
    if (!consumers) {
      consumers = new Set();
      this.channelConsumers.set(channelKey, consumers);
    }
    consumers.add(key);
    if (shouldSubscribe) {
      this.subscribed.add(key);
      if (spec) {
        const baseKey = `${marketType}:${symbol}:${spec.base}`;
        let set = this.synthSubs.get(baseKey);
        if (!set) {
          set = new Set();
          this.synthSubs.set(baseKey, set);
        }
        set.add(key);
      }
      // tfToWsChannel resolves synthetic TFs to their base channel
      try {
        await this.ws.subscribe([
          { instType: wsInstType(marketType), channel: tfToWsChannel(tf), instId: symbol },
        ]);
      } catch (e) {
        // subscribe failed (e.g. WS connect refused): roll the bookkeeping
        // back so a later acquire actually retries instead of assuming the
        // channel is live
        consumers.delete(key);
        this.subscribed.delete(key);
        if (spec) {
          const baseKey = `${marketType}:${symbol}:${spec.base}`;
          this.synthSubs.get(baseKey)?.delete(key);
        }
        const n = (this.refs.get(key) ?? 1) - 1;
        if (n <= 0) {
          this.refs.delete(key);
          this.windows.delete(key);
        } else {
          this.refs.set(key, n);
        }
        throw e;
      }
    }
    return this.windows.get(key) ?? [];
  }

  release(marketType: MarketType, symbol: string, tf: Timeframe) {
    const key = windowKey(marketType, symbol, tf);
    const n = (this.refs.get(key) ?? 1) - 1;
    this.refs.set(key, Math.max(0, n));
    if (n <= 0) {
      const spec = synthSpec(tf);
      if (spec) {
        const baseKey = `${marketType}:${symbol}:${spec.base}`;
        const set = this.synthSubs.get(baseKey);
        if (set) {
          set.delete(key);
          if (!set.size) this.synthSubs.delete(baseKey);
        }
        this.syntheticBase.delete(key);
      }
      const channelKey = `${wsInstType(marketType)}:${tfToWsChannel(tf)}:${symbol}`;
      // only unsubscribe when NO other window still consumes this channel
      const consumers = this.channelConsumers.get(channelKey);
      consumers?.delete(key);
      if (consumers && consumers.size === 0) {
        this.channelConsumers.delete(channelKey);
        this.ws
          .unsubscribe([
            { instType: wsInstType(marketType), channel: tfToWsChannel(tf), instId: symbol },
          ])
          .catch(() => undefined);
      }
      this.subscribed.delete(key);
      this.windows.delete(key);
      this.refs.delete(key);
      this.lastUpdate.delete(key);
      this.staleNotified.delete(key);
    }
  }

  peek(marketType: MarketType, symbol: string, tf: Timeframe): Candle[] {
    return this.windows.get(windowKey(marketType, symbol, tf)) ?? [];
  }

  /**
   * Read-only history fetch for API routes: reuses a live window when the
   * rule engine is monitoring this symbol, otherwise loads via REST without
   * registering any WS subscription (no leak).
   */
  async snapshot(marketType: MarketType, symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
    const existing = this.windows.get(windowKey(marketType, symbol, tf));
    if (existing?.length) return existing.slice(-limit);
    return this.loadHistory(marketType, symbol, tf, limit);
  }

  private async loadHistory(marketType: MarketType, symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
    const rest = new BitgetRest();
    const mult = tfMultiplier(tf);
    // no .catch here: a silently-empty history renders as a blank chart with
    // ok:true — let acquire()/snapshot() surface the failure so the browser
    // fallback and the API error response can react
    const rows = await rest.candles(marketType, symbol, tfToGranularity(tf, marketType), Math.min(limit * mult, 1000));
    let candles: Candle[] = normalizeCandles(rows);
    // the regular candles endpoint silently truncates coarse granularities
    // (1D returns ~90 rows regardless of limit) — backfill older bars from the
    // paged history endpoint so deep windows (EMA200 warmup, signal engine)
    // still load
    if (candles.length > 0 && candles.length < limit) {
      try {
        // synthetic TFs: fetch RAW base bars — fetchHistory(tf) would return
        // already-aggregated bars, and storing those as syntheticBase makes
        // the live 1m upserts double-count volume in merged buckets
        const spec0 = synthSpec(tf);
        const deep = await this.fetchHistory(
          marketType, symbol,
          spec0 ? spec0.base : tf,
          spec0 ? limit * tfMultiplier(tf) : limit,
        );
        if (deep.length > candles.length) candles = deep;
      } catch {
        // keep the regular load
      }
    }
    const spec = synthSpec(tf);
    if (spec) {
      // `candles` are raw BASE bars here (regular load resolves synth tf to
      // its base granularity, and the deep fetch was asked for the base too)
      this.syntheticBase.set(windowKey(marketType, symbol, tf), candles.slice());
      candles = aggregateCandles(candles, spec.seconds);
    }
    if (candles.length) candles[candles.length - 1].confirmed = false;
    return candles;
  }

  /** One-off historical fetch that bypasses the live windows (backtester). */
  async fetchHistory(marketType: MarketType, symbol: string, tf: Timeframe, maxCandles: number, endTs?: number): Promise<Candle[]> {
    const rest = new BitgetRest();
    const granularity = tfToGranularity(tf, marketType); // base granularity for synthetic TFs
    const mult = tfMultiplier(tf);
    const needed = Math.min(maxCandles * mult, 20_000);
    // history-candles accepts limit≤200 on BOTH spot and mix endpoints, but
    // the API may still return fewer rows per page than requested (1D pages
    // come back in fixed batches of ~90) — so page until an empty page or a
    // non-advancing cursor, never on a short page
    const pageSize = 200;
    const collected: Candle[] = [];
    let cursor: number | undefined = endTs;
    let lastCursor: number | undefined;
    for (let page = 0; page < 40 && collected.length < needed; page++) {
      const rows = await rest.historyCandles(marketType, symbol, granularity, Math.min(pageSize, needed - collected.length), cursor);
      if (!rows?.length) break; // reached the oldest available data
      const candles = normalizeCandles(rows);
      collected.unshift(...candles);
      const newCursor = candles[0].time * 1000 - 1;
      if (newCursor === lastCursor) break; // cursor not advancing
      lastCursor = cursor;
      cursor = newCursor;
    }
    const dedup = new Map<number, Candle>();
    for (const c of collected) dedup.set(c.time, c);
    const arr = [...dedup.values()].sort((a, b) => a.time - b.time);
    const spec = synthSpec(tf);
    if (spec) {
      return aggregateCandles(arr, spec.seconds).slice(-maxCandles);
    }
    return arr.slice(-maxCandles);
  }

  /** Instrument precision info with a long-lived cache (only caches success). */
  private instrumentCache?: { ts: number; map: Map<string, InstrumentInfo> };

  async instrument(marketType: MarketType, symbol: string): Promise<InstrumentInfo | undefined> {
    if (this.instrumentCache && Date.now() - this.instrumentCache.ts < 24 * 3600_000) {
      return this.instrumentCache.map.get(`${marketType}:${symbol}`);
    }
    const map = new Map<string, InstrumentInfo>();
    const rest = new BitgetRest();
    const [contracts, spotSymbols] = await Promise.all([
      rest.contracts().catch(() => []),
      rest.spotSymbols().catch(() => []),
    ]);
    for (const c of contracts) {
      const tick = Number(c.priceEndTick ?? 0.01);
      // pricePlace is the exchange's own decimal count; fall back to the tick
      const pricePlace = Number(c.pricePlace ?? NaN);
      map.set(`futures:${c.symbol}`, {
        pricePrecision: Number.isFinite(pricePlace)
          ? pricePlace
          : tick > 0 ? Math.max(0, Math.round(-Math.log10(tick))) : 2,
        quantityPrecision: Number(c.volumePlace ?? 2),
        priceTick: tick > 0 ? tick : undefined,
        minTradeAmount: Number(c.minTradeNum ?? undefined) || undefined,
      });
    }
    for (const s of spotSymbols) {
      map.set(`spot:${s.symbol}`, {
        pricePrecision: Number(s.pricePrecision ?? 2),
        quantityPrecision: Number(s.quantityPrecision ?? 4),
        priceTick: Number(s.priceTickSz ?? undefined) || undefined,
        quotePrecision: Number(s.quotePrecision ?? undefined) || undefined,
        minTradeAmount: Number(s.minTradeAmount ?? undefined) || undefined,
        minTradeUSDT: Number(s.minTradeUSDT ?? undefined) || undefined,
      });
    }
    // only cache successful fetches — a transient outage must not poison
    // precision lookups for the next 24h
    if (map.size > 0) {
      this.instrumentCache = { ts: Date.now(), map };
    } else if (this.instrumentCache) {
      return this.instrumentCache.map.get(`${marketType}:${symbol}`); // keep stale cache
    }
    return map.get(`${marketType}:${symbol}`);
  }
}

function parseWsCandle(row: string[]): Candle | null {
  if (!Array.isArray(row) || row.length < 5) return null;
  const time = Math.floor(Number(row[0]) / 1000);
  const c: Candle = {
    time,
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    baseVol: row[5] != null ? parseFloat(row[5]) : undefined,
    quoteVol: row[6] != null ? parseFloat(row[6]) : undefined,
    confirmed: false,
  };
  // a NaN open/high/low poisons aggregateCandles → ATR → votes → scores
  if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) return null;
  return c;
}

function channelToTf(channel: string): Timeframe | null {
  const map: Record<string, Timeframe> = {
    candle1m: '1m', candle5m: '5m', candle15m: '15m', candle30m: '30m', candle1H: '1h',
    candle4H: '4h', candle6H: '6h', candle12H: '12h', candle1D: '1d', candle3D: '3d',
    candle1W: '1w', candle1M: '1M',
  };
  return map[channel] ?? null;
}

export const candleService = new CandleService();

export function isPaperMode(): boolean {
  return settingsRepo.get().general.paperMode;
}
