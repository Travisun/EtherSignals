'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import type { EventLevel } from '@/core/types';

export interface ToastItem {
  id: string;
  level: EventLevel;
  title: string;
  description?: string;
}

interface ToastApi {
  toast: (t: Omit<ToastItem, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<EventLevel, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-up" />,
  error: <XCircle className="h-4 w-4 text-down" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  info: <Info className="h-4 w-4 text-brand-500" />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((arr) => arr.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = Math.random().toString(36).slice(2);
      setItems((arr) => [...arr.slice(-4), { ...t, id }]);
      setTimeout(() => dismiss(id), t.level === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  const api: ToastApi = {
    toast,
    success: (title, description) => toast({ level: 'success', title, description }),
    error: (title, description) => toast({ level: 'error', title, description }),
    info: (title, description) => toast({ level: 'info', title, description }),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-3 top-14 z-[100] flex w-[calc(100%-1.5rem)] max-w-sm flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border border-gray-200 bg-white px-3.5 py-3 shadow-pop animate-slide-in',
            )}
          >
            <span className="mt-0.5 shrink-0">{ICONS[item.level]}</span>
            <div className="min-w-0 flex-1">
              <div className="break-words text-sm font-medium leading-snug text-gray-900">{item.title}</div>
              {item.description && (
                <div className="mt-0.5 break-words text-xs leading-relaxed text-gray-500">{item.description}</div>
              )}
            </div>
            <button
              onClick={() => dismiss(item.id)}
              className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-600"
              aria-label={t('common.dismiss')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
