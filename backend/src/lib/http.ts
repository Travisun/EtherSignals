'use client';

import { getDeviceId } from '@/lib/fingerprint';

/**
 * Global fetch hardening for same-origin /api calls:
 * - attaches device fingerprint + cached PIN
 * - raises events on 401 (auth) / 428 (pin) so the UI can react globally
 * - 428 PIN_REQUIRED → waits for the PinGate dialog, then transparently
 *   REPLAYS the original request with the fresh x-gt-pin header, so the
 *   caller's await resolves with the real response (no re-clicking).
 */
let cachedPin = '';

export function setCachedPin(pin: string) {
  cachedPin = pin;
}
export function clearCachedPin() {
  cachedPin = '';
}

/** resolvers waiting for the PIN gate to complete */
let pinWaiters: (() => void)[] = [];

/** Called by the PinGate after a successful PIN entry — releases the held requests. */
export function resolvePendingPin(): void {
  const waiters = pinWaiters;
  pinWaiters = [];
  for (const w of waiters) w();
}

let installed = false;
let originalFetch: typeof window.fetch;

export function installHttpHardening(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/')) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('x-gt-device', getDeviceId());
      if (cachedPin && !headers.has('x-gt-pin')) headers.set('x-gt-pin', cachedPin);
      const res = await originalFetch(input, { ...init, headers, credentials: 'include' });
      if (res.status === 401) {
        window.dispatchEvent(new CustomEvent('gt:auth-required'));
        return res;
      }
      if (res.status === 428) {
        let detail: unknown;
        try {
          detail = await res.clone().json();
        } catch {
          detail = undefined;
        }
        const code = (detail as { code?: string })?.code;
        // a locked PIN can't be satisfied by re-entry — surface it and bail
        if (code === 'PIN_LOCKED' || code === 'PIN_INVALID') {
          window.dispatchEvent(new CustomEvent('gt:pin-required', { detail }));
          return res;
        }
        // hold the caller until the PIN gate resolves, then replay once
        window.dispatchEvent(new CustomEvent('gt:pin-required', { detail }));
        const released = new Promise<void>((resolve) => pinWaiters.push(resolve));
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, 120_000));
        await Promise.race([released, timeout]);
        if (cachedPin) {
          headers.set('x-gt-pin', cachedPin);
          return originalFetch(input, { ...init, headers, credentials: 'include' });
        }
        return res;
      }
      return res;
    }
    return originalFetch(input, init);
  };
}
