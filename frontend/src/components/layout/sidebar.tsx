"use client";

import { BookOpen, ChartLine, Newspaper, Send, Download } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoWordmark } from "@/components/layout/logo";
import { NotificationButton } from "@/components/notifications/notification-button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { GitHubMark } from "@/components/layout/github-button";
import { site } from "@/lib/site";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * Desktop console sidebar (lg+): icon + text navigation, unified across the
 * site. Mobile keeps the top header + bottom tab bar instead.
 */

const NAV = [
  { href: "/", label: "Signals", icon: Newspaper, event: "nav.feed" },
  { href: "/chart", label: "Chart", icon: ChartLine, event: "nav.chart" },
  { href: "/guide", label: "Guide", icon: BookOpen, event: "nav.guide" },
] as const;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function Sidebar() {
  const pathname = usePathname();
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-border bg-background/95 backdrop-blur-md lg:flex">
      {/* brand */}
      <div className="flex h-16 items-center border-b border-border px-4">
        <Link
          href="/"
          className="flex items-center rounded-md"
          aria-label="EtherSignals home"
          onClick={() => trackEvent("nav.logo")}
        >
          <LogoWordmark />
        </Link>
        <span
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          title="Live producer feed"
        >
          <span className="live-dot" aria-hidden={true} />
          Live
        </span>
      </div>

      {/* primary nav */}
      <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV.map(({ href, label, icon: Icon, event }) => (
          <Link
            key={href}
            href={href}
            onClick={() => trackEvent(event)}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive(href)
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4.5 shrink-0" />
            {label}
          </Link>
        ))}

        <div className="my-3 border-t border-border/70" aria-hidden={true} />

        <a
          href={site.telegramUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent("telegram.click", { source: "sidebar" })}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Send className="size-4.5 shrink-0" />
          Telegram
        </a>
        <a
          href="https://github.com/Travisun/EtherSignals"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent("github.click", { source: "sidebar" })}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <GitHubMark className="size-4 shrink-0" />
          GitHub
        </a>
      </nav>

      {/* footer actions */}
      <div className="space-y-2 border-t border-border p-3">
        {installEvent ? (
          <button
            type="button"
            onClick={() => {
              trackEvent("app.install_prompt");
              void installEvent.prompt();
              setInstallEvent(null);
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Download className="size-4.5 shrink-0" />
            Install app
          </button>
        ) : null}
        <div className="flex items-center justify-between rounded-lg px-3 py-1.5">
          <NotificationButton />
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
