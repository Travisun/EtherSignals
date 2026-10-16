"use client";

/** Browser-side notification helpers (local SW notifications + push signup). */

export function notificationsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator
  );
}

/** iOS Safari only allows Web Push inside an installed PWA. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export async function ensureSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    console.error("[sw] registration failed", err);
    return null;
  }
}

export async function currentRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return (
      (await navigator.serviceWorker.getRegistration("/")) ??
      (await navigator.serviceWorker.ready.catch(() => null))
    );
  } catch {
    return null;
  }
}

export async function showLocalNotification(title: string, body: string) {
  const registration = await currentRegistration();
  if (!registration) return;
  // `renotify` is a valid spec extension but missing from TS's DOM lib.
  const options = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "ethersignals-new-signal",
    renotify: true,
    data: { url: "/" },
  } as NotificationOptions;
  await registration.showNotification(title, options);
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function readVapidKey(): string {
  return document.documentElement.dataset.vapidKey ?? "";
}
