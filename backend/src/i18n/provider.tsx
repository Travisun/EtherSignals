'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { zh, type Dict } from '@/i18n/dicts/zh-CN';
import { en } from '@/i18n/dicts/en';

export type Locale = 'zh-CN' | 'en';
const DICTS: Record<Locale, Dict> = { 'zh-CN': zh, en };

function lookup(dict: unknown, path: string): string | undefined {
  let cur: unknown = dict;
  for (const part of path.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

export interface I18nApi {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nApi | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('zh-CN');

  useEffect(() => {
    const stored = localStorage.getItem('gt.locale') as Locale | null;
    if (stored === 'zh-CN' || stored === 'en') {
      setLocaleState(stored);
    } else if (!navigator.language.startsWith('zh')) {
      setLocaleState('en');
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem('gt.locale', l);
    } catch {
      // storage disabled
    }
    document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      let text = lookup(DICTS[locale], key) ?? lookup(DICTS['zh-CN'], key) ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replaceAll(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [locale],
  );

  const api = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <I18nContext.Provider value={api}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nApi {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

/** Server notification code → localized text (dict `notif.*`). */
export function notifText(t: (k: string, p?: Record<string, string | number>) => string, code: string, params?: Record<string, string | number>): string {
  return t(`notif.${code}`, params);
}
