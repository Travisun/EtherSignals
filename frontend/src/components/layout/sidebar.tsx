"use client";

import { BookOpen, ChartLine, ChevronsLeft, ChevronsRight, Newspaper, Send, Download } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo, LogoWordmark } from "@/components/layout/logo";
import { GitHubMark } from "@/components/layout/github-button";
import { NotificationButton } from "@/components/notifications/notification-button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { site } from "@/lib/site";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * Desktop console sidebar (lg+). Collapses to an icon rail (default) so the
 * content gets the full width; expands to icon+text on demand (persisted in
 * localStorage; the width is published to the layout via the --sidebar-w CSS
 * variable). Reserves the tablet/notch safe-area at the top.
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
  const [expanded, setExpanded] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  // restore the persisted expand state + publish the width to the layout
  useEffect(() => {
    const saved = localStorage.getItem("gt.sidebarExpanded") === "1";
    setExpanded(saved);
    document.documentElement.style.setProperty("--sidebar-w", saved ? "14rem" : "3.75rem");
    return () => {
      document.documentElement.style.removeProperty("--sidebar-w");
    };
  }, []);

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("gt.sidebarExpanded", next ? "1" : "0");
      document.documentElement.style.setProperty("--sidebar-w", next ? "14rem" : "3.75rem");
      return next;
    });
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-background/95 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md transition-[width] duration-200 lg:flex",
        expanded ? "w-56" : "w-[3.75rem]",
      )}
    >
      {/* brand + collapse toggle */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-border",
          expanded ? "px-3" : "flex-col justify-center gap-2 px-2",
        )}
      >
        {expanded ? (
          <Link
            href="/"
            className="flex min-w-0 flex-1 items-center rounded-md"
            aria-label="EtherSignals home"
            onClick={() => trackEvent("nav.logo")}
          >
            <LogoWordmark compact />
          </Link>
        ) : (
          <Link href="/" aria-label="EtherSignals home" onClick={() => trackEvent("nav.logo")}>
            <Logo size={26} />
          </Link>
        )}
        {expanded ? (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="live-dot" aria-hidden={true} />
            Live
          </span>
        ) : null}
        <button
          type="button"
          onClick={toggle}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          title={expanded ? "Collapse" : "Expand"}
          className={cn(
            "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            expanded ? "ml-1" : "",
          )}
        >
          {expanded ? <ChevronsLeft className="size-4" /> : <ChevronsRight className="size-4" />}
        </button>
      </div>

      {/* primary nav */}
      <nav aria-label="Main" className={cn("flex-1 space-y-1 overflow-y-auto", expanded ? "p-3" : "px-2 py-3")}>
        {NAV.map(({ href, label, icon: Icon, event }) => (
          <Link
            key={href}
            href={href}
            onClick={() => trackEvent(event)}
            aria-current={isActive(href) ? "page" : undefined}
            title={expanded ? undefined : label}
            className={cn(
              "flex items-center rounded-lg text-sm font-medium transition-colors",
              expanded ? "gap-3 px-3 py-2" : "justify-center px-0 py-2.5",
              isActive(href)
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-5 shrink-0" />
            {expanded ? <span>{label}</span> : <span className="sr-only">{label}</span>}
          </Link>
        ))}

        <div className={cn("my-3 border-t border-border/70", !expanded && "mx-2")} aria-hidden={true} />

        <a
          href={site.telegramUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent("telegram.click", { source: "sidebar" })}
          title={expanded ? undefined : "Telegram"}
          className={cn(
            "flex items-center rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            expanded ? "gap-3 px-3 py-2" : "justify-center px-0 py-2.5",
          )}
        >
          <Send className="size-5 shrink-0" />
          {expanded ? <span>Telegram</span> : <span className="sr-only">Telegram</span>}
        </a>
        <a
          href="https://github.com/Travisun/EtherSignals"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent("github.click", { source: "sidebar" })}
          title={expanded ? undefined : "GitHub"}
          className={cn(
            "flex items-center rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            expanded ? "gap-3 px-3 py-2" : "justify-center px-0 py-2.5",
          )}
        >
          <GitHubMark className="size-[18px] shrink-0" />
          {expanded ? <span>GitHub</span> : <span className="sr-only">GitHub</span>}
        </a>
      </nav>

      {/* footer actions */}
      <div className={cn("shrink-0 space-y-1 border-t border-border", expanded ? "p-3" : "px-2 py-3")}>
        {installEvent ? (
          <button
            type="button"
            onClick={() => {
              trackEvent("app.install_prompt");
              void installEvent.prompt();
              setInstallEvent(null);
            }}
            title="Install app"
            className={cn(
              "flex w-full items-center rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              expanded ? "gap-3 px-3 py-2" : "justify-center px-0 py-2.5",
            )}
          >
            <Download className="size-5 shrink-0" />
            {expanded ? <span>Install app</span> : <span className="sr-only">Install app</span>}
          </button>
        ) : null}
        <div
          className={cn(
            "flex items-center rounded-lg py-1",
            expanded ? "justify-between px-3" : "flex-col justify-center gap-2 px-0",
          )}
        >
          <NotificationButton layout={expanded ? "compact" : "tab"} />
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
