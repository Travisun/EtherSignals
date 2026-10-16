"use client";

import { BellOff, BellRing } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  currentRegistration,
  isStandalone,
  notificationsSupported,
  readVapidKey,
  urlBase64ToUint8Array,
} from "@/lib/notifications/client";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

type Mode = "off" | "local" | "push" | "unsupported" | "loading";

/**
 * Subscribe (or re-subscribe) the browser for web push and register the
 * subscription server-side. Returns the achieved mode, or null when push
 * could not be established (no VAPID on the server, subscribe failure).
 * Idempotent: an existing subscription is reused.
 */
async function ensurePushSubscription(): Promise<"push" | "local" | null> {
  const reg = await currentRegistration();
  if (!reg) return "local";

  const vapidKey = readVapidKey();
  if (!vapidKey) return "local";

  try {
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      }));

    const res = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      reason?: string;
    };
    if (res.ok && data.ok) return "push";
    // Server push not configured (or endpoint rejected) — local alerts still work.
    return "local";
  } catch (err) {
    console.error("[push] subscribe failed", err);
    return "local";
  }
}

/**
 * Desktop-notification opt-in. Grants local notifications (works while the
 * tab is open in the background) and, when the server has VAPID keys,
 * registers a Web Push subscription so signals arrive even with the site
 * closed. Falls back gracefully everywhere; on iOS it explains the
 * Add-to-Home-Screen requirement (a WebKit platform rule, not ours).
 */
export function NotificationButton({
  layout = "compact",
}: {
  layout?: "compact" | "tab";
}) {
  const [mode, setMode] = useState<Mode>("loading");

  /**
   * Mount-time state detection plus silent healing: browsers (iOS Safari in
   * particular) expire or rotate push subscriptions without warning. The
   * service worker forwards `pushsubscriptionchange` here as well.
   */
  const heal = useCallback(async () => {
    // First statement awaits (external browser state) so the setState calls
    // below never run on the synchronous effect path.
    const reg = notificationsSupported() ? await currentRegistration() : null;
    if (!notificationsSupported()) {
      setMode("unsupported");
      return;
    }
    if (Notification.permission !== "granted") {
      setMode("off");
      return;
    }
    const sub = reg
      ? await reg.pushManager.getSubscription().catch(() => null)
      : null;
    if (sub) {
      setMode("push");
      return;
    }
    setMode((await ensurePushSubscription()) ?? "local");
  }, []);

  useEffect(() => {
    void heal();
  }, [heal]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "pushsubscriptionchange") {
        void heal();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [heal]);

  const enable = async () => {
    trackEvent("alerts.enable");
    if (!notificationsSupported()) {
      toast.error("Notifications are not supported in this browser.");
      return;
    }
    // iOS quirk: Web Push only works inside the installed PWA.
    const isIOS =
      /iP(hone|od|ad)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS && !isStandalone()) {
      toast.info(
        "On iPhone, open EtherSignals from your Home Screen first (Share, then Add to Home Screen), then tap this button again to enable notifications.",
      );
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setMode("off");
      toast.warning("Notifications are off for now. You can turn them on anytime.");
      return;
    }

    const reg = await currentRegistration();
    if (!reg) {
      setMode("local");
      toast.info("Notifications enabled for this tab.");
      return;
    }

    const achieved = await ensurePushSubscription();
    if (achieved === "push") {
      setMode("push");
      toast.success("Push notifications are on. You will hear from the model.");
    } else {
      setMode("local");
      toast.success(
        "Notifications enabled while the site is open. Server push is not configured.",
      );
    }
  };

  if (mode === "loading") return null;

  if (layout === "tab") {
    // Icon only: the tab bar wrapper owns the label, no switch-style text.
    const Icon = mode === "off" || mode === "unsupported" ? BellOff : BellRing;
    return (
      <button
        onClick={() => void enable()}
        aria-label="Toggle signal notifications"
        title={mode === "push" ? "Push on" : "Tap to enable notifications"}
        className={cn(
          "flex cursor-pointer items-center justify-center transition-colors",
          mode === "push" ? "text-success" : "text-muted-foreground",
        )}
      >
        <Icon className="size-5" />
      </button>
    );
  }

  const meta =
    mode === "push"
      ? { icon: <BellRing />, label: "Push on", variant: "success" as const }
      : mode === "local"
        ? { icon: <BellRing />, label: "Alerts on", variant: "outline" as const }
        : { icon: <BellOff />, label: "Alerts", variant: "outline" as const };

  return (
    <Button
      variant={meta.variant}
      size="sm"
      onClick={() => void enable()}
      title={
        mode === "push"
          ? "Push notifications are on"
          : "Get notified when new signals arrive"
      }
      aria-label="Toggle signal notifications"
      className="gap-1.5"
    >
      {meta.icon}
      <span className="hidden md:inline">{meta.label}</span>
    </Button>
  );
}
