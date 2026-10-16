import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** CSPRNG-based unique id — safe for identifiers that must not be predictable. */
export function uid(prefix = ''): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  const rand = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('');
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function toNum(v: unknown, def = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : def;
}

/** Round a number down to given decimals (exchange-safe sizing). */
export function floorTo(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.floor(v * f + Number.EPSILON) / f;
}

/** Format a number to fixed decimals without trailing zeros. */
export function trimDecimals(v: number, decimals: number): string {
  return v.toFixed(decimals).replace(/\.?0+$/, '') || '0';
}

export function groupBy<T, K extends string | number>(arr: T[], key: (item: T) => K): Record<K, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {} as Record<K, T[]>);
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
