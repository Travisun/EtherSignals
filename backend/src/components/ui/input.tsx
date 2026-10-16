'use client';

import React, { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  suffix?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, suffix, id, ...props },
  ref,
) {
  const inputId = id ?? props.name ?? label?.replace(/\s+/g, '_');
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-gray-600">
          {label}
          {props.required && <span className="ml-0.5 text-down">*</span>}
        </label>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'h-9 w-full rounded-lg border bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400',
            'border-gray-300 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
            'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400',
            'read-only:bg-gray-50',
            suffix && 'pr-9',
            error && 'border-down focus:border-down focus:ring-down/20',
            className,
          )}
          {...props}
        />
        {suffix && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs text-gray-400">{suffix}</div>
        )}
      </div>
      {(hint || error) && (
        <p className={cn('mt-1 text-2xs leading-relaxed', error ? 'text-down' : 'text-gray-400')}>{error ?? hint}</p>
      )}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }>(
  function Textarea({ className, label, id, ...props }, ref) {
    const inputId = id ?? label?.replace(/\s+/g, '_');
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400',
            'transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
            className,
          )}
          {...props}
        />
      </div>
    );
  },
);

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="w-full">
      <div className="mb-1.5 text-xs font-medium text-gray-600">{label}</div>
      {children}
      {hint && <p className="mt-1 text-2xs leading-relaxed text-gray-400">{hint}</p>}
    </div>
  );
}
