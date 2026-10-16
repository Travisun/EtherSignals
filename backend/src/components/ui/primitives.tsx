'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './button';
import { Inbox } from 'lucide-react';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('rounded-xl border border-gray-200 bg-panel shadow-card', className)}>{children}</div>;
}

export function CardHeader({ title, extra, className }: { title: React.ReactNode; extra?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3', className)}>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {extra && <div className="flex shrink-0 items-center gap-2">{extra}</div>}
    </div>
  );
}

type Tone = 'gray' | 'brand' | 'up' | 'down' | 'amber' | 'purple';
const toneClass: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-600',
  brand: 'bg-brand-50 text-brand-700',
  up: 'bg-up/10 text-up',
  down: 'bg-down/10 text-down',
  amber: 'bg-amber-50 text-amber-600',
  purple: 'bg-purple-50 text-purple-600',
};

export function Badge({ tone = 'gray', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium', toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        checked ? 'bg-brand-600' : 'bg-gray-300',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full min-w-max text-left text-xs', className)}>{children}</table>
    </div>
  );
}
export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-gray-100 text-gray-500">{children}</thead>;
}
export function TR({ className, children, onClick }: { className?: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <tr onClick={onClick} className={cn('border-b border-gray-50 transition-colors last:border-0 hover:bg-gray-50/70', onClick && 'cursor-pointer', className)}>
      {children}
    </tr>
  );
}
export function TH({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <th className={cn('whitespace-nowrap px-3 py-2 font-medium', className)}>{children}</th>;
}
export function TD({ className, children, colSpan }: { className?: string; children?: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn('whitespace-nowrap px-3 py-2 text-gray-700', className)}>{children}</td>;
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-gray-300">{icon ?? <Inbox className="h-8 w-8" />}</div>
      <div className="text-sm font-medium text-gray-600">{title}</div>
      {description && <div className="max-w-sm text-xs leading-relaxed text-gray-400">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-gray-100', className)} />;
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
      <Spinner className="h-4 w-4" />
      {label}
    </div>
  );
}

export function Stat({
  label, value, sub, tone, icon,
}: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: 'up' | 'down' | 'default'; icon?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{label}</span>
        {icon && <span className="text-gray-300">{icon}</span>}
      </div>
      <div className={cn('mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight',
        tone === 'up' && 'text-up', tone === 'down' && 'text-down', (!tone || tone === 'default') && 'text-gray-900')}>
        {value}
      </div>
      {sub && <div className="mt-1 text-2xs text-gray-400">{sub}</div>}
    </Card>
  );
}
