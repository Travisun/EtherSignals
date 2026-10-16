"use client";

import { createPortal } from "react-dom";
import { Cookie } from "lucide-react";
import { useSyncExternalStore } from "react";
import { trackEvent } from "@/lib/analytics";

/**
 * GDPR/CCPA-style consent banner. EtherSignals loads no third-party
 * analytics or ad scripts; consent here records the visitor's preference for
 * (a) strictly-necessary storage (consent record, UI state) and
 * (b) the optional web-push subscription used for signal notifications.
 * The choice is stored in localStorage + a cookie (180 days) and emitted as
 * a DOM event so dependent UI (Telegram drawer) can sequence itself.
 */

export const CONSENT_KEY = "ethersignals.consent";
export const CONSENT_COOKIE = "ethersignals.consent";
export const CONSENT_EVENT = "ethersignals:consent";

export type ConsentValue = "all" | "essential";

function subscribe(callback: () => void) {
  window.addEventListener(CONSENT_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CONSENT_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** Server snapshot: banner hidden until hydration proves otherwise. */
function getServerSnapshot(): string | null {
  return "__unset__";
}

function getSnapshot(): string | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "all" || v === "essential" ? v : null;
  } catch {
    return "__unset__"; // storage blocked, hide banner, choice is pageview-only
  }
}

export function consentValue(): ConsentValue | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "all" || v === "essential" ? v : null;
  } catch {
    return null;
  }
}

function persist(value: ConsentValue) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
    document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=${180 * 24 * 3600}; samesite=lax`;
  } catch {
    /* storage blocked, choice applies to this pageview only */
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
}

export function ConsentBanner() {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const ready = typeof window !== "undefined" && value !== "__unset__";
  const visible = ready && value === null;

  if (!visible) return null;

  return createPortal(
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-2xl rounded-xl border border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl shadow-black/25 sm:inset-x-4 sm:pb-4"
    >
      <div className="flex items-start gap-3">
        <div className="hidden size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary sm:flex">
          <Cookie className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Cookies & local storage</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Strictly necessary local storage keeps the site working and
            remembers your preferences. With your consent we also enable
            optional push notifications and privacy-friendly usage analytics
            (self-hosted Umami, cookieless, no cross-site tracking). See
            our{" "}
            <a
              href="/privacy"
              onClick={() => trackEvent("consent.privacy")}
              className="text-primary hover:underline"
            >
              Privacy Policy
            </a>
            .
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => {
                trackEvent("consent.accept_all");
                persist("all");
              }}
              className="h-8 cursor-pointer rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-strong"
            >
              Accept all
            </button>
            <button
              onClick={() => {
                trackEvent("consent.essential");
                persist("essential");
              }}
              className="h-8 cursor-pointer rounded-md border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-muted"
            >
              Essential only
            </button>
            <a
              href="/privacy"
              onClick={() => trackEvent("consent.learn_more")}
              className="inline-flex h-8 items-center px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Learn more
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
