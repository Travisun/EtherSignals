'use client';

import { create } from 'zustand';
import type { AccountSummary, PositionRecord } from '@/core/types';

interface AccountState {
  summary: AccountSummary | null;
  positions: PositionRecord[];
  loading: boolean;
  setSummary: (s: AccountSummary) => void;
  setPositions: (p: PositionRecord[]) => void;
  refresh: () => Promise<void>;
}

export const useAccountStore = create<AccountState>((set) => ({
  summary: null,
  positions: [],
  loading: false,
  setSummary: (summary) => set({ summary }),
  setPositions: (positions) => set({ positions }),
  refresh: async () => {
    set({ loading: true });
    try {
      const res = await fetch('/api/account/summary');
      const j = await res.json();
      if (j?.ok) {
        set({ summary: j.data.summary, positions: j.data.positions });
      }
    } catch {
      // offline / server restarting — keep the last snapshot
    } finally {
      set({ loading: false });
    }
  },
}));
