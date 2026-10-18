import fs from 'fs';
import path from 'path';
import { candleService } from './candleService';
import { aggregateCandles, upsertCandle } from '@/lib/candles';
import { tfSeconds } from '@/lib/format';
import { bus, Events } from '@/server/events/bus';
import { settingsRepo } from '@/server/store/repos';
import { getDataDir } from '@/server/store/jsonStore';
import type { Candle, MarketType, Timeframe } from '@/core/types';

// ─── Tiered market-history store ─────────────────────────────────────────────
// The server is the ONLY exchange client: every tracked symbol's bars are
// captured from the live feed (CANDLE_CLOSED) and backfilled once from the
// paged history REST endpoint, then served to any number of browsers without
// them touching the exchange. Three native tiers cover all 16 timeframes:
//   1m → 1m/2m/5m/15m/30m   (≈ 5.5 days backfilled, 10k bars kept)
//   1h → 1h/2h/4h/6h/8h/12h (≈ 166 days backfilled, 5k bars kept)
//   1d → 1d/2d/3d/1w/1M     (≈ 6.8 years backfilled, 3k bars kept)
// Files are JSONL (one compact row per line) under <DATA_DIR>/market/.

const TIERS = ['1m', '1h', '1d'] as const;
type Tier = (typeof TIERS)[number];

const TIER_CAP: Record<Tier, number> = { '1m': 10_000, '1h': 5_000, '1d': 3_000 };
const TIER_BACKFILL: Record<Tier, number> = { '1m': 8_000, '1h': 4_000, '1d': 2_500 };
/** symbols auto-tracked from UI activity (watchlist entries are always kept) */
const AUTO_TRACK_LIMIT = 20;
const FLUSH_MS = 2_000;
/** spacing between paged REST backfills — the history endpoint is the tightest
 *  rate limit on the whole exchange API */
const BACKFILL_GAP_MS = 400;
const TOPUP_COOLDOWN_MS = 15 * 60_000;

export function tierFor(tf: Timeframe): Tier {
  return tfSeconds(tf) >= 86_400 ? '1d' : tfSeconds(tf) >= 3_600 ? '1h' : '1m';
}

const marketKey = (marketType: MarketType, symbol: string) => `${marketType}:${symbol}`;
const bufferKey = (marketType: MarketType, symbol: string, tier: Tier) => `${marketType}:${symbol}:${tier}`;

/** compact on-disk row: [t, o, h, l, c, baseVol, quoteVol] */
function encodeRow(c: Candle): string {
  return JSON.stringify([c.time, c.open, c.high, c.low, c.close, c.baseVol ?? 0, c.quoteVol ?? 0]);
}

function decodeRow(line: string): Candle | null {
  try {
    const r = JSON.parse(line) as unknown[];
    if (!Array.isArray(r) || r.length < 5) return null;
    const c: Candle = {
      time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]),
      baseVol: Number(r[5] ?? 0) || undefined, quoteVol: Number(r[6] ?? 0) || undefined, confirmed: true,
    };
    if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) return null;
    return c;
  } catch {
    return null;
  }
}

export interface StoredCandles {
  candles: Candle[];
  /** true when the store could not cover the requested depth */
  partial: boolean;
}

export class MarketHistory {
  private dir = path.join(getDataDir(), 'market');
  /** tier buffers: `${marketType}:${symbol}:${tier}` -> ascending closed bars */
  private buffers = new Map<string, Candle[]>();
  /** tracked symbols (insertion order = LRU): `${marketType}:${symbol}` */
  private tracked = new Set<string>();
  /** pending JSONL lines per file awaiting the debounced append */
  private pending = new Map<string, string[]>();
  private flushTimer?: NodeJS.Timeout;
  private reconcileTimer?: NodeJS.Timeout;
  private busOff?: () => void;
  /** per (window,tf) last top-up attempt — never hammer the history endpoint */
  private lastTopUp = new Map<string, number>();
  private backfillQueue: { marketType: MarketType; symbol: string; tier: Tier }[] = [];
  private backfillRunning = false;
  private lastTrackOrder = '';
  started = false;

  async start() {
    if ( this.started) return;
    this.started = true;
    fs.mkdirSync(this.dir, { recursive: true });
    // restore the tracked set (buffers themselves lazy-load per symbol)
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(this.dir, 'index.json'), 'utf8')) as { tracked?: string[] };
      for (const key of idx.tracked ?? []) {
        const [marketType, symbol] = key.split(':') as [MarketType, string];
        if (marketType && symbol) this.tracked.add(key);
      }
    } catch {
      // first run — no index yet
    }
    this.busOff = bus.on(Events.CANDLE_CLOSED, (p) => this.onCandleClosed(p as { key: string; candle: Candle }));
    // reconcile watchlist + LRU + flush on a slow loop
    this.reconcileTimer = setInterval(() => this.reconcile(), 5 * 60_000);
    this.reconcileTimer.unref?.();
    // restart every previously tracked symbol (live capture + gap backfill)
    for (const key of [...this.tracked]) {
      const [marketType, symbol] = key.split(':') as [MarketType, string];
      void this.attach(marketType, symbol).catch((e) =>
        console.error(`[history] attach ${key}:`, e instanceof Error ? e.message : e));
    }
  }

  stop() {
    if (!this.started) return;
    this.busOff?.();
    this.busOff = undefined;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = undefined;
    this.flushSync();
    for (const key of this.tracked) {
      const [marketType, symbol] = key.split(':') as [MarketType, string];
      for (const tier of TIERS) candleService.release(marketType, symbol, tier);
    }
    this.tracked.clear();
    this.buffers.clear();
    this.started = false;
  }

  /** Register a symbol for live capture + backfill (idempotent, LRU-capped). */
  async track(marketType: MarketType, symbol: string) {
    if (!settingsRepo.get().history.enabled) return;
    if (!this.started) await this.start();
    const key = marketKey(marketType, symbol);
    // LRU touch
    this.tracked.delete(key);
    this.tracked.add(key);
    this.persistIndex();
    await this.attach(marketType, symbol);
    this.evictOverflow();
  }

  /** Symbols currently under live capture (engine dashboard). */
  listTracked(): string[] {
    return [...this.tracked];
  }

  /**
   * Serve candles for any timeframe from the tier store, topped with the live
   * (still-forming) bars from the in-memory windows. Returns null when the
   * symbol was never captured — the caller falls back to the exchange path.
   */
  serve(marketType: MarketType, symbol: string, tf: Timeframe, limit: number): StoredCandles | null {
    const tier = tierFor(tf);
    const stored = this.loadBuffer(marketType, symbol, tier);
    if (!stored.length && !this.tracked.has(marketKey(marketType, symbol))) return null;
    const merged = new Map<number, Candle>();
    for (const c of aggregateCandles(stored, tfSeconds(tf))) merged.set(c.time, c);
    // the live window is the newest truth — overlay it wholesale
    for (const c of candleService.peek(marketType, symbol, tf)) merged.set(c.time, c);
    const candles = [...merged.values()].sort((a, b) => a.time - b.time).slice(-limit);
    const partial = candles.length < limit;
    if (partial) void this.topUp(marketType, symbol, tier, tf);
    return { candles, partial };
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  /** Hold live windows + queue a gap backfill for one symbol (idempotent). */
  private async attach(marketType: MarketType, symbol: string) {
    for (const tier of TIERS) {
      this.loadBuffer(marketType, symbol, tier);
      try {
        await candleService.acquire(marketType, symbol, tier, 50);
      } catch (e) {
        console.error(`[history] acquire ${marketType} ${symbol} ${tier}:`, e instanceof Error ? e.message : e);
        continue;
      }
      const buf = this.buffers.get(bufferKey(marketType, symbol, tier))!;
      if (buf.length < TIER_BACKFILL[tier] * 0.6) {
        this.queueBackfill(marketType, symbol, tier);
      }
    }
  }

  private queueBackfill(marketType: MarketType, symbol: string, tier: Tier) {
    if (this.backfillQueue.some((q) => q.marketType === marketType && q.symbol === symbol && q.tier === tier)) return;
    this.backfillQueue.push({ marketType, symbol, tier });
    void this.drainBackfills();
  }

  /** One paged REST backfill at a time, spaced out to respect rate limits. */
  private async drainBackfills() {
    if (this.backfillRunning) return;
    this.backfillRunning = true;
    try {
      while (this.backfillQueue.length) {
        const job = this.backfillQueue.shift()!;
        if (!this.tracked.has(marketKey(job.marketType, job.symbol))) continue;
        try {
          const history = await candleService.fetchHistory(job.marketType, job.symbol, job.tier, TIER_BACKFILL[job.tier]);
          const buf = this.loadBuffer(job.marketType, job.symbol, job.tier);
          const merged = new Map<number, Candle>();
          for (const c of history) merged.set(c.time, c); // stored/live rows win over the REST copy
          for (const c of buf) merged.set(c.time, c);
          const next = [...merged.values()].sort((a, b) => a.time - b.time).slice(-TIER_CAP[job.tier]);
          this.buffers.set(bufferKey(job.marketType, job.symbol, job.tier), next);
          this.rewrite(job.marketType, job.symbol, job.tier, next);
        } catch (e) {
          console.error(`[history] backfill ${job.marketType} ${job.symbol} ${job.tier}:`, e instanceof Error ? e.message : e);
        }
        await new Promise((r) => setTimeout(r, BACKFILL_GAP_MS));
      }
    } finally {
      this.backfillRunning = false;
    }
  }

  /** Ask the store for deeper history when a render came up short. */
  private async topUp(marketType: MarketType, symbol: string, tier: Tier, tf: Timeframe) {
    const wkey = `${bufferKey(marketType, symbol, tier)}:${tf}`;
    const last = this.lastTopUp.get(wkey) ?? 0;
    if (Date.now() - last < TOPUP_COOLDOWN_MS) return;
    this.lastTopUp.set(wkey, Date.now());
    const buf = this.loadBuffer(marketType, symbol, tier);
    if (buf.length >= TIER_CAP[tier]) return; // store is full — depth limit reached
    this.queueBackfill(marketType, symbol, tier);
  }

  private onCandleClosed(p: { key: string; candle: Candle }) {
    if (!p?.key || !p.candle) return;
    const [marketType, symbol, tf] = p.key.split(':') as [MarketType, string, Timeframe];
    if (!(TIERS as readonly string[]).includes(tf)) return;
    if (!this.tracked.has(marketKey(marketType, symbol))) return;
    const tier = tf as Tier;
    const buf = this.loadBuffer(marketType, symbol, tier);
    upsertCandle(buf, { ...p.candle, confirmed: true });
    if (buf.length > TIER_CAP[tier]) buf.splice(0, buf.length - TIER_CAP[tier]);
    const file = this.fileName(marketType, symbol, tier);
    const lines = this.pending.get(file) ?? [];
    lines.push(encodeRow(p.candle));
    this.pending.set(file, lines);
    this.scheduleFlush();
  }

  /** Lazy-load a tier buffer from disk (dedup + sort; compact when fragmented). */
  private loadBuffer(marketType: MarketType, symbol: string, tier: Tier): Candle[] {
    const key = bufferKey(marketType, symbol, tier);
    const cached = this.buffers.get(key);
    if (cached) return cached;
    const rows = new Map<number, Candle>();
    let fragmented = 0;
    try {
      const raw = fs.readFileSync(this.fileName(marketType, symbol, tier), 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        const c = decodeRow(line);
        if (!c) { fragmented++; continue; }
        if (rows.has(c.time)) fragmented++;
        rows.set(c.time, c);
      }
    } catch {
      // missing file = first capture for this symbol
    }
    let arr = [...rows.values()].sort((a, b) => a.time - b.time);
    if (arr.length > TIER_CAP[tier]) arr = arr.slice(-TIER_CAP[tier]);
    this.buffers.set(key, arr);
    // rewrite only when meaningful: keeps restart I/O proportional to damage
    if (arr.length && (fragmented > arr.length * 0.02 || arr.length > TIER_CAP[tier])) {
      this.rewrite(marketType, symbol, tier, arr);
    }
    return arr;
  }

  private fileName(marketType: MarketType, symbol: string, tier: Tier): string {
    // symbols are [A-Z0-9]+ from the exchange — no path traversal possible
    if (!/^[a-z0-9-]+$/i.test(`${marketType}-${symbol}`)) throw new Error(`invalid symbol key: ${marketType}-${symbol}`);
    return path.join(this.dir, `${marketType}-${symbol}-${tier}.jsonl`);
  }

  /** Atomic full rewrite (tmp + rename) — backfill results and compaction. */
  private rewrite(marketType: MarketType, symbol: string, tier: Tier, candles: Candle[]) {
    const target = this.fileName(marketType, symbol, tier);
    const tmp = `${target}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, candles.map(encodeRow).join('\n') + '\n', 'utf8');
      fs.renameSync(tmp, target);
      // drop queued appends — the rewrite already contains those bars
      this.pending.delete(target);
    } catch (e) {
      console.error(`[history] rewrite ${target}:`, e instanceof Error ? e.message : e);
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flushSync();
    }, FLUSH_MS);
    this.flushTimer.unref?.();
  }

  /** Append pending lines file-by-file (single write per file per flush). */
  flushSync() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    for (const [file, lines] of this.pending) {
      this.pending.delete(file);
      if (!lines.length) continue;
      try {
        fs.appendFileSync(file, lines.join('\n') + '\n', 'utf8');
      } catch (e) {
        console.error(`[history] append ${file}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  /** Watchlist tracking + LRU eviction + index persistence, on a slow loop. */
  private reconcile() {
    try {
      const settings = settingsRepo.get().history;
      if (settings.enabled) {
        for (const entry of settings.watchlist) {
          const [marketType, symbol] = entry.split(':') as [MarketType, string];
          if (!marketType || !symbol || !['spot', 'futures'].includes(marketType)) continue;
          if (!this.tracked.has(entry)) {
            this.tracked.add(entry);
            void this.attach(marketType, symbol).catch(() => undefined);
          }
        }
      }
      this.evictOverflow();
      this.persistIndex();
    } catch {
      // settings may be mid-write; next sweep retries
    }
  }

  private evictOverflow() {
    const pinned = new Set(settingsRepo.get().history.watchlist);
    const keys = [...this.tracked];
    const evictable = keys.filter((k) => !pinned.has(k));
    let excess = keys.length - AUTO_TRACK_LIMIT;
    for (const key of evictable) {
      if (excess <= 0) break;
      this.tracked.delete(key);
      excess--;
      const [marketType, symbol] = key.split(':') as [MarketType, string];
      for (const tier of TIERS) {
        candleService.release(marketType, symbol, tier);
        this.buffers.delete(bufferKey(marketType, symbol, tier));
      }
    }
  }

  private persistIndex() {
    const sig = [...this.tracked].join(',');
    if (sig === this.lastTrackOrder) return;
    this.lastTrackOrder = sig;
    const target = path.join(this.dir, 'index.json');
    try {
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ tracked: [...this.tracked] }, null, 2), 'utf8');
      fs.renameSync(tmp, target);
    } catch (e) {
      console.error('[history] persist index:', e instanceof Error ? e.message : e);
    }
  }
}

export const marketHistory = new MarketHistory();
