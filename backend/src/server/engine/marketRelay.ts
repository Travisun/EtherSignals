import type { Server, Socket } from 'socket.io';
import { BitgetWs, type WsSubArg } from '@/server/bitget/ws';
import { candleService, windowKey } from './candleService';
import { levelsService } from './levelsService';
import { bus, Events } from '@/server/events/bus';
import { wsInstType } from '@/lib/format';
import type { Book, MarketType, PublicTrade, Timeframe } from '@/core/types';

// ─── Market relay: browsers never talk to the exchange ───────────────────────
// One exchange client (this server) fans out to any number of browsers over
// the app Socket.IO channel. Candle windows live in the shared candleService
// (refcounted per room); books/trades ride a dedicated public WS because the
// candleService only handles candle channels; tickers come from the 15s REST
// cache sweep via the bus.

const CANDLE_PUSH_MS = 300;
const BOOK_PUSH_MS = 400;
const TRADE_FLUSH_MS = 300;
/** tail bars pushed per candle update: the forming bar + the just-closed one */
const TAIL_BARS = 2;

export interface RelaySub {
  channel: string; // 'candle' | 'ticker' | 'books15' | 'books5' | 'trade'
  tf?: Timeframe; // candle channels: the logical window timeframe (synth ok)
  marketType: string;
  instId: string;
}

interface RoomState {
  sockets: Set<string>;
  timer?: NodeJS.Timeout;
  /** candle rooms: a push is pending since the last flush */
  dirty?: boolean;
}

function getIo(): Server | undefined {
  return (globalThis as { __gtIo?: Server }).__gtIo;
}

export class MarketRelay {
  private candleRooms = new Map<string, RoomState>(); // window key -> room
  private tickerRooms = new Map<string, Set<string>>(); // `${mt}:${sym}` -> socketIds
  private bookRooms = new Map<string, RoomState & { latest?: Book }>();
  private tradeRooms = new Map<string, RoomState & { buf: PublicTrade[] }>();
  private socketRooms = new Map<string, Set<string>>(); // socketId -> io room names
  private ws = new BitgetWs('public');
  private busOffs: (() => void)[] = [];
  started = false;

  attach() {
    const io = getIo();
    if (!io || this.started) return;
    this.started = true;
    levelsService.attach(io);

    this.ws.on('data', (arg: WsSubArg, data: unknown[]) => this.onPublicData(arg, data));
    this.busOffs.push(
      bus.on('market.candle.updated', (p) => this.onCandleUpdated(p as { key: string })),
      bus.on(Events.TICKER, () => this.pushTickers()),
    );

    io.on('connection', (socket) => {
      socket.on('market:sub', (msg: { subs?: RelaySub[] } = {}) => {
        for (const sub of msg?.subs ?? []) void this.addSub(socket, sub);
      });
      socket.on('market:unsub', (msg: { subs?: RelaySub[] } = {}) => {
        for (const sub of msg?.subs ?? []) this.removeSub(socket.id, sub);
      });
      socket.on('disconnect', () => this.dropSocket(socket.id));
    });
  }

  stop() {
    for (const off of this.busOffs) off();
    this.busOffs = [];
    this.ws.close();
    for (const [key, room] of this.candleRooms) {
      if (room.timer) clearTimeout(room.timer);
      const [marketType, symbol, tf] = key.split(':') as [MarketType, string, Timeframe];
      candleService.release(marketType, symbol, tf);
    }
    for (const room of this.bookRooms.values()) if (room.timer) clearTimeout(room.timer);
    for (const room of this.tradeRooms.values()) if (room.timer) clearTimeout(room.timer);
    this.candleRooms.clear();
    this.tickerRooms.clear();
    this.bookRooms.clear();
    this.tradeRooms.clear();
    this.socketRooms.clear();
    this.ws = new BitgetWs('public');
    this.started = false;
  }

  // ─── subscription bookkeeping ───────────────────────────────────────────────

  private async addSub(socket: Socket, sub: RelaySub) {
    const mt: MarketType = sub.marketType === 'spot' ? 'spot' : 'futures';
    const instId = String(sub.instId ?? '').toUpperCase();
    if (!instId) return;
    if (sub.channel === 'candle') {
      if (!sub.tf) return;
      const key = windowKey(mt, instId, sub.tf);
      let room = this.candleRooms.get(key);
      const fresh = !room;
      if (!room) {
        room = { sockets: new Set() };
        this.candleRooms.set(key, room);
        try {
          await candleService.acquire(mt, instId, sub.tf, 300);
        } catch (e) {
          console.error(`[relay] acquire ${key}:`, e instanceof Error ? e.message : e);
        }
      }
      room.sockets.add(socket.id);
      this.trackSocket(socket.id, `mk:${key}`);
      socket.join(`mk:${key}`);
      if (fresh) {
        // seed the late joiner with the current tail (bootstrap history comes
        // from the REST route; this only bridges the gap until the next push)
        const tail = candleService.peek(mt, instId, sub.tf).slice(-TAIL_BARS);
        if (tail.length) socket.emit('market:candle', { key, candles: tail });
      }
      void marketHistoryTouch(mt, instId);
    } else if (sub.channel === 'ticker') {
      const key = `${mt}:${instId}`;
      let set = this.tickerRooms.get(key);
      if (!set) {
        set = new Set();
        this.tickerRooms.set(key, set);
      }
      set.add(socket.id);
      this.trackSocket(socket.id, `tk:${key}`);
      socket.join(`tk:${key}`);
      const t = candleService.ticker(mt, instId);
      if (t) socket.emit('market:ticker', { marketType: mt, tickers: [t] });
    } else if (sub.channel === 'books15' || sub.channel === 'books5') {
      const key = `${mt}:${instId}`;
      let room = this.bookRooms.get(key);
      if (!room) {
        room = { sockets: new Set() };
        this.bookRooms.set(key, room);
        try {
          await this.ws.subscribe([{ instType: wsInstType(mt), channel: 'books15', instId }]);
        } catch (e) {
          console.error(`[relay] books subscribe ${key}:`, e instanceof Error ? e.message : e);
        }
      }
      room.sockets.add(socket.id);
      this.trackSocket(socket.id, `bk:${key}`);
      socket.join(`bk:${key}`);
    } else if (sub.channel === 'trade') {
      const key = `${mt}:${instId}`;
      let room = this.tradeRooms.get(key);
      if (!room) {
        room = { sockets: new Set(), buf: [] };
        this.tradeRooms.set(key, room);
        try {
          await this.ws.subscribe([{ instType: wsInstType(mt), channel: 'trade', instId }]);
        } catch (e) {
          console.error(`[relay] trade subscribe ${key}:`, e instanceof Error ? e.message : e);
        }
      }
      room.sockets.add(socket.id);
      this.trackSocket(socket.id, `tr:${key}`);
      socket.join(`tr:${key}`);
    }
  }

  private removeSub(socketId: string, sub: RelaySub) {
    const mt: MarketType = sub.marketType === 'spot' ? 'spot' : 'futures';
    const instId = String(sub.instId ?? '').toUpperCase();
    if (!instId) return;
    if (sub.channel === 'candle' && sub.tf) {
      this.leaveCandle(socketId, windowKey(mt, instId, sub.tf));
    } else if (sub.channel === 'ticker') {
      const key = `${mt}:${instId}`;
      const set = this.tickerRooms.get(key);
      if (!set) return;
      set.delete(socketId);
      this.untrackSocket(socketId, `tk:${key}`);
      if (!set.size) this.tickerRooms.delete(key);
    } else if (sub.channel === 'books15' || sub.channel === 'books5') {
      const key = `${mt}:${instId}`;
      const room = this.bookRooms.get(key);
      if (!room) return;
      room.sockets.delete(socketId);
      this.untrackSocket(socketId, `bk:${key}`);
      if (!room.sockets.size) {
        if (room.timer) clearTimeout(room.timer);
        this.bookRooms.delete(key);
        this.ws.unsubscribe([{ instType: wsInstType(mt), channel: 'books15', instId }]).catch(() => undefined);
      }
    } else if (sub.channel === 'trade') {
      const key = `${mt}:${instId}`;
      const room = this.tradeRooms.get(key);
      if (!room) return;
      room.sockets.delete(socketId);
      this.untrackSocket(socketId, `tr:${key}`);
      if (!room.sockets.size) {
        if (room.timer) clearTimeout(room.timer);
        this.tradeRooms.delete(key);
        this.ws.unsubscribe([{ instType: wsInstType(mt), channel: 'trade', instId }]).catch(() => undefined);
      }
    }
  }

  private leaveCandle(socketId: string, key: string) {
    const room = this.candleRooms.get(key);
    if (!room) return;
    room.sockets.delete(socketId);
    this.untrackSocket(socketId, `mk:${key}`);
    if (!room.sockets.size) {
      if (room.timer) clearTimeout(room.timer);
      this.candleRooms.delete(key);
      const [marketType, symbol, tf] = key.split(':') as [MarketType, string, Timeframe];
      candleService.release(marketType, symbol, tf);
    }
  }

  private dropSocket(socketId: string) {
    const rooms = this.socketRooms.get(socketId);
    if (!rooms) return;
    for (const roomName of rooms) {
      if (!roomName.startsWith('mk:')) continue;
      // candle rooms are keyed by their window key — reconstruct it
      this.leaveCandle(socketId, roomName.slice(3));
    }
    // ticker/book/trade maps resolve through membership scan (small maps)
    for (const [key, set] of this.tickerRooms) {
      if (set.delete(socketId) && !set.size) {
        this.tickerRooms.delete(key);
        this.untrackSocket(socketId, `tk:${key}`);
      }
    }
    for (const [key, room] of this.bookRooms) {
      if (room.sockets.delete(socketId) && !room.sockets.size) {
        if (room.timer) clearTimeout(room.timer);
        this.bookRooms.delete(key);
        this.untrackSocket(socketId, `bk:${key}`);
        const [mt, instId] = key.split(':') as [MarketType, string];
        this.ws.unsubscribe([{ instType: wsInstType(mt), channel: 'books15', instId }]).catch(() => undefined);
      }
    }
    for (const [key, room] of this.tradeRooms) {
      if (room.sockets.delete(socketId) && !room.sockets.size) {
        if (room.timer) clearTimeout(room.timer);
        this.tradeRooms.delete(key);
        this.untrackSocket(socketId, `tr:${key}`);
        const [mt, instId] = key.split(':') as [MarketType, string];
        this.ws.unsubscribe([{ instType: wsInstType(mt), channel: 'trade', instId }]).catch(() => undefined);
      }
    }
    this.socketRooms.delete(socketId);
  }

  private trackSocket(socketId: string, roomName: string) {
    let set = this.socketRooms.get(socketId);
    if (!set) {
      set = new Set();
      this.socketRooms.set(socketId, set);
    }
    set.add(roomName);
  }

  private untrackSocket(socketId: string, roomName: string) {
    const set = this.socketRooms.get(socketId);
    set?.delete(roomName);
    if (set && !set.size) this.socketRooms.delete(socketId);
  }

  // ─── push paths ─────────────────────────────────────────────────────────────

  private onCandleUpdated(p: { key: string }) {
    if (!p?.key) return;
    const room = this.candleRooms.get(p.key);
    if (!room?.sockets.size) return;
    room.dirty = true;
    if (room.timer) return;
    room.timer = setTimeout(() => {
      room.timer = undefined;
      if (!room.dirty) return;
      room.dirty = false;
      const [marketType, symbol, tf] = p.key.split(':') as [MarketType, string, Timeframe];
      const tail = candleService.peek(marketType, symbol, tf).slice(-TAIL_BARS);
      if (!tail.length) return;
      getIo()?.to(`mk:${p.key}`).emit('market:candle', { key: p.key, candles: tail });
    }, CANDLE_PUSH_MS);
    room.timer.unref?.();
  }

  private pushTickers() {
    const io = getIo();
    if (!io) return;
    for (const [key, set] of this.tickerRooms) {
      if (!set.size) continue;
      const [marketType, symbol] = key.split(':') as [MarketType, string];
      const t = candleService.ticker(marketType, symbol);
      if (t) io.to(`tk:${key}`).emit('market:ticker', { marketType, tickers: [t] });
    }
  }

  private onPublicData(arg: WsSubArg, data: unknown[]) {
    const mt: MarketType = arg.instType === 'SP' ? 'spot' : 'futures';
    if (arg.channel === 'books15' || arg.channel === 'books5') {
      const key = `${mt}:${arg.instId}`;
      const room = this.bookRooms.get(key);
      if (!room?.sockets.size) return;
      for (const row of data as { asks: string[][]; bids: string[][]; ts?: string }[]) {
        const parse = (rows: string[][]) =>
          rows.slice(0, 15).map((r) => ({ price: parseFloat(r[0]), size: parseFloat(r[1]) })).filter((l) => Number.isFinite(l.price));
        room.latest = { asks: parse(row.asks), bids: parse(row.bids), ts: Number(row.ts) || Date.now() };
      }
      if (room.timer) return;
      room.timer = setTimeout(() => {
        room.timer = undefined;
        if (!room.latest) return;
        getIo()?.to(`bk:${key}`).emit('market:book', { key, book: room.latest });
      }, BOOK_PUSH_MS);
      room.timer.unref?.();
    } else if (arg.channel === 'trade') {
      const key = `${mt}:${arg.instId}`;
      const room = this.tradeRooms.get(key);
      if (!room?.sockets.size) return;
      // v2 trade rows are objects {ts, price, size, side, tradeId} — the
      // legacy array shape silently parsed to nothing
      for (const row of data as { ts?: string; price: string; size: string; side?: string }[]) {
        const price = parseFloat(row.price);
        if (!Number.isFinite(price)) continue;
        room.buf.push({
          ts: Number(row.ts) || Date.now(),
          price,
          size: parseFloat(row.size) || 0,
          side: (row.side as 'buy' | 'sell') ?? 'buy',
        });
      }
      if (room.timer) return;
      room.timer = setTimeout(() => {
        room.timer = undefined;
        if (!room.buf.length) return;
        const trades = room.buf.splice(0);
        getIo()?.to(`tr:${key}`).emit('market:trade', { key, trades });
      }, TRADE_FLUSH_MS);
      room.timer.unref?.();
    }
  }
}

/** views of a symbol warm its history capture (fire-and-forget) */
async function marketHistoryTouch(marketType: MarketType, symbol: string) {
  try {
    const { marketHistory } = await import('./marketHistory');
    await marketHistory.track(marketType, symbol);
  } catch {
    // capture is best-effort; rendering never depends on it
  }
}

export const marketRelay = new MarketRelay();
