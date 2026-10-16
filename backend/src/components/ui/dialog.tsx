'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { registerEsc } from '@/lib/escStack';
import { X } from 'lucide-react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClass = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const unregister = registerEsc(onClose);
    document.body.style.overflow = 'hidden';
    return () => {
      unregister();
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cn(
          'relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop sm:rounded-2xl',
          sizeClass[size],
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900">{title}</h3>
              {description && <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{description}</p>}
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: 'left' | 'right' | 'bottom';
  children: React.ReactNode;
  width?: string;
}

/** Animated slide-in drawer (left / right / bottom) with backdrop fade. */
export function Drawer({ open, onClose, side = 'left', children, width = 'w-72' }: DrawerProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), 240);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return registerEsc(onClose);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-[95]">
      <div
        className={cn('absolute inset-0 bg-gray-900/40 backdrop-blur-[2px] transition-opacity duration-200', visible ? 'opacity-100' : 'opacity-0')}
        onClick={onClose}
      />
      <div
        className={cn(
          'absolute flex flex-col bg-white shadow-pop transition-transform duration-200 ease-out',
          side === 'left' && cn('inset-y-0 left-0', width, visible ? 'translate-x-0' : '-translate-x-full'),
          side === 'right' && cn('inset-y-0 right-0', width, visible ? 'translate-x-0' : 'translate-x-full'),
          side === 'bottom' && cn('inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl', visible ? 'translate-y-0' : 'translate-y-full'),
        )}
        style={{ paddingBottom: side === 'bottom' ? 'env(safe-area-inset-bottom)' : undefined }}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}
