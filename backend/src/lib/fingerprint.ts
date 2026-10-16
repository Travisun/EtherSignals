'use client';

/**
 * Stable device fingerprint (djb2 over hardware/browser traits).
 * Stored once and reused so sessions bind to the physical browser.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  let id = localStorage.getItem('gt.device');
  if (id) return id;
  const traits = [
    navigator.userAgent,
    navigator.language,
    (navigator.languages ?? []).join(','),
    `${screen.width}x${screen.height}x${window.devicePixelRatio}`,
    String(navigator.hardwareConcurrency ?? 0),
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    String(new Date().getTimezoneOffset()),
  ].join('|');
  let h = 5381;
  for (let i = 0; i < traits.length; i++) {
    h = ((h << 5) + h + traits.charCodeAt(i)) | 0;
  }
  id = 'dev_' + (h >>> 0).toString(36) + traits.length.toString(36);
  try {
    localStorage.setItem('gt.device', id);
  } catch {
    // storage disabled
  }
  return id;
}
