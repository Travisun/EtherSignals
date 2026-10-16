'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrdersBus } from '@/stores/ordersBus';
import type { MarketType, OrderRecord } from '@/core/types';

export interface OrdersData {
  pending: OrderRecord[];
  history: OrderRecord[];
  fills: OrderRecord[];
  loading: boolean;
  reload: () => void;
}

/** Polling fetcher for the order bookkeeping endpoints. */
export function useOrders(marketType: MarketType, opts: { pollMs?: number; symbol?: string } = {}): OrdersData {
  const [pending, setPending] = useState<OrderRecord[]>([]);
  const [history, setHistory] = useState<OrderRecord[]>([]);
  const [fills, setFills] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ marketType, ...(opts.symbol ? { symbol: opts.symbol } : {}) });
    fetch(`/api/orders/all?${qs}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok) return;
        setPending(j.data.pending ?? []);
        setHistory(j.data.history ?? []);
        setFills(j.data.fills ?? []);
      })
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [marketType, opts.symbol, tick]);

  useEffect(() => {
    if (!opts.pollMs) return;
    timer.current = setInterval(() => {
      // background tabs don't need fresh data — pause to save rate budget
      if (typeof document !== 'undefined' && document.hidden) return;
      reload();
    }, opts.pollMs);
    return () => clearInterval(timer.current);
  }, [opts.pollMs, reload]);

  // private-WS push nudge: reload when the server signals fresh order data
  const firstRevision = useRef(useOrdersBus.getState().revision);
  useEffect(() => {
    return useOrdersBus.subscribe((s) => {
      if (s.revision !== firstRevision.current) {
        firstRevision.current = s.revision;
        reload();
      }
    });
  }, [reload]);

  return { pending, history, fills, loading, reload };
}

export async function cancelOrderApi(orderId: string, symbol: string, marketType: MarketType, accountId?: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/trade/orders', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, symbol, marketType, accountId }),
  });
  const j = await res.json();
  return j?.data ?? { ok: false, error: j?.error };
}

export async function closePositionApi(symbol: string, side: 'long' | 'short', size: number, paper?: boolean): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/trade/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      marketType: 'futures',
      side: side === 'long' ? 'sell' : 'buy',
      orderType: 'market',
      size,
      tradeSide: 'close',
      paper: paper || undefined,
    }),
  });
  const j = await res.json();
  return j?.data ?? { ok: false, error: j?.error };
}

/** Batch cancel: symbol omitted = every open order on the account. */
export async function cancelAllApi(symbol?: string, paper?: boolean): Promise<{ ok: boolean; canceled?: number; error?: string }> {
  const res = await fetch('/api/trade/cancel-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, paper: paper || undefined }),
  });
  const j = await res.json();
  return { ok: Boolean(j?.ok), canceled: j?.data?.canceled, error: j?.error };
}
