"use client";

/**
 * Professional one-glance chart dashboard, benchmarked on institutional
 * research notes:
 *  - full 16-tier window selector (2m/2h/8h/2d aggregated server-side)
 *  - EMA20/EMA50 overlays + the model's key levels as horizontal lines
 *  - every signal push marked with its PREDICTED direction arrow and
 *    continuation probability, then graded against the realized price move
 *    (✓ hit / ✗ miss) — prediction-vs-actual accountability on the chart
 *  - consensus strip + forecast hit-rate header
 *  - right rail in plain language with a legend (no cryptic abbreviations)
 * Data: 10s candle polling (server memory cache + 1 req/10s/IP), 20s feed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { SignalDTO } from "@/lib/signals/dto";
import { NhnlLadder } from "@/components/signals/nhnl-ladder";
import { RegimeBadge, TrendBoard, formatScore, regimeMeta } from "@/components/signals/regime";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";

/** full ladder, display order — 2m/2h/8h/2d arrive pre-aggregated */
const TFS = [
  "1m", "2m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h",
  "12h", "1d", "2d", "3d", "1w", "1M",
] as const;
const TF_SECONDS: Record<string, number> = {
  "1m": 60, "2m": 120, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600,
  "2h": 7200, "4h": 14400, "6h": 21600, "8h": 28800, "12h": 43200,
  "1d": 86400, "2d": 172800, "3d": 259200, "1w": 604800, "1M": 2592000,
};

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const REGIME_HEX: Record<string, string> = {
  strong_up: "#16a34a",
  up: "#16a34a",
  neutral: "#8b8f98",
  down: "#dc2626",
  strong_down: "#dc2626",
};

/** exponential moving average (client-side overlay computation) */
function ema(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev == null) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

interface GradedMarker {
  marker: SeriesMarker<Time>;
  outcome: "hit" | "miss" | "flat" | "pending";
}

export function ChartDashboard({ initialSignals }: { initialSignals: SignalDTO[] }) {
  const [tf, setTf] = useState("5m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [signals, setSignals] = useState<SignalDTO[]>(initialSignals);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [showEma, setShowEma] = useState(true);
  const [showLevels, setShowLevels] = useState(true);

  const chartDivRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<{
    chart: IChartApi;
    series: ISeriesApi<"Candlestick">;
    volume: ISeriesApi<"Histogram">;
    ema20: ISeriesApi<"Line">;
    ema50: ISeriesApi<"Line">;
  } | null>(null);
  const fittedForTf = useRef<string | null>(null);
  const priceLinesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);

  const latest = signals[0] ?? null;

  // candles: poll every 10s — matches the server's per-IP window exactly
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/market/candles?tf=${tf}&limit=400`);
        if (res.status === 429) {
          if (!cancelled) setError("rate limited — retrying shortly");
          return;
        }
        const j = await res.json();
        if (!j.ok && j?.error) throw new Error(j.error?.message ?? "failed");
        if (!cancelled) {
          setCandles(j.candles as Candle[]);
          setError(null);
          setUpdatedAt(Date.now());
        }
      } catch {
        if (!cancelled) setError("market data unavailable");
      }
    };
    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tf]);

  // signals: our own DB via the existing feed API (20s cadence)
  useEffect(() => {
    const load = () =>
      fetch("/api/signals?limit=50")
        .then((r) => r.json())
        .then((j) => {
          if (Array.isArray(j.signals)) setSignals(j.signals as SignalDTO[]);
        })
        .catch(() => undefined);
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, []);

  // chart lifecycle (once)
  useEffect(() => {
    const el = chartDivRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b8f98",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(120,120,128,0.10)" },
        horzLines: { color: "rgba(120,120,128,0.10)" },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderVisible: false },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
      borderVisible: false,
    });
    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const ema20 = chart.addLineSeries({
      color: "#f59e0b",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "EMA20",
    });
    const ema50 = chart.addLineSeries({
      color: "#3b82f6",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "EMA50",
    });
    apiRef.current = { chart, series, volume, ema20, ema50 };
    return () => {
      chart.remove();
      apiRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  // candle data → series (fit zoom once per timeframe switch)
  useEffect(() => {
    const api = apiRef.current;
    if (!api || candles.length === 0) return;
    const times = candles.map((c) => c.time as UTCTimestamp);
    api.series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    api.volume.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "rgba(22,163,74,0.35)" : "rgba(220,38,38,0.35)",
      })),
    );
    const closes = candles.map((c) => c.close);
    const putLine = (line: ISeriesApi<"Line">, values: (number | null)[]) =>
      line.setData(
        times
          .map((t, i) => ({ time: t, value: values[i] }))
          .filter((p): p is { time: UTCTimestamp; value: number } => p.value != null),
      );
    putLine(api.ema20, ema(closes, 20));
    putLine(api.ema50, ema(closes, 50));
    api.ema20.applyOptions({ visible: showEma });
    api.ema50.applyOptions({ visible: showEma });
    if (fittedForTf.current !== tf) {
      api.chart.timeScale().fitContent();
      fittedForTf.current = tf;
    }
  }, [candles, tf, showEma]);

  // ── graded markers: predicted arrow + continuation % + realized ✓/✗ ──
  const graded = useMemo<GradedMarker[]>(() => {
    if (candles.length === 0) return [];
    const step = TF_SECONDS[tf] ?? 300;
    const closeAtOrBefore = (tSec: number): number | null => {
      // binary search the last candle closing at/before tSec
      let lo = 0;
      let hi = candles.length - 1;
      if (tSec < candles[0].time) return null;
      let best = candles[0].close;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (candles[mid].time <= tSec) {
          best = candles[mid].close;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return best;
    };
    const seen = new Set<number>();
    const out: GradedMarker[] = [];
    for (const s of signals.slice(0, 40)) {
      const sigStep = TF_SECONDS[s.timeframe] ?? 900;
      const tSec = Math.floor(new Date(s.pushedAt).getTime() / 1000 / step) * step;
      if (seen.has(tSec)) continue;
      seen.add(tSec);
      const dir = s.score >= 0 ? 1 : -1;
      const probTxt = s.board?.find((b) => b.tf === s.timeframe)?.prob;
      const prob = probTxt != null ? `${Math.round(probTxt * 100)}%` : "";
      const entry = closeAtOrBefore(Math.floor(new Date(s.pushedAt).getTime() / 1000));
      const horizonSec = 3 * sigStep;
      const exit = closeAtOrBefore(Math.floor(new Date(s.pushedAt).getTime() / 1000) + horizonSec);
      let outcome: GradedMarker["outcome"] = "pending";
      let outcomeGlyph = "";
      if (entry != null && exit != null) {
        const movePct = ((exit - entry) / entry) * 100;
        if (Math.abs(movePct) < 0.1) outcome = "flat";
        else if ((movePct > 0 && dir > 0) || (movePct < 0 && dir < 0)) outcome = "hit";
        else outcome = "miss";
        outcomeGlyph = outcome === "hit" ? " ✓" : outcome === "miss" ? " ✗" : outcome === "flat" ? " ≈" : "";
      }
      out.push({
        outcome,
        marker: {
          time: tSec as Time,
          position: (dir > 0 ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
          color: REGIME_HEX[s.regime] ?? "#8b8f98",
          shape: (dir > 0 ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
          text: `${s.timeframe} ${dir > 0 ? "↑" : "↓"}${prob ? ` ${prob}` : ""}${outcomeGlyph}`,
          size: 1.4,
        },
      });
    }
    return out.sort((a, b) => (a.marker.time as number) - (b.marker.time as number));
  }, [signals, tf, candles]);

  useEffect(() => {
    apiRef.current?.series.setMarkers(graded.map((g) => g.marker));
  }, [graded]);

  // the model's key levels as horizontal reference lines
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    for (const line of priceLinesRef.current) {
      try {
        api.series.removePriceLine(line);
      } catch {
        /* chart disposed */
      }
    }
    priceLinesRef.current = [];
    if (!showLevels || !latest?.levels) return;
    const add = (price: number | undefined, color: string, title: string, style: 1 | 2 | 3 | 4) => {
      if (price == null || !Number.isFinite(price)) return;
      priceLinesRef.current.push(
        api.series.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: style, // 1 dashed, 2 dotted, 3 sparse-dotted, 4 solid
          axisLabelVisible: true,
          title,
        }),
      );
    };
    const lv = latest.levels;
    add(lv.resistance ? Number(lv.resistance) : undefined, "#dc2626", "R", 2);
    add(lv.support ? Number(lv.support) : undefined, "#16a34a", "S", 2);
    add(lv.pivot ? Number(lv.pivot) : undefined, "#8b8f98", "PP", 3);
    add(lv.donchianHigh ? Number(lv.donchianHigh) : undefined, "#64748b", "D20 H", 3);
    add(lv.donchianLow ? Number(lv.donchianLow) : undefined, "#64748b", "D20 L", 3);
  }, [latest, showLevels]);

  // forecast accountability + consensus strip
  const stats = useMemo(() => {
    const gradedOnly = graded.filter((g) => g.outcome === "hit" || g.outcome === "miss");
    const hits = gradedOnly.filter((g) => g.outcome === "hit").length;
    const hitRate = gradedOnly.length >= 3 ? Math.round((hits / gradedOnly.length) * 100) : null;
    const dirs = (latest?.board ?? []).reduce(
      (acc, b) => {
        if (b.regime.includes("up")) acc.up += 1;
        else if (b.regime.includes("down")) acc.down += 1;
        else acc.flat += 1;
        return acc;
      },
      { up: 0, down: 0, flat: 0 },
    );
    const lean =
      dirs.up > dirs.down ? "bullish lean" : dirs.down > dirs.up ? "bearish lean" : "balanced";
    return { hitRate, graded: gradedOnly.length, dirs, lean };
  }, [graded, latest]);

  const price = candles.at(-1)?.close ?? (latest?.price ? Number(latest.price) : null);
  const prev = candles.at(-2)?.close ?? price ?? 0;
  const up = price != null && price >= prev;

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-4 md:px-5">
      {/* header: price + regime + forecast accountability */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <h1 className="text-xl font-bold tracking-tight">ETHUSDT · Perp</h1>
          <span
            className={cn(
              "tnum text-2xl font-bold leading-none",
              up ? "text-success" : "text-destructive",
            )}
          >
            {formatPrice(price)}
          </span>
          {latest ? (
            <div className="flex items-center gap-1.5">
              <RegimeBadge regime={latest.regime} />
              <span className={cn("tnum text-xs font-semibold", regimeMeta(latest.regime).text)}>
                {formatScore(latest.score)}
              </span>
            </div>
          ) : null}
          {stats.hitRate != null ? (
            <span
              title="Direction arrows show what the model predicted at push time; ✓/✗ grades it against the realized price move over the next 3 signal-candles."
              className="tnum rounded-md border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground"
            >
              forecast hit-rate {stats.hitRate}% <span className="font-normal">(n={stats.graded})</span>
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {TFS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTf(t)}
              className={cn(
                "rounded-md px-1.5 py-1 text-[11px] font-semibold transition-colors",
                t === tf
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* consensus + overlay toggles */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {latest ? (
          <span className="rounded-md bg-muted/60 px-2 py-1">
            <span className="font-semibold text-muted-foreground">Consensus: </span>
            <span className="tnum">
              {stats.dirs.up}↑ {stats.dirs.down}↓ {stats.dirs.flat}→
            </span>{" "}
            <span
              className={cn(
                "font-semibold",
                stats.dirs.up > stats.dirs.down
                  ? "text-success"
                  : stats.dirs.down > stats.dirs.up
                    ? "text-destructive"
                    : "text-muted-foreground",
              )}
            >
              {stats.lean}
            </span>
            {latest.nhnl ? (
              <span className="ml-2 text-muted-foreground">
                {latest.nhnl.rows.filter((r) => r.nh || r.brkUp || r.donUp).length} windows at highs ·{" "}
                {latest.nhnl.rows.filter((r) => r.nl || r.brkDown || r.donDown).length} at lows
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
          <span className="text-[10px] uppercase tracking-wider">overlays</span>
          <button
            type="button"
            onClick={() => setShowEma((v) => !v)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold",
              showEma ? "bg-amber-500/15 text-amber-500" : "bg-muted",
            )}
          >
            EMA 20/50
          </button>
          <button
            type="button"
            onClick={() => setShowLevels((v) => !v)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold",
              showLevels ? "bg-sky-500/15 text-sky-500" : "bg-muted",
            )}
          >
            Key levels
          </button>
        </span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {error
          ? `⚠ ${error}`
          : updatedAt
            ? `refreshed ${new Date(updatedAt).toLocaleTimeString()} · candles 10s · signals 20s · `
            : "loading…"}
        <span className="hidden md:inline">
          arrows = model prediction at push time (↑/↓ + continuation %), ✓/✗ = actual outcome vs the
          next 3 candles · dashed lines = model key levels (R/S/PP/Donchian)
        </span>
      </p>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* chart — height scales with the viewport */}
        <div className="min-w-0">
          <div ref={chartDivRef} className="h-[clamp(320px,56vh,680px)] w-full" />
          {latest ? (
            <div className="mt-2 rounded-lg bg-muted/40 p-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Trend board · five timeframes (continuation % of the triggering model)
              </p>
              <div className="mt-1.5">
                <TrendBoard board={latest.board} highlightTf={latest.timeframe} />
              </div>
            </div>
          ) : null}
        </div>

        {/* right rail — plain language */}
        <div className="space-y-4">
          {latest ? (
            <>
              <section className="rounded-lg border border-border bg-card p-3">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  Is the price making new highs or lows? (per window)
                </p>
                {latest.nhnl ? (
                  <NhnlLadder nhnl={latest.nhnl} className="mt-1.5 [&>p:first-child]:hidden" />
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    ladder warming up — windows not ready on the producer yet
                  </p>
                )}
              </section>

              <section className="rounded-lg border border-border bg-card p-3">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  Key levels (from yesterday&apos;s range)
                </p>
                <dl className="tnum mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Resistance</dt>
                    <dd className="font-semibold">{formatPrice(latest.levels?.resistance ? Number(latest.levels.resistance) : null)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Support</dt>
                    <dd className="font-semibold">{formatPrice(latest.levels?.support ? Number(latest.levels.support) : null)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Pivot</dt>
                    <dd>{formatPrice(latest.levels?.pivot ? Number(latest.levels.pivot) : null)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">20-day channel</dt>
                    <dd>
                      {latest.levels?.breakout === "up"
                        ? "broke ↑"
                        : latest.levels?.breakout === "down"
                          ? "broke ↓"
                          : "inside"}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-lg border border-border bg-card p-3">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  Recent pushes (newest first)
                </p>
                <ul className="mt-1.5 space-y-1">
                  {signals.slice(0, 6).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-bold text-muted-foreground">
                          {s.timeframe}
                        </span>
                        <RegimeBadge regime={s.regime} />
                      </span>
                      <span className="tnum text-muted-foreground">
                        {new Date(s.pushedAt).toLocaleTimeString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : (
            <p className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
              no signals stored yet — the ladder and board appear after the
              first webhook push arrives
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
