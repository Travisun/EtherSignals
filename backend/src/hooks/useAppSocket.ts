'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { usePrefs } from '@/stores/prefs';
import { useAccountStore } from '@/stores/account';
import { useOrdersBus } from '@/stores/ordersBus';
import { useConn } from '@/stores/conn';
import { useSignals } from '@/stores/signals';
import { notifText } from '@/i18n/provider';
import { toastBus } from '@/lib/toastBus';
import type { AccountSummary, PositionRecord, SignalSnapshot, SocketNotification } from '@/core/types';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

/**
 * Server push channel (Socket.IO): notifications, account snapshots and
 * engine status. Localizes server notification codes via the i18n dict and
 * fans out toasts + desktop notifications.
 */
export function useAppSocket(t: (k: string, p?: Record<string, string | number>) => string) {
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (socket) {
      // already connected from a previous mount (fast-refresh safe)
      useConn.getState().setAppSocket('connected');
      return;
    }
    useConn.getState().setAppSocket('connecting');
    socket = io({ path: '/ws', transports: ['websocket', 'polling'] });

    socket.on('connect', () => useConn.getState().setAppSocket('connected'));
    socket.on('disconnect', () => useConn.getState().setAppSocket('disconnected'));
    socket.on('connect_error', () => useConn.getState().setAppSocket('disconnected'));

    socket.on('notification', (n: SocketNotification) => {
      const prefs = usePrefs.getState();
      prefs.pushNotification({ ...n });
      const text = notifText(tRef.current, n.code, n.params);
      toastBus.emit({ level: n.level, title: text });
      if (document.visibilityState === 'hidden') showDesktop(text);
    });

    socket.on('account:update', (summary: AccountSummary) => {
      useAccountStore.getState().setSummary(summary);
    });

    // private-stream pushes: fresh positions land directly in the store,
    // order changes nudge every useOrders consumer to reload
    socket.on('positions:update', (p: { marketType: string; positions: PositionRecord[] }) => {
      useAccountStore.getState().setPositions(p.positions);
    });
    socket.on('orders:update', () => {
      useOrdersBus.getState().bump();
    });

    socket.on('engine:status', (status) => {
      usePrefs.getState().setEngineStatus(status);
    });

    // multi-timeframe prediction signals (server evaluates on every bar close)
    socket.on('signals:update', (snap: SignalSnapshot) => {
      useSignals.getState().setSnapshot(snap);
    });

    // initial snapshots
    fetch('/api/engine').then((r) => r.json()).then((j) => {
      if (j?.ok) usePrefs.getState().setEngineStatus(j.data.status);
    }).catch(() => undefined);
    fetch('/api/signals').then((r) => r.json()).then((j) => {
      if (j?.ok) useSignals.getState().setSnapshot(j.data.signals);
    }).catch(() => undefined);
    fetch('/api/account/summary').then((r) => r.json()).then((j) => {
      if (j?.ok) useAccountStore.getState().setSummary(j.data.summary);
    }).catch(() => undefined);

    return () => {
      // keep the socket alive across route changes
    };
  }, [tRef]);
}

export function showDesktop(text: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification('DownTrade', { body: text });
  } catch {
    // Safari without SW may throw; ignore
  }
}
