"use client";

import { X } from "lucide-react";
import { useMemo } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { REGIME_LABELS } from "@/lib/constants";
import type { SignalDTO } from "@/lib/signals/dto";
import { formatPrice } from "@/lib/utils";
import { regimeMeta, formatScore } from "@/components/signals/regime";
import { trackEvent } from "@/lib/analytics";
import { useDragToDismiss } from "@/components/ui/use-drag-to-dismiss";
import { cn } from "@/lib/utils";


/** Regime → SVG paint color (CSS tokens). */
function regimeColor(regime: string): string {
  if (regime.includes("down")) return "var(--destructive)";
  if (regime.includes("up")) return "var(--success)";
  return "var(--muted-foreground)";
}

/**
 * Sparkline of recent signal prices with price gridlines (y-axis), time
 * ticks (x-axis) and one dot per signal colored by its regime — the
 * evaluation marks that tie the chart to the model output.
 */
function PriceTrendChart({
  series,
  accent,
}: {
  series: DrawerPricePoint[];
  accent: string;
}) {
  const W = 320;
  const H = 132;
  const PL = 4;
  const PR = 46;
  const PT = 10;
  const PB = 20;

  const geom = useMemo(() => {
    const n = series.length;
    if (n < 2) return null;
    const prices = series.map((p) => p.price);
    let min = Math.min(...prices);
    let max = Math.max(...prices);
    if (max === min) {
      const pad = Math.abs(max) * 0.004 || 1;
      min -= pad;
      max += pad;
    }
    const padV = (max - min) * 0.12;
    const lo = min - padV;
    const hi = max + padV;
    const innerW = W - PL - PR;
    const innerH = H - PT - PB;

    // X is time-proportional so irregular push intervals render truthfully.
    const t0 = series[0].t;
    const tN = series[n - 1].t;
    const span = Math.max(1, tN - t0);
    const x = (t: number) => PL + ((t - t0) / span) * innerW;
    const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * innerH;

    const line = series
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`)
      .join(" ");
    const area = `${line} L${x(tN).toFixed(1)},${(H - PB).toFixed(1)} L${x(t0).toFixed(1)},${(H - PB).toFixed(1)} Z`;

    // Four y gridlines (top / two thirds / one third / bottom) with labels.
    const grid = [0, 1 / 3, 2 / 3, 1].map((f) => {
      const v = hi - f * (hi - lo);
      const fmt = (val: number) =>
        val >= 1000 ? Math.round(val).toLocaleString("en-US") : Number(val.toFixed(val >= 1 ? 2 : 4));
      return { y: y(v), text: String(fmt(v)) };
    });

    // Regime switches are the evaluation events worth marking larger.
    const switches = new Set<number>();
    for (let i = 1; i < n; i++) {
      if (series[i].regime !== series[i - 1].regime) switches.add(i);
    }

    const dotR = n > 48 ? 1.5 : n > 20 ? 2 : 2.6;

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const t = t0 + f * span;
      const d = new Date(t);
      const label = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
      return { x: PL + f * innerW, label };
    });

    return { x, y, line, area, grid, switches, dotR, ticks, n };
  }, [series]);

  if (!geom) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        The trend chart appears once a few signal prices are available.
      </p>
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Recent signal price trend">
      <defs>
        <linearGradient id="drawer-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.2" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {geom.grid.map((g, i) => (
        <g key={i}>
          <line x1={PL} x2={W - PR} y1={g.y} y2={g.y} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" opacity="0.7" />
          <text x={W - PR + 6} y={g.y + 3} fontSize="9" fill="var(--muted-foreground)" className="tnum">
            {g.text}
          </text>
        </g>
      ))}

      <path d={geom.area} fill="url(#drawer-grad)" />
      <path d={geom.line} fill="none" stroke={accent} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />

      {/* evaluation dots: regime color per signal, regime switches marked larger */}
      {series.map((p, i) => (
        <circle
          key={i}
          cx={geom.x(p.t)}
          cy={geom.y(p.price)}
          r={geom.switches.has(i) ? geom.dotR + 1.4 : geom.dotR}
          fill={regimeColor(p.regime)}
          stroke={geom.switches.has(i) ? "var(--card)" : "none"}
          strokeWidth="1"
        >
          <title>{`${new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(p.t))} · ${p.tf} · ${p.regime} · ${formatPrice(String(p.price))}`}</title>
        </circle>
      ))}

      {/* current point, emphasized */}
      <circle
        cx={geom.x(series[series.length - 1].t)}
        cy={geom.y(series[series.length - 1].price)}
        r={4.2}
        fill={accent}
        stroke="var(--card)"
        strokeWidth="1.5"
      />

      {/* x time ticks, proportional to the real timestamps */}
      {geom.ticks.map((t, i) => (
        <text
          key={i}
          x={t.x}
          y={H - 6}
          fontSize="9"
          fill="var(--muted-foreground)"
          className="tnum"
          textAnchor={i === 0 ? "start" : i === geom.ticks.length - 1 ? "end" : "middle"}
        >
          {t.label}
        </text>
      ))}
    </svg>
  );
}

function timeLocalClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

const AUTO_CLOSE_MS = 10_000;

export type DrawerPricePoint = {
  /** push timestamp (unix ms) */
  t: number;
  price: number;
  regime: string;
  tf: string;
};

export type DrawerPayload = {
  signal: SignalDTO;
  /** Newest signal before this one arrived, for the delta readout */
  prev: SignalDTO | null;
  /** How many fresh signals this batch carried */
  count: number;
  /** Recent signal prices (chronological) powering the trend chart */
  series: DrawerPricePoint[];
};

/**
 * Mobile new-signal alert, presented as an iOS sheet: dimmed backdrop,
 * grabber handle, spring presentation, drag-to-dismiss, 10s countdown bar
 * with auto-close, and pop-in emphasis on the changing numbers.
 */
export function SignalDrawer({
  payload,
  onClose,
  onOpenFeed,
}: {
  payload: DrawerPayload;
  onClose: () => void;
  /** Tapping the body: jump to the feed with the newest row expanded. */
  onOpenFeed: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const closedRef = useRef(false);
  const { signal, prev, count, series } = payload;
  const meta = regimeMeta(signal.regime);

  // Keep onClose in a ref: the parent re-renders every 250ms (heartbeat) and
  // an unstable dependency would reset the auto-close timer forever.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const close = useCallback(
    (method: "auto" | "user" | "open" | "backdrop" | "drag") => {
      if (closedRef.current) return;
      closedRef.current = true;
      trackEvent("signal_drawer.close", { method, symbol: signal.symbol });
      setClosing(true);
      window.setTimeout(() => onCloseRef.current(), 240);
    },
    [signal.symbol],
  );

  const dragRef = useDragToDismiss(() => close("drag"));

  const continuationProb =
    signal.board?.find((entry) => entry.tf === signal.timeframe)?.prob ?? null;

  // Auto-dismiss after 10s.
  useEffect(() => {
    const t = window.setTimeout(() => close("auto"), AUTO_CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [close, payload.signal.id]);

  const deltaPct =
    prev?.price && signal.price
      ? ((Number(signal.price) - Number(prev.price)) / Number(prev.price)) * 100
      : null;
  const showDelta =
    deltaPct !== null && Number.isFinite(deltaPct) && Math.abs(deltaPct) >= 0.001;
  const accent =
    signal.regime.includes("down")
      ? "var(--destructive)"
      : signal.regime.includes("up")
        ? "var(--success)"
        : "var(--muted-foreground)";

  return (
    <>
      <div
        className={cn(
          "fade-in fixed inset-0 z-[75] bg-black/45 backdrop-blur-[2px]",
          closing && "closing",
        )}
        onClick={() => close("backdrop")}
        role="presentation"
      />

      <div
        role="alert"
        aria-label="New signal alert"
        ref={dragRef}
        className={cn(
          // Negative bottom margin pushes the card 24px past the viewport,
          // so no background can ever peek below the sheet.
          "signal-drawer fixed inset-x-0 bottom-0 z-[80] -mb-6 flex min-h-[52svh] flex-col rounded-t-[20px] border-t border-x border-border bg-card shadow-2xl shadow-black/40",
          closing && "closing",
        )}
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        {/* grabber */}
        <div className="flex cursor-grab touch-none justify-center pt-2.5 pb-1" style={{ touchAction: "none" }}>
          <span className="h-[5px] w-9 rounded-full bg-muted-foreground/30" aria-hidden={true} />
        </div>

        <div
          className="px-5 pb-1"
          onClick={() => {
            close("open");
            onOpenFeed();
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <p
              className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider"
              style={{ color: accent }}
            >
              <span className="live-dot" style={{ background: accent }} aria-hidden={true} />
              New signal{count > 1 ? ` · +${count - 1} more` : ""}
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                close("user");
              }}
              aria-label="Close alert"
              className="-mr-1 -mt-1 inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-muted/70 text-muted-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-2.5 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[17px] font-semibold tracking-tight">
                {signal.symbol}
                <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                  {signal.timeframe}
                </span>
              </p>
              <p className={cn("mt-1 text-[13px] font-semibold", meta.text)}>
                {REGIME_LABELS[signal.regime] ?? signal.regime}
              </p>
            </div>
            <div className="text-right">
              <p className={cn("num-pop tnum text-[28px] font-bold leading-none tracking-tight", meta.text)}>
                {formatPrice(signal.price)}
              </p>
              <p className="num-pop-late tnum mt-1.5 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold">
                score {formatScore(signal.score)}
              </p>
            </div>
          </div>

          {showDelta ? (
            <p
              className={cn(
                "num-pop-late tnum mt-2.5 text-xs font-semibold",
                deltaPct >= 0 ? "text-success" : "text-destructive",
              )}
            >
              {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(2)}% vs previous
            </p>
          ) : null}

          {/* key dimensions of this signal */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-muted/60 px-2 py-1.5 text-center">
              <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Continuation</p>
              <p className="tnum mt-0.5 text-xs font-bold">
                {continuationProb === null ? "n/a" : `${Math.round(continuationProb * 100)}%`}
              </p>
            </div>
            <div className="rounded-lg bg-muted/60 px-2 py-1.5 text-center">
              <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Resistance</p>
              <p className="tnum mt-0.5 text-xs font-bold">
                {signal.levels?.resistance ? formatPrice(signal.levels.resistance) : "n/a"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/60 px-2 py-1.5 text-center">
              <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Support</p>
              <p className="tnum mt-0.5 text-xs font-bold">
                {signal.levels?.support ? formatPrice(signal.levels.support) : "n/a"}
              </p>
            </div>
          </div>

          {/* price trend from recent signal prices */}
          <div className="mt-3.5">
            <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Price trend · all recent signals
            </p>
            <PriceTrendChart series={series} accent={accent} />
          </div>

          <p className="tnum mt-2 text-[10px] text-muted-foreground">
            Pushed {timeLocalClock(signal.pushedAt)} · {signal.marketType === "spot" ? "Spot" : "Perp"}
            {signal.levels?.breakout ? ` · ${signal.levels.breakout === "up" ? "20d high broken" : signal.levels.breakout === "down" ? "20d low broken" : "inside 20d range"}` : ""}
          </p>

          {/* 10s auto-close countdown */}
          <div className="mt-3.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden={true}>
            <div className="drawer-bar h-full rounded-full" style={{ background: accent }} />
          </div>
        </div>

        {/* the card surface stays solid down to the bottom edge */}
        <div className="flex-1" aria-hidden={true} />
      </div>
    </>
  );
}
