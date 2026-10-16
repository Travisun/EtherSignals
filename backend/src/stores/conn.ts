'use client';

import { create } from 'zustand';

export type ConnState = 'connected' | 'connecting' | 'disconnected';

interface ConnStateStore {
  appSocket: ConnState;
  marketWs: ConnState;
  setAppSocket: (s: ConnState) => void;
  setMarketWs: (s: ConnState) => void;
}

export const useConn = create<ConnStateStore>((set) => ({
  appSocket: 'connecting',
  marketWs: 'connecting',
  setAppSocket: (appSocket) => set({ appSocket }),
  setMarketWs: (marketWs) => set({ marketWs }),
}));
