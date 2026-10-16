import type { EventLevel } from '@/core/types';

type Handler = (payload?: unknown) => void;

/**
 * Laravel-inspired event bus: named events with wildcard support.
 *   bus.on('strategy.triggered', fn)
 *   bus.on('order.*', fn)         // wildcard namespace
 *   bus.emit('order.filled', {...})
 */
export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  on(event: string, fn: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  once(event: string, fn: Handler): () => void {
    const wrapped: Handler = (p) => {
      off();
      fn(p);
    };
    const off = this.on(event, wrapped);
    return off;
  }

  off(event: string, fn?: Handler) {
    if (!fn) {
      this.handlers.delete(event);
      return;
    }
    this.handlers.get(event)?.delete(fn);
  }

  emit(event: string, payload?: unknown) {
    for (const [pattern, set] of this.handlers) {
      if (pattern === event) {
        set.forEach((fn) => {
          try {
            fn(payload);
          } catch (e) {
            console.error(`[bus] handler error for ${event}:`, e);
          }
        });
      } else if (pattern.endsWith('.*') && event.startsWith(pattern.slice(0, -1))) {
        set.forEach((fn) => {
          try {
            fn({ event, payload });
          } catch (e) {
            console.error(`[bus] wildcard handler error for ${event}:`, e);
          }
        });
      }
    }
  }
}

export const bus = new EventBus();

// Well-known event names
export const Events = {
  STRATEGY_TRIGGERED: 'strategy.triggered',
  STRATEGY_STARTED: 'strategy.started',
  STRATEGY_STOPPED: 'strategy.stopped',
  ORDER_PLACED: 'order.placed',
  ORDER_FILLED: 'order.filled',
  ORDER_CANCELED: 'order.canceled',
  POSITION_CLOSED: 'position.closed',
  ACCOUNT_UPDATED: 'account.updated',
  SIGNAL_FIRED: 'signal.fired',
  NOTIFICATION: 'notification.created',
  BACKTEST_DONE: 'backtest.done',
  ENGINE_ERROR: 'engine.error',
  CANDLE_CLOSED: 'market.candle.closed',
  TICKER: 'market.ticker',
} as const;

export type EventName = (typeof Events)[keyof typeof Events];
