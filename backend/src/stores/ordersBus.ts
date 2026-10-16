'use client';

import { create } from 'zustand';

interface OrdersBusState {
  /** bumped whenever the server signals fresh order data (private WS push) */
  revision: number;
  bump: () => void;
}

/** Cross-cutting nudge channel: lets useOrders reload on server pushes
 *  without wiring a full order store through every consumer. */
export const useOrdersBus = create<OrdersBusState>((set) => ({
  revision: 0,
  bump: () => set((s) => ({ revision: s.revision + 1 })),
}));
