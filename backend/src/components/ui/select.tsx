'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { registerEsc } from '@/lib/escStack';
import { useI18n } from '@/i18n/provider';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  searchable?: boolean;
}

/** Lightweight single-select dropdown with optional search. */
export function Select({ value, onChange, options, placeholder, className, disabled, size = 'md', searchable }: SelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const unregister = registerEsc(() => setOpen(false));
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      unregister();
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()) || o.value.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white text-left transition-colors',
          'hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
          'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400',
          size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm',
          open && 'border-brand-500 ring-2 ring-brand-500/20',
        )}
      >
        <span className={cn('truncate', !selected && 'text-gray-400')}>{selected?.label ?? placeholder ?? '—'}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full min-w-[8rem] overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-pop">
          {searchable && (
            <div className="sticky top-0 border-b border-gray-100 bg-white p-1.5">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-7 w-full rounded-md border border-gray-200 px-2 text-xs focus:border-brand-500 focus:outline-none"
                placeholder={t('common.search')}
              />
            </div>
          )}
          {filtered.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">{t('common.noResults')}</div>}
          {filtered.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
                setQuery('');
              }}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-gray-50',
                opt.value === value ? 'font-medium text-brand-600' : 'text-gray-700',
              )}
            >
              <span className="truncate">{opt.label}</span>
              {opt.value === value && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
