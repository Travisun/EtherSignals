'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface TabsProps {
  tabs: { key: string; label: React.ReactNode; badge?: React.ReactNode }[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export function Tabs({ tabs, active, onChange, className, size = 'md' }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-1 overflow-x-auto border-b border-gray-200', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2.5 text-sm',
            tab.key === active
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-gray-500 hover:text-gray-800',
          )}
        >
          {tab.label}
          {tab.badge}
        </button>
      ))}
    </div>
  );
}

export interface SegmentedProps {
  options: { value: string; label: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
  size?: 'xs' | 'sm';
  block?: boolean;
}

export function Segmented({ options, value, onChange, className, size = 'sm', block }: SegmentedProps) {
  return (
    <div className={cn('inline-flex rounded-lg bg-gray-100 p-0.5', block && 'flex w-full', className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex-1 whitespace-nowrap rounded-[7px] font-medium transition-all',
            size === 'xs' ? 'px-2 py-1 text-2xs' : 'px-3 py-1.5 text-xs',
            opt.value === value
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-800',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
