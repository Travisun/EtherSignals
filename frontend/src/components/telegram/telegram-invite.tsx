"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { consentValue } from "@/components/consent/consent-banner";
import { TelegramBadge, TelegramLogo } from "@/components/telegram/telegram-logo";
import { useDragToDismiss } from "@/components/ui/use-drag-to-dismiss";
import { trackEvent } from "@/lib/analytics";
import { site } from "@/lib/site";

const SHOW_DELAY_MS = 4_000;
const CONSENT_FALLBACK_MS = 12_000;
const COOLDOWN_MS = 24 * 3600_000; // re-invite at most once per day
const STORE_KEY = "ethersignals.tg-invite";

/**
 * First-visit invitation to the Telegram channel.
 *
 * - Desktop: centered modal, Mobile: bottom sheet. One component, responsive.
 * - Shown once per visit; any interaction (CTA, close, backdrop, Escape)
 *   starts a 24h cooldown stored in localStorage. No tracking involved.
 * - Waits for the cookie-consent decision so the two surfaces never stack.
 */
export function TelegramInvite() {
  const [open, setOpen] = useState(false);
  const dismissedRef = useRef(false);

  const close = (method: "x" | "later" | "backdrop" | "escape" | "cta" | "drag") => {
    trackEvent("invite.dismiss", { method });
    dismissedRef.current = true;
    setOpen(false);
    try {
      localStorage.setItem(STORE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  };

  const sheetRef = useDragToDismiss(() => close("drag"));

  useEffect(() => {
    let lastInvite = 0;
    try {
      lastInvite = Number(localStorage.getItem(STORE_KEY) ?? "0");
    } catch {
      /* storage unavailable, still show once */
    }
    if (Date.now() - lastInvite < COOLDOWN_MS) return;

    let cancelled = false;
    let fallbackTimer = 0;
    let consentListener: (() => void) | null = null;

    const show = () => {
      if (!cancelled && !dismissedRef.current) setOpen(true);
    };

    const timer = window.setTimeout(() => {
      if (consentValue() !== null) {
        show();
        return;
      }
      // Consent still pending: wait for the banner decision…
      consentListener = () => window.setTimeout(show, 500);
      window.addEventListener("ethersignals:consent", consentListener, {
        once: true,
      });
      // …but never hold the invite hostage to a stalled banner.
      fallbackTimer = window.setTimeout(() => {
        if (consentListener) {
          window.removeEventListener("ethersignals:consent", consentListener);
          consentListener = null;
        }
        show();
      }, CONSENT_FALLBACK_MS);
    }, SHOW_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(fallbackTimer);
      if (consentListener) {
        window.removeEventListener("ethersignals:consent", consentListener);
      }
    };
  }, []);

  // Escape to close + body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close("escape");
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 backdrop-blur-[3px] sm:items-center sm:p-6"
      onClick={() => close("backdrop")}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Join our Telegram channel"
        onClick={(e) => e.stopPropagation()}
        ref={sheetRef}
        className="invite-panel relative w-full max-w-md rounded-t-[20px] border-x border-t border-border bg-card px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2 shadow-2xl shadow-black/40 sm:rounded-2xl sm:border sm:pb-6"
      >
        {/* iOS sheet grabber, mobile only */}
        <div className="flex cursor-grab touch-none justify-center pb-3 sm:hidden" style={{ touchAction: "none" }}>
          <span className="h-[5px] w-9 rounded-full bg-muted-foreground/30" aria-hidden={true} />
        </div>
        <button
          onClick={() => close("x")}
          aria-label="Close invite"
          className="absolute right-3 top-3 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="flex flex-col items-center text-center">
          <TelegramBadge size={64} />

          <h2 className="mt-4 text-lg font-bold tracking-tight">
            Never miss a trend shift
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Every signal our AI model detects is pushed to the Telegram channel
            the second it happens. Free, instant, and no account needed.
          </p>

          <a
            href={site.telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              trackEvent("invite.cta");
              close("cta");
            }}
            className="mt-5 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#229ED9] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#1d8cbe]"
          >
            <TelegramLogo className="size-5 fill-white" />
            Open Telegram Channel
          </a>

          <button
            onClick={() => close("later")}
            className="mt-2.5 cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Maybe later
          </button>

          <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground/70">
            Research &amp; educational project · Not financial advice
          </p>
        </div>
      </div>
    </div>
  );
}
