'use client';

import { create } from 'zustand';
import type { MarketType, OrderSide } from '@/core/types';

interface TradeIntent {
  symbol?: string;
  marketType?: MarketType;
  prefill?: { side: OrderSide; price?: number; size?: number; slPct?: number; tpPct?: number };
  set: (patch: Partial<Omit<TradeIntent, 'set'>>) => void;
}

/** Cross-page handoff: markets → trade navigation, LLM advice → order form. */
export const useTradeIntent = create<TradeIntent>((set) => ({
  symbol: undefined,
  marketType: undefined,
  prefill: undefined,
  set: (patch) => set(patch),
}));
