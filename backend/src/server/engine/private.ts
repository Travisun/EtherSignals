import { BitgetWs, type WsSubArg } from '@/server/bitget/ws';
import { settingsRepo, eventsRepo } from '@/server/store/repos';
import { bus, Events } from '@/server/events/bus';
import { notify } from '@/server/events/notifier';
import { getAccountSummary, getPositions } from './accountService';
import { pendingOrders } from '@/server/services/ordersService';
import { toNum } from '@/lib/utils';
import type { MarketType, OrderRecord, PositionRecord } from '@/core/types';

function getIo(): import('socket.io').Server | undefined {
  return (globalThis as { __gtIo?: import('socket.io').Server }).__gtIo;
}

/**
 * Private stream: authenticated Bitget WS for order / position / account
 * pushes. Relays fills as notifications and pushes fresh snapshots to the
 * UI over the socket (throttled).
 */
export class PrivateStream {
  private ws: BitgetWs | null = null;
  private accountKey = '';
  private lastPush = 0;

  state: 'connected' | 'disconnected' | 'no-account' = 'no-account';

  async start() {
    const account = settingsRepo.get().accounts.find((a) => a.active);
    if (!account?.apiKey) {
      this.state = 'no-account';
      return;
    }
    const key = `${account.id}:${account.demoMode}`;
    if (this.ws && this.accountKey === key && this.ws.connected) return;
    this.ws?.close();
    this.accountKey = key;
    this.ws = new BitgetWs('private', account);
    // keep WS login timestamps in sync with the exchange clock (rest.ts)
    try {
      const { exchangeMetrics } = await import('@/server/bitget/rest');
      this.ws.clockOffset = () => exchangeMetrics.clockOffsetMs;
    } catch {
      // clock sync unavailable — local time still works within tolerance
    }
    this.ws.on('open', () => {
      this.state = 'connected';
    });
    // subscriptions are sent exactly once per connection, after login confirms;
    // a lost login frame is re-sent by the ws layer, which re-emits this event
    this.ws.on('login-success', () => {
      this.subscribedConn = false;
      this.subscribeAll();
    });
    this.ws.on('close', () => {
      this.state = 'disconnected';
      this.subscribedConn = false;
    });
    this.ws.on('ws-error', (msg) => {
      eventsRepo.append({
        id: `ev_${Date.now()}`,
        ts: Date.now(),
        level: 'warning',
        code: 'engine.error',
        params: { reason: `private ws: ${msg.msg ?? 'error'}` },
        channel: 'system',
      });
    });
    this.ws.on('data', (arg: WsSubArg, data: unknown[]) => {
      this.dispatch(arg, data);
    });
    try {
      await this.ws.connect();
    } catch (e) {
      this.state = 'disconnected';
      console.error('[private] connect failed:', e);
    }
  }

  private subscribedConn = false;

  private subscribeAll() {
    if (this.subscribedConn) return;
    this.subscribedConn = true;
    this.ws?.subscribe([
      { instType: 'USDT-FUTURES', channel: 'orders', instId: 'default' },
      { instType: 'USDT-FUTURES', channel: 'positions', instId: 'default' },
      { instType: 'USDT-FUTURES', channel: 'account', instId: 'default' },
      { instType: 'SPOT', channel: 'orders', instId: 'default' },
      { instType: 'SPOT', channel: 'account', instId: 'default' },
    ]).catch(() => undefined);
  }

  private dispatch(arg: WsSubArg, data: unknown[]) {
    const marketType: MarketType = arg.instType === 'SPOT' || arg.instType === 'SP' ? 'spot' : 'futures';
    switch (arg.channel) {
      case 'orders':
        for (const row of data as Record<string, unknown>[]) {
          const status = String(row.status ?? '');
          const symbol = String(row.symbol ?? '');
          const side = String(row.side ?? '');
          const size = toNum(row.fillQuantity ?? row.size);
          const price = row.fillPrice != null ? toNum(row.fillPrice) : 'market';
          if (status === 'filled') {
            notify('order.filled', { symbol, side, size, price }, { level: 'success', channel: 'trade' });
            bus.emit(Events.ORDER_FILLED, { marketType, row });
          } else if (status === 'partially_filled') {
            // partial fills must be visible — silent IOC partials distort ledgers
            notify('order.filled', {
              symbol, side,
              size: toNum(row.fillQuantity) || size,
              price: row.fillPrice != null ? toNum(row.fillPrice) : 'market',
            }, { level: 'info', channel: 'trade' });
            bus.emit(Events.ORDER_FILLED, { marketType, row, partial: true });
          } else if (status === 'canceled' || status === 'fail_trigger' || status === 'fail_execute') {
            bus.emit(Events.ORDER_CANCELED, { marketType, row });
          }
        }
        this.throttledPush('orders:update', 300, async () => {
          const orders: OrderRecord[] = await pendingOrders(marketType).catch(() => []);
          return { marketType, orders };
        });
        break;
      case 'positions':
        this.throttledPush('positions:update', 2_000, async () => {
          const positions: PositionRecord[] = await getPositions().catch(() => []);
          return { marketType: 'futures', positions };
        });
        break;
      case 'account':
        this.throttledPush('account:update', 1_000, async () => getAccountSummary());
        break;
    }
  }

  /** Coalesce bursts of pushes (max one snapshot per channel window). */
  private pushTimers = new Map<string, boolean>();

  private throttledPush(channel: string, delayMs: number, load: () => Promise<unknown>) {
    if (this.pushTimers.get(channel)) return;
    this.pushTimers.set(channel, true);
    setTimeout(async () => {
      this.pushTimers.set(channel, false);
      try {
        const payload = await load();
        getIo()?.emit(channel as never, payload);
      } catch {
        // transient
      }
    }, delayMs);
  }

  stop() {
    this.ws?.close();
    this.ws = null;
    this.state = 'no-account';
  }
}
