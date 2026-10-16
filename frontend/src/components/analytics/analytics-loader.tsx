"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { CONSENT_EVENT, consentValue } from "@/components/consent/consent-banner";
import { UMAMI } from "@/lib/analytics";

/**
 * Injects the self-hosted Umami script only after the visitor accepts
 * optional analytics ("Accept all"). Reacts live to the consent decision,
 * so accepting loads tracking immediately without a page reload; declining
 * or blocking storage never loads it at all.
 */
export function AnalyticsLoader() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const sync = () => setEnabled(consentValue() === "all");
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    return () => window.removeEventListener(CONSENT_EVENT, sync);
  }, []);

  if (!enabled) return null;

  return (
    <Script
      defer
      src={UMAMI.scriptUrl}
      data-website-id={UMAMI.websiteId}
      strategy="afterInteractive"
    />
  );
}
