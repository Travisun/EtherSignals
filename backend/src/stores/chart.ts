'use client';

import { create } from 'zustand';

export type SubIndicator = 'none' | 'macd' | 'rsi' | 'kdj';
export type ChartSource = 'native' | 'tv';
export type DrawTool = 'cursor' | 'hline' | 'trend' | 'ray' | 'rect' | 'fib';

interface ChartPrefs {
  ma: boolean;
  ema: boolean;
  boll: boolean;
  volume: boolean;
  sub: SubIndicator;
  source: ChartSource;
  tool: DrawTool;
  set: (patch: Partial<Omit<ChartPrefs, 'set'>>) => void;
}

function initial(): Omit<ChartPrefs, 'set'> {
  if (typeof window === 'undefined') {
    return { ma: true, ema: false, boll: false, volume: true, sub: 'macd', source: 'native', tool: 'cursor' };
  }
  try {
    const raw = JSON.parse(localStorage.getItem('gt.chart') ?? '{}');
    return {
      ma: raw.ma ?? true,
      ema: raw.ema ?? false,
      boll: raw.boll ?? false,
      volume: raw.volume ?? true,
      sub: raw.sub ?? 'macd',
      source: raw.source ?? 'native',
      tool: raw.tool ?? 'cursor',
    };
  } catch {
    return { ma: true, ema: false, boll: false, volume: true, sub: 'macd', source: 'native', tool: 'cursor' };
  }
}

export const useChartPrefs = create<ChartPrefs>((set, get) => ({
  ...initial(),
  set: (patch) => {
    set(patch);
    // `tool` is transient UI state — persisting it would restore a drawing
    // tool after reload and block chart interaction behind the SVG overlay
    const { set: _s, tool: _tool, ...rest } = get();
    localStorage.setItem('gt.chart', JSON.stringify(rest));
  },
}));
