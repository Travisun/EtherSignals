"use client";

import { Download, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { NotificationButton } from "@/components/notifications/notification-button";
import { GithubButton } from "@/components/layout/github-button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LogoWordmark } from "@/components/layout/logo";
import { site } from "@/lib/site";
import { trackEvent } from "@/lib/analytics";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function Header() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="container-page flex h-14 items-center justify-between gap-3 md:h-16">
        <Link
          href="/"
          className="flex items-center rounded-md"
          aria-label="EtherSignals home"
          onClick={() => trackEvent("nav.logo")}
        >
          <LogoWordmark />
        </Link>

        <div className="flex items-center gap-1 sm:gap-1.5">
          <span className="mr-1 hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:flex">
            <span className="live-dot" aria-hidden={true} />
            Live
          </span>

          <Link
            href="/guide"
            className="hidden h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
            onClick={() => trackEvent("nav.guide")}
          >
            Reading guide
          </Link>

          {installEvent ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                trackEvent("app.install_prompt");
                void installEvent.prompt();
                setInstallEvent(null);
              }}
            >
              <Download />
              <span className="hidden sm:inline">Install app</span>
            </Button>
          ) : null}

          <GithubButton source="header" />

          <a
            href={site.telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="EtherSignals on Telegram"
            title="Join our Telegram channel"
            onClick={() => trackEvent("telegram.click", { source: "header" })}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Send className="size-4" />
          </a>

          <NotificationButton />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
