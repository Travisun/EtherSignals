"use client";

import { ChartLine, Home, Send } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { NotificationButton } from "@/components/notifications/notification-button";
import { trackEvent } from "@/lib/analytics";
import { site } from "@/lib/site";

/**
 * Mobile-only bottom tab bar: the signature native-app affordance.
 * Sits above the home indicator (safe-area aware); the page content pads
 * itself clear of it.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav
      aria-label="App navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/75 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 md:hidden"
    >
      <div className="grid h-14 grid-cols-5">
        <button
          onClick={() => {
            trackEvent("tab.feed");
            if (pathname !== "/") {
              router.push("/");
            } else {
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          aria-current={pathname === "/" ? "page" : undefined}
          className={`flex cursor-pointer flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
            pathname === "/" ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Home className="size-5" />
          Feed
        </button>

        <Link
          href="/chart"
          onClick={() => trackEvent("tab.chart")}
          className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
            pathname.startsWith("/chart") ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ChartLine className="size-5" />
          Chart
        </Link>

        <Link
          href="/guide"
          onClick={() => trackEvent("tab.guide")}
          className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
            pathname === "/guide" ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden={true}>
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
          </svg>
          Guide
        </Link>

        <div className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground">
          <NotificationButton layout="tab" />
          <span>Alerts</span>
        </div>

        <a
          href={site.telegramUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent("telegram.click", { source: "tab_bar" })}
          className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Send className="size-5" />
          Telegram
        </a>
      </div>
    </nav>
  );
}
