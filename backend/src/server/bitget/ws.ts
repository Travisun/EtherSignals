import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { bitgetWsLoginSign } from './sign';
import { wsAgentOptions } from './proxy';
import type { AccountConfig } from '@/core/types';

const PUBLIC_WS = 'wss://ws.bitget.com/v2/ws/public';
const PRIVATE_WS = 'wss://ws.bitget.com/v2/ws/private';
const PING_INTERVAL = 25_000;
const MAX_RECONNECT_DELAY = 30_000;

export interface WsSubArg {
  instType: string;
  channel: string;
  instId: string;
}

export interface WsMessage {
  arg?: WsSubArg;
  data?: unknown[];
  action?: 'snapshot' | 'update';
  event?: string;
  code?: string;
  msg?: string;
}

/**
 * Bitget v2 WebSocket client with auto ping / reconnect / resubscribe.
 * Reused for both public (market) and private (account) streams.
 */
export class BitgetWs extends EventEmitter {
  private ws: WebSocket | null = null;
  private subs = new Map<string, WsSubArg>();
  private pingTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectDelay = 1_000;
  private closed = false;
  private lastPong = 0;
  reconnectCount = 0;
  private loggedIn = false;
  private loginResend?: ReturnType<typeof setTimeout>;

  constructor(
    private kind: 'public' | 'private',
    private account?: AccountConfig | null,
  ) {
    super();
    this.setMaxListeners(50);
  }

  get url() {
    return this.kind === 'public' ? PUBLIC_WS : PRIVATE_WS;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get subKeys() {
    return [...this.subs.keys()];
  }

  /** ms since the last pong from the server (Infinity before first pong) */
  get pongAge(): number {
    return this.lastPong ? Date.now() - this.lastPong : Number.POSITIVE_INFINITY;
  }

  private keyOf(arg: WsSubArg) {
    return `${arg.instType}:${arg.channel}:${arg.instId}`;
  }

  async connect(): Promise<void> {
    this.closed = false;
    return new Promise((resolve, reject) => {
      try {
        // HTTPS_PROXY routes the exchange WebSocket through the tunnel too
        this.ws = new WebSocket(this.url, wsAgentOptions());
      } catch (e) {
        reject(e);
        return;
      }
      const ws = this.ws;
      const onOpen = () => {
        ws.off('error', onError);
        this.reconnectDelay = 1_000;
        this.lastPong = Date.now();
        this.startPing();
        this.emit('open');
        const args = [...this.subs.values()];
        if (this.kind === 'private') {
          // login first; subscriptions are (re)sent once the server confirms
          // via 'login-success'. A lost login frame is re-sent after 2s.
          this.login();
          if (this.loginResend) clearTimeout(this.loginResend);
          this.loginResend = setTimeout(() => {
            if (this.ws?.readyState === WebSocket.OPEN && !this.loggedIn) this.login();
          }, 2_000);
        } else if (args.length) {
          this.send({ op: 'subscribe', args });
        }
        resolve();
      };
      const onError = (err: Error) => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.off('open', onOpen);
          reject(err);
        }
      };
      ws.on('open', onOpen);
      ws.on('error', onError);
      ws.on('message', (raw) => {
        const text = raw.toString();
        if (text === 'pong') {
          this.lastPong = Date.now();
          this.emit('pong');
          return;
        }
        try {
          const msg = JSON.parse(text) as WsMessage;
          if (msg.event === 'error') {
            this.emit('ws-error', msg);
            return;
          }
          if (msg.event === 'login') {
            this.loggedIn = true;
            this.emit('login-success');
            return;
          }
          if (msg.event === 'subscribe') return;
          if (msg.arg && msg.data) {
            this.emit('data', msg.arg, msg.data, msg.action);
          }
        } catch {
          // ignore malformed frames
        }
      });
      ws.on('close', () => {
        this.stopPing();
        this.loggedIn = false;
        if (this.loginResend) clearTimeout(this.loginResend);
        this.reconnectCount += 1;
        this.emit('close');
        if (!this.closed) this.scheduleReconnect();
      });
    });
  }

  private login() {
    if (!this.account?.apiKey) return;
    const ts = (Date.now() + (this.clockOffset?.() ?? 0)).toString();
    this.send({
      op: 'login',
      args: [
        {
          apiKey: this.account.apiKey,
          passphrase: this.account.passphrase,
          timestamp: ts,
          sign: bitgetWsLoginSign(this.account.apiSecret, ts),
        },
      ],
    });
  }

  /** injected clock-offset provider (avoids a circular import with rest.ts) */
  clockOffset?: () => number;

  private startPing() {
    this.stopPing();
    this.lastPong = Date.now();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      // pong watchdog: a half-open TCP connection never answers — terminate
      // and reconnect instead of silently streaming into the void
      if (Date.now() - this.lastPong > PING_INTERVAL * 2 + 5_000) {
        console.warn(`[ws:${this.kind}] no pong for ${Math.round((Date.now() - this.lastPong) / 1000)}s — forcing reconnect`);
        this.ws.terminate();
        return;
      }
      this.ws.send('ping');
    }, PING_INTERVAL);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(MAX_RECONNECT_DELAY, this.reconnectDelay * 2);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private send(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /** Idempotent subscribe; connects first if necessary (never revives a closed client). */
  async subscribe(args: WsSubArg[]) {
    const fresh: WsSubArg[] = [];
    for (const arg of args) {
      const key = this.keyOf(arg);
      if (!this.subs.has(key)) {
        this.subs.set(key, arg);
        fresh.push(arg);
      }
    }
    if (!fresh.length) return;
    if (this.closed) return;
    if (!this.connected) {
      try {
        // a rejected connect() never fires 'close', so nothing else would
        // schedule a reconnect — drop the fresh entries so the NEXT subscribe
        // attempt retries the channel instead of assuming it is subscribed
        if (!this.ws) await this.connect();
        if (!this.connected) {
          for (const a of fresh) this.subs.delete(this.keyOf(a));
          return;
        }
      } catch (e) {
        for (const a of fresh) this.subs.delete(this.keyOf(a));
        throw e;
      }
    }
    this.send({ op: 'subscribe', args: fresh });
  }

  async unsubscribe(args: WsSubArg[]) {
    const existing: WsSubArg[] = [];
    for (const arg of args) {
      const key = this.keyOf(arg);
      if (this.subs.delete(key)) existing.push(arg);
    }
    if (existing.length && this.connected) {
      this.send({ op: 'unsubscribe', args: existing });
    }
  }

  close() {
    this.closed = true;
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.loginResend) clearTimeout(this.loginResend);
    this.loggedIn = false;
    this.ws?.close();
    this.ws = null;
    this.emit('closed');
  }
}
