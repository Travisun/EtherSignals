'use client';

import { create } from 'zustand';
import { useChartPrefs } from '@/stores/chart';
import type { AppEvent, EngineStatus, EventLevel } from '@/core/types';

export type UpDownPref = 'auto' | 'red-up' | 'green-up';

interface PrefsState {
  locale: 'zh-CN' | 'en';
  upDown: UpDownPref;
  favorites: string[];
  sidebarCollapsed: boolean;
  engineStatus: EngineStatus | null;
  notifications: AppEvent[];
  unread: number;
  setLocale: (l: 'zh-CN' | 'en') => void;
  setUpDown: (u: UpDownPref) => void;
  toggleFavorite: (symbol: string) => void;
  setSidebar: (c: boolean) => void;
  setEngineStatus: (s: EngineStatus) => void;
  pushNotification: (n: AppEvent) => void;
  clearUnread: () => void;
}

function loadFavorites(): string[] {
  if (typeof window === 'undefined') return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  try {
    return JSON.parse(localStorage.getItem('gt.favorites') ?? '[]');
  } catch {
    return [];
  }
}

export const usePrefs = create<PrefsState>((set, get) => ({
  locale: 'zh-CN',
  upDown: 'auto',
  favorites: [],
  sidebarCollapsed: false,
  engineStatus: null,
  notifications: [],
  unread: 0,
  setLocale: (locale) => {
    set({ locale });
    // 'auto' color mode follows the locale — re-apply the CSS variables
    applyUpDownVars(get().upDown, locale);
  },
  setUpDown: (upDown) => {
    set({ upDown });
    applyUpDownVars(upDown, get().locale);
    try {
      localStorage.setItem('gt.upDown', upDown);
    } catch {
      // storage disabled
    }
  },
  toggleFavorite: (symbol) => {
    const favorites = get().favorites.includes(symbol)
      ? get().favorites.filter((s) => s !== symbol)
      : [...get().favorites, symbol];
    try {
      localStorage.setItem('gt.favorites', JSON.stringify(favorites));
    } catch {
      // storage disabled
    }
    set({ favorites });
  },
  setSidebar: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setEngineStatus: (engineStatus) => set({ engineStatus }),
  pushNotification: (n) => {
    set((s) => ({
      notifications: [n, ...s.notifications].slice(0, 100),
      unread: s.unread + 1,
    }));
  },
  clearUnread: () => set({ unread: 0 }),
}));

// hydrate favorites & color pref after mount (avoids SSR hydration mismatch)
export function hydratePrefs() {
  if (typeof window === 'undefined') return;
  try {
    usePrefs.setState({ favorites: loadFavorites() });
    const ud = localStorage.getItem('gt.upDown') as UpDownPref | null;
    if (ud === 'auto' || ud === 'red-up' || ud === 'green-up') usePrefs.setState({ upDown: ud });
    applyUpDownVars(ud ?? 'auto', usePrefs.getState().locale);
    // chart prefs (indicator toggles etc.) — `tool` is never persisted
    const rawChart = localStorage.getItem('gt.chart');
    if (rawChart) {
      const { set: _s, tool: _t, ...chartRest } = JSON.parse(rawChart) as Record<string, unknown>;
      void _s;
      void _t;
      useChartPrefs.setState(chartRest);
    }
  } catch {
    // private mode / storage disabled
  }
}

/** Write the resolved up/down RGB triplets to :root — every tailwind
 *  `up`/`down` utility (text/bg/border, opacity variants, flash animations)
 *  follows the user's red-up / green-up preference site-wide. */
export function applyUpDownVars(pref: UpDownPref, locale: string) {
  if (typeof document === 'undefined') return;
  const redUp = pref === 'red-up' || (pref === 'auto' && locale.startsWith('zh'));
  const root = document.documentElement.style;
  root.setProperty('--up-rgb', redUp ? '220 38 38' : '22 163 74');
  root.setProperty('--down-rgb', redUp ? '22 163 74' : '220 38 38');
}

/** Resolve the current up/down color pair. */
export function upDownColors(
  pref: UpDownPref,
  locale: string,
): { up: string; down: string; upClass: string; downClass: string } {
  const redUp = pref === 'red-up' || (pref === 'auto' && locale.startsWith('zh'));
  return redUp
    ? { up: '#dc2626', down: '#16a34a', upClass: 'text-down', downClass: 'text-up' }
    : { up: '#16a34a', down: '#dc2626', upClass: 'text-up', downClass: 'text-down' };
}

export function levelColor(level: EventLevel): string {
  switch (level) {
    case 'success': return 'bg-up/10 text-up';
    case 'warning': return 'bg-amber-500/10 text-amber-600';
    case 'error': return 'bg-down/10 text-down';
    default: return 'bg-brand-500/10 text-brand-600';
  }
}
