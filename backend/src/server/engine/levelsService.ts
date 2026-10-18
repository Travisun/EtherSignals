import type { Server } from 'socket.io';
import { candleService } from './candleService';
import { marketHistory } from './marketHistory';
import { bus } from '@/server/events/bus';
import { DEFAULT_DON_N, NHNL_TFS, computeNhnlSnapshot } from '@/core/nhnl';
import type { MarketType, NhnlSnapshot, Timeframe } from '@/core/types';

const PUSH_THROTTLE_MS = 500;
/** REST "prime" without a socket subscriber: release the ladder windows when
 *  no one subscribed within this window (acquire() is refcounted, so a late
 *  subscriber simply re-acquires). */
const IDLE_RELEASE_MS = 10 * 60_000;

interface RoomState {
  sockets: Set<string>;
  donN: number;
  timer?: NodeJS.Timeout;
  dirty: boolean;
}

/**
 * Multi-timeframe new-high/new-low ladder: one server-side evaluation per
 * (marketType, symbol) relayed to any number of browsers. Holds the ladder's
 * windows in the candleService (8 native channels + 2 synthetic) and pushes a
 * throttled NhnlSnapshot whenever any of them ticks.
 */
export class LevelsService {
  private rooms = new Map<string, RoomState>();
  private busOff?: () => void;
  private io?: Server;
  started = false;

  /** Register the bus forwarder + socket handlers. Safe to call once per io. */
  attach(io: Server) {
    this.io = io;
    if (this.started) return;
    this.started = true;
    this.busOff = bus.on('market.candle.updated', (p) => this.onCandleUpdated(p as { key: string }));
    io.on('connection', (socket) => {
      socket.on('levels:sub', (msg: { marketType?: string; symbol?: string; donN?: number } = {}) => {
        const marketType = msg.marketType === 'spot' ? 'spot' : 'futures';
        const symbol = String(msg.symbol ?? '').toUpperCase();
        if (symbol) void this.subscribe(socket, marketType, symbol, msg.donN);
      });
      socket.on('levels:unsub', (msg: { marketType?: string; symbol?: string } = {}) => {
        const marketType = msg.marketType === 'spot' ? 'spot' : 'futures';
        const symbol = String(msg.symbol ?? '').toUpperCase();
        if (symbol) this.unsubscribe(socket.id, marketType, symbol);
      });
      socket.on('disconnect', () => {
        for (const [key, room] of this.rooms) {
          if (room.sockets.delete(socket.id) && !room.sockets.size) this.dropRoom(key);
        }
      });
    });
  }

  stop() {
    this.busOff?.();
    this.busOff = undefined;
    for (const [key, room] of this.rooms) {
      if (room.timer) clearTimeout(room.timer);
      this.releaseLadder(key);
    }
    this.rooms.clear();
    this.started = false;
  }

  /** Join a socket to the symbol's ladder room (idempotent per socket). */
  async subscribe(socket: { id: string; join: (room: string) => unknown }, marketType: MarketType, symbol: string, donN?: number) {
    const key = `${marketType}:${symbol}`;
    let room = this.rooms.get(key);
    if (!room) {
      room = { sockets: new Set(), donN: donN ?? DEFAULT_DON_N, dirty: false };
      this.rooms.set(key, room);
      await this.acquireLadder(marketType, symbol);
    }
    if (donN && room.sockets.size === 0) room.donN = donN;
    room.sockets.add(socket.id);
    socket.join(`levels:${key}`);
    // marketHistory keeps its own refs; this only makes sure the symbol is
    // captured so the ladder has deep history behind it
    void marketHistory.track(marketType, symbol).catch(() => undefined);
    // fresh snapshot right away (rows may still fill in as windows load)
    this.emitFor(key);
  }

  unsubscribe(socketId: string, marketType: MarketType, symbol: string) {
    const key = `${marketType}:${symbol}`;
    const room = this.rooms.get(key);
    if (!room) return;
    room.sockets.delete(socketId);
    if (!room.sockets.size) this.dropRoom(key);
  }

  /** Current ladder for the REST route; primes the windows for late subscribers. */
  async snapshot(marketType: MarketType, symbol: string, donN = DEFAULT_DON_N): Promise<NhnlSnapshot> {
    const key = `${marketType}:${symbol}`;
    if (!this.rooms.has(key)) {
      await this.acquireLadder(marketType, symbol).catch(() => undefined);
      void marketHistory.track(marketType, symbol).catch(() => undefined);
      // nobody subscribed → drop the windows again after the idle window
      setTimeout(() => {
        const room = this.rooms.get(key);
        if (!room || !room.sockets.size) this.dropRoom(key);
      }, IDLE_RELEASE_MS).unref?.();
    }
    return this.buildSnapshot(marketType, symbol, donN);
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private async acquireLadder(marketType: MarketType, symbol: string) {
    for (const tf of NHNL_TFS) {
      try {
        await candleService.acquire(marketType, symbol, tf, 250);
      } catch (e) {
        console.error(`[levels] acquire ${marketType} ${symbol} ${tf}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  private releaseLadder(key: string) {
    const [marketType, symbol] = key.split(':') as [MarketType, string];
    for (const tf of NHNL_TFS) candleService.release(marketType, symbol, tf);
  }

  private dropRoom(key: string) {
    const room = this.rooms.get(key);
    if (!room) return;
    if (room.timer) clearTimeout(room.timer);
    this.rooms.delete(key);
    this.releaseLadder(key);
  }

  private onCandleUpdated(p: { key: string }) {
    if (!p?.key) return;
    const prefix = p.key.slice(0, p.key.lastIndexOf(':'));
    for (const [key, room] of this.rooms) {
      if (prefix !== key) continue;
      room.dirty = true;
      if (room.timer) continue;
      room.timer = setTimeout(() => {
        room.timer = undefined;
        if (!room.dirty) return;
        room.dirty = false;
        this.emitFor(key);
      }, PUSH_THROTTLE_MS);
      room.timer.unref?.();
    }
  }

  private emitFor(key: string) {
    const room = this.rooms.get(key);
    if (!room?.sockets.size || !this.io) return;
    const [marketType, symbol] = key.split(':') as [MarketType, string];
    try {
      this.io.to(`levels:${key}`).emit('levels:update', this.buildSnapshot(marketType, symbol, room.donN));
    } catch {
      // room vanished mid-emit — next tick re-evaluates
    }
  }

  private buildSnapshot(marketType: MarketType, symbol: string, donN: number): NhnlSnapshot {
    // tick-level price: the forming 1m bar's close
    const price = candleService.lastPrice(marketType, symbol);
    const windows: Partial<Record<Timeframe, ReturnType<typeof candleService.peek>>> = {};
    for (const tf of NHNL_TFS) windows[tf] = candleService.peek(marketType, symbol, tf);
    return {
      marketType,
      symbol,
      price: price || 0,
      donN,
      rows: computeNhnlSnapshot(windows, price || 0, donN),
      at: Date.now(),
    };
  }
}

export const levelsService = new LevelsService();
