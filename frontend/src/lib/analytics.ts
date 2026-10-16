/**
 * Umami analytics glue (client-side).
 *
 * The script itself is only injected after the visitor accepts optional
 * analytics in the consent banner (see AnalyticsLoader). Umami is
 * self-hosted and cookieless: it sets no identifiers and builds no
 * cross-site profile. trackEvent() is a safe no-op whenever the script is
 * absent (consent declined, ad-blocker, SSR).
 */

export const UMAMI = {
  scriptUrl:
    process.env.NEXT_PUBLIC_UMAMI_URL || "https://stats.cuishushu.com/script.js",
  websiteId:
    process.env.NEXT_PUBLIC_UMAMI_SITE_ID ||
    "eb3e811b-f3c8-4af3-802d-8d8991f2238d",
} as const;

export type TrackProps = Record<string, string | number | boolean | null>;

/** Fire-and-forget custom event. Never throws, never logs PII. */
export function trackEvent(name: string, data?: TrackProps): void {
  if (typeof window === "undefined") return;
  const umami = (window as unknown as {
    umami?: { track?: (n: string, d?: TrackProps) => void };
  }).umami;
  if (typeof umami?.track !== "function") return;
  try {
    umami.track(name, data);
  } catch {
    /* analytics must never break the UI */
  }
}
