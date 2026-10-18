"use client";

import { AlertTriangle, Radio, RefreshCw, Signal as SignalIcon, Timer, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CountdownRing } from "@/components/signals/countdown-ring";
import { SignalCard, SignalRow } from "@/components/signals/signal-views";
import { SignalDrawer, type DrawerPayload, type DrawerPricePoint } from "@/components/signals/signal-drawer";
import { REGIME_LABELS } from "@/lib/constants";
import { trackEvent } from "@/lib/analytics";
import { showLocalNotification } from "@/lib/notifications/client";
import type { FeedResponse, FeedStatsDTO, SignalDTO } from "@/lib/signals/dto";
import { REFRESH_INTERVAL_MS } from "@/lib/site";
import { formatPrice } from "@/lib/utils";

type Connection = "live" | "error" | "limited";

/**
 * Live signal feed.
 *
 * Polling contract (designed around the 4 req/min/IP budget):
 *  - auto-poll every 4s → 15 req/min steady state (matches the per-IP limit)
 *  - hidden tab: fetches are deferred, an immediate catch-up runs on focus
 *  - 429 responses: back off for the server-provided Retry-After
 *  - each poll sends sinceId so idle cycles are cheap server-side
 */
export function SignalFeed({
  initialSignals,
  initialStats,
}: {
  initialSignals: SignalDTO[];
  initialStats: FeedStatsDTO;
}) {
  const [signals, setSignals] = useState<SignalDTO[]>(initialSignals);
  const [stats, setStats] = useState<FeedStatsDTO>(initialStats);
  const [connection, setConnection] = useState<Connection>("live");
  const [remainingMs, setRemainingMs] = useState(REFRESH_INTERVAL_MS);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(0);

  /**
   * The newest record is expanded by default, and the expansion follows new
   * signals as they arrive. The moment the visitor expands any older row,
   * auto-follow pauses so their reading is not interrupted; it resumes when
   * they return to the newest row.
   */
  const [expandedId, setExpandedId] = useState<string | null>(
    initialSignals[0]?.id ?? null,
  );
  const expandedIdRef = useRef<string | null>(expandedId);
  const autoFollowRef = useRef(true);
  const [drawer, setDrawer] = useState<DrawerPayload | null>(null);

  const seenIdsRef = useRef<Set<string>>(new Set(initialSignals.map((s) => s.id)));
  // Deadline is initialized on the first tick (effect context; Date.now()
  // is impure and must not run during render).
  const deadlineRef = useRef<number>(0);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const fetchFeed = useCallback(async () => {
    if (inFlightRef.current) return;
    if (typeof document !== "undefined" && document.hidden) {
      deadlineRef.current = Date.now() + 2_000; // re-check shortly
      return;
    }
    inFlightRef.current = true;
    if (mountedRef.current) setRefreshing(true);
    try {
      // Using the newest id we already hold as the cursor keeps idle polls
      // to near-zero work on the server.
      const cursor = signals[0]?.id;
      const params = new URLSearchParams();
      if (cursor) params.set("sinceId", cursor);
      params.set("limit", "100");

      const res = await fetch(`/api/signals?${params.toString()}`, {
        cache: "no-store",
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "30");
        const waitMs = Math.min(65, Math.max(5, Number.isFinite(retryAfter) ? retryAfter : 30)) * 1000;
        deadlineRef.current = Date.now() + waitMs;
        setConnection("limited");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as FeedResponse;
      const incoming = data.signals ?? [];

      if (incoming.length > 0) {
        const fresh = incoming.filter((s) => !seenIdsRef.current.has(s.id));
        for (const s of fresh) seenIdsRef.current.add(s.id);

        if (fresh.length > 0) {
          // Newest first, hard cap at 100 rows: anything older is dropped
          // from the client store, the server keeps the full history.
          const merged = [...fresh, ...signals].sort(
            (a, b) =>
              Date.parse(b.receivedAt) - Date.parse(a.receivedAt) ||
              (a.id < b.id ? 1 : -1),
          );
          const capped = merged.slice(0, 100);
          seenIdsRef.current = new Set(capped.map((s) => s.id));
          setSignals(capped);

          // Expansion policy: follow the newest unless the visitor pinned an
          // older row; if the pinned row falls out of the window, fall back
          // to the newest.
          const newestId = capped[0]?.id ?? null;
          const pinnedGone =
            expandedIdRef.current !== null &&
            !capped.some((s) => s.id === expandedIdRef.current);
          if (autoFollowRef.current || pinnedGone) {
            expandedIdRef.current = newestId;
            setExpandedId(newestId);
          }

          if (mountedRef.current) {
            const ids = new Set(fresh.map((s) => s.id));
            setNewIds(ids);
            window.setTimeout(() => setNewIds(new Set()), 3_000);

            const top = fresh[0];
            const regimeLabel = REGIME_LABELS[top.regime] ?? top.regime;
            if (document.hidden) {
              void showLocalNotification(
                `${top.symbol} · ${regimeLabel} (${top.timeframe})`,
                top.price
                  ? `Price ${formatPrice(top.price)} · model score ${top.score >= 0 ? "+" : ""}${top.score.toFixed(2)}`
                  : "New AI signal just published",
              );
            } else if (window.matchMedia("(max-width: 767px)").matches) {
              // Mobile: top toasts collide with the status bar on iOS PWAs,
              // so alert from a bottom drawer instead.
              // signals and fresh are each newest-first; sort the union
              // ascending by push time so the chart series is chronological.
              const chronological = [...fresh, ...signals]
                .sort((a, b) => Date.parse(a.pushedAt) - Date.parse(b.pushedAt))
                .slice(-26)
                .map((s) => ({
                  t: Date.parse(s.pushedAt),
                  price: Number(s.price),
                  regime: s.regime,
                  tf: s.timeframe,
                }))
                .filter((p) => Number.isFinite(p.price) && Number.isFinite(p.t));
              setDrawer({
                signal: top,
                prev: signals[0] ?? null,
                count: fresh.length,
                series: chronological,
              });
            } else {
              toast(`${top.symbol} → ${regimeLabel} on ${top.timeframe}`, {
                description: top.price
                  ? `Price ${formatPrice(top.price)} · score ${top.score >= 0 ? "+" : ""}${top.score.toFixed(2)}`
                  : undefined,
              });
            }
          }
        }
      }

      if (data.stats) setStats(data.stats);
      setConnection("live");
    } catch {
      setConnection("error");
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
      deadlineRef.current = Date.now() + REFRESH_INTERVAL_MS;
      setRemainingMs(REFRESH_INTERVAL_MS);
    }
  }, [signals]);

  // Boot: mark mounted. `now` stays 0 until the first heartbeat tick, which
  // keeps the SSR HTML (relative ages) deterministic for hydration.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 250ms heartbeat drives both the ring and the fetch scheduler.
  useEffect(() => {
    if (deadlineRef.current === 0) {
      deadlineRef.current = Date.now() + REFRESH_INTERVAL_MS;
    }
    const id = window.setInterval(() => {
      const remaining = deadlineRef.current - Date.now();
      setRemainingMs(Math.max(0, remaining));
      if (remaining <= 0) void fetchFeed();
      setNow(Date.now());
    }, 250);
    return () => window.clearInterval(id);
  }, [fetchFeed]);

  // Catch-up when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && deadlineRef.current - Date.now() > 3_000) {
        deadlineRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const newestId = signals[0]?.id ?? null;

  const openDrawerTarget = () => {
    if (!newestId) return;
    autoFollowRef.current = true;
    expandedIdRef.current = newestId;
    setExpandedId(newestId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleRow = (id: string) => {
    const target = signals.find((s) => s.id === id);
    const collapsing = expandedIdRef.current === id;
    if (collapsing) {
      // Collapse: keep auto-follow so the next signal re-opens itself.
      expandedIdRef.current = null;
      setExpandedId(null);
    } else {
      // Expanding any row other than the newest hands control to the visitor.
      if (id !== newestId) autoFollowRef.current = false;
      else autoFollowRef.current = true; // back on the newest: resume following
      expandedIdRef.current = id;
      setExpandedId(id);
    }
    trackEvent("feed.row_toggle", {
      action: collapsing ? "collapse" : "expand",
      symbol: target?.symbol ?? null,
      timeframe: target?.timeframe ?? null,
      regime: target?.regime ?? null,
      is_latest: id === newestId,
    });
  };

  const connectionMeta: Record<Connection, { label: string; className: string }> = {
    live: { label: "Live", className: "text-success" },
    error: { label: "Reconnecting", className: "text-warning" },
    limited: { label: "Rate limited", className: "text-warning" },
  };

  const lastSignalAge =
    stats.lastSignalAt && now > 0 ? relativeAge(stats.lastSignalAt, now) : "n/a";

  return (
    <section className="space-y-4" aria-label="Live signal feed">
      {drawer ? (
        <SignalDrawer
          key={drawer.signal.id}
          payload={drawer}
          onClose={() => setDrawer(null)}
          onOpenFeed={openDrawerTarget}
        />
      ) : null}

      {/* Mobile compact stats: one ticker card, countdown lives in the feed header */}
      <Card className="flex divide-x divide-border/60 overflow-hidden md:hidden">
        <div className="flex-1 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Signals</p>
          <p className="tnum mt-0.5 text-lg font-bold tracking-tight">
            {stats.total.toLocaleString("en-US")}
          </p>
        </div>
        <div className="flex-1 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">24h</p>
          <p className="tnum mt-0.5 text-lg font-bold tracking-tight">{stats.last24h}</p>
        </div>
        <div className="flex-1 px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Latest</p>
          <p className="tnum mt-0.5 text-lg font-bold tracking-tight">{lastSignalAge}</p>
        </div>
      </Card>

      {/* Desktop / tablet stat cards */}
      <div className="hidden gap-3 md:grid md:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <SignalIcon className="size-3.5" />
            Signals published
          </p>
          <p className="tnum mt-1.5 text-2xl font-bold tracking-tight">
            {stats.total.toLocaleString("en-US")}
          </p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="size-3.5" />
            Past 24 hours
          </p>
          <p className="tnum mt-1.5 text-2xl font-bold tracking-tight">{stats.last24h}</p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Timer className="size-3.5" />
            Latest signal
          </p>
          <p className="tnum mt-1.5 text-2xl font-bold tracking-tight">{lastSignalAge}</p>
        </Card>
        <Card className="flex items-center justify-between p-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Next refresh
            </p>
            <p
              className={`mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold ${connectionMeta[connection].className}`}
            >
              <span className={`live-dot ${connection !== "live" ? "!bg-warning" : ""}`} aria-hidden={true} />
              {connectionMeta[connection].label}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CountdownRing remainingMs={remainingMs} totalMs={REFRESH_INTERVAL_MS} />
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh now"
              title="Refresh now (uses one request of your 4/min quota)"
              onClick={() => {
                trackEvent("feed.refresh");
                deadlineRef.current = Date.now();
              }}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
            </Button>
          </div>
        </Card>
      </div>

      {connection === "limited" ? (
        <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          You&apos;ve reached the request limit (4 per minute). The feed resumes
          automatically in a moment. No action needed.
        </p>
      ) : null}

      {/* Feed */}
      <Card className="overflow-hidden">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 md:py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
              Live feed
              <span
                className={`live-dot md:hidden ${connection !== "live" ? "!bg-warning" : ""}`}
                aria-hidden={true}
              />
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Latest {signals.length}
              <span className="hidden md:inline"> · auto-refreshes every 4s ·</span>
              <span className="md:hidden"> ·</span>{" "}
              <a
                href="/guide"
                onClick={() => trackEvent("feed.guide")}
                className="text-primary hover:underline"
              >
                guide
              </a>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 md:hidden">
            <CountdownRing remainingMs={remainingMs} totalMs={REFRESH_INTERVAL_MS} size={30} />
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Refresh now"
              onClick={() => {
                trackEvent("feed.refresh");
                deadlineRef.current = Date.now();
              }}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
            </Button>
          </div>
        </header>

        {signals.length === 0 ? (
          <EmptyState
            icon={<Radio />}
            title="You're all caught up"
            description="No signals yet. The moment the AI model detects a trend shift on any timeframe, it appears here, usually within seconds of detection."
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">Time</th>
                    <th scope="col" className="px-3 py-2 font-medium">Market</th>
                    <th scope="col" className="px-3 py-2 font-medium">Price</th>
                    <th scope="col" className="px-3 py-2 font-medium">AI signal</th>
                    <th scope="col" className="px-3 py-2 font-medium">2m → 1d board</th>
                    <th scope="col" className="px-3 py-2" aria-label="Expand" />
                  </tr>
                </thead>
                <tbody>
                  {signals.map((s) => (
                    <SignalRow
                      key={s.id}
                      signal={s}
                      isNew={newIds.has(s.id)}
                      isLatest={s.id === newestId}
                      expanded={expandedId === s.id}
                      onToggle={() => toggleRow(s.id)}
                      timeLocal={now > 0}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 p-3 md:hidden">
              {signals.map((s) => (
                <SignalCard
                  key={s.id}
                  signal={s}
                  isNew={newIds.has(s.id)}
                  isLatest={s.id === newestId}
                  expanded={expandedId === s.id}
                  onToggle={() => toggleRow(s.id)}
                  timeLocal={now > 0}
                />
              ))}
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

/** Client-side relative age, minute-granular (mirrors utils.relativeTime). */
function relativeAge(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "n/a";
  const s = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (s < 60) return `${Math.max(1, s)}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
