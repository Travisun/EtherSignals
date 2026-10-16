'use client';

import { create } from 'zustand';
import type { SignalSnapshot } from '@/core/types';

interface SignalsStore {
  snapshot: SignalSnapshot | null;
  setSnapshot: (s: SignalSnapshot) => void;
}

/** Live multi-timeframe prediction signals pushed by the server (`signals:update`). */
export const useSignals = create<SignalsStore>((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
}));
