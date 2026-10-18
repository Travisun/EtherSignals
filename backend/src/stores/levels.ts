'use client';

import { create } from 'zustand';
import { getSocket } from '@/hooks/useAppSocket';
import type { MarketType, NhnlSnapshot } from '@/core/types';

interface LevelsStore {
  snapshot: NhnlSnapshot | null;
  setSnapshot: (s: NhnlSnapshot) => void;
  clear: () => void;
}

/** Multi-TF new-high/new-low ladder pushed by the server (`levels:update`). */
export const useLevels = create<LevelsStore>((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  clear: () => set({ snapshot: null }),
}));

let wanted: { marketType: MarketType; symbol: string; donN?: number } | null = null;
let attached = false;

function attach() {
  if (attached) return;
  const socket = getSocket();
  if (!socket) {
    // the app socket is created by useAppSocket at the root layout — retry
    setTimeout(attach, 400);
    return;
  }
  attached = true;
  socket.on('connect', () => {
    if (wanted) socket.emit('levels:sub', wanted);
  });
  socket.on('levels:update', (snap: NhnlSnapshot) => {
    useLevels.getState().setSnapshot(snap);
  });
  if (socket.connected && wanted) socket.emit('levels:sub', wanted);
}

/** Join the ladder room for one symbol + initial REST fill (idempotent). */
export function subscribeLevels(marketType: MarketType, symbol: string, donN?: number) {
  wanted = { marketType, symbol, donN };
  useLevels.getState().clear();
  attach();
  const socket = getSocket();
  if (socket?.connected) socket.emit('levels:sub', { marketType, symbol, donN });
  fetch(`/api/market/levels?marketType=${marketType}&symbol=${symbol}${donN ? `&donN=${donN}` : ''}`)
    .then((r) => r.json())
    .then((j) => {
      if (j?.ok && wanted?.symbol === symbol && wanted?.marketType === marketType) {
        useLevels.getState().setSnapshot(j.data.levels as NhnlSnapshot);
      }
    })
    .catch(() => undefined);
}

export function unsubscribeLevels(marketType: MarketType, symbol: string) {
  const socket = getSocket();
  if (socket?.connected) socket.emit('levels:unsub', { marketType, symbol });
  if (wanted?.symbol === symbol && wanted?.marketType === marketType) wanted = null;
}
