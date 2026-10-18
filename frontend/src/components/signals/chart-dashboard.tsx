"use client";

/**
 * Professional one-glance chart dashboard: ETHUSDT candles with every signal
 * push marked on the price line, plus a right rail carrying the full model
 * state — trend board, NHNL ladder, key levels. Data: 10s candle polling
 * (server memory cache + 1 req/10s/IP) and a 20s feed poll from our own DB.
 */

import { useEffect, useRef, useState } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { SignalDTO } from "@/lib/signals/dto";
import { NhnlLadder } from "@/components/signals/nhnl-ladder";
import { RegimeBadge, TrendBoard, formatScore, regimeMeta } from "@/components/signals/regime";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";

const TF_SECONDS: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400,
};
const TFS = Object.keys(TF_SECONDS);

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

export function ChartDashboard({ initialSignals }: { initialSignals: SignalDTO[] }) {
  const [tf, setTf] = useState("5m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [signals, setSignals] = useState<SignalDTO[]>(initialSignals);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const chartDivRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<{
    chart: IChartApi;
    series: ISeriesApi<"Candlestick">;
    volume: ISeriesApi<"Histogram">;
  } | null>(null);
  const fittedForTf = useRef<string | null>(null);

  const latest = signals[0] ?? null;

  // candles: poll every 10s — matches the server's per-IP window exactly
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/market/candles?tf=${tf}&limit=300`);
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
    apiRef.current = { chart, series, volume };
    return () => {
      chart.remove();
      apiRef.current = null;
    };
  }, []);

  // candle data → series (fit zoom once per timeframe switch)
  useEffect(() => {
    const api = apiRef.current;
    if (!api || candles.length === 0) return;
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
    if (fittedForTf.current !== tf) {
      api.chart.timeScale().fitContent();
      fittedForTf.current = tf;
    }
  }, [candles, tf]);

  // signal pushes → markers on the price line
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const step = TF_SECONDS[tf] ?? 300;
    const seen = new Set<number>();
    const markers = signals
      .slice(0, 40)
      .map((s) => ({
        time: (Math.floor(new Date(s.pushedAt).getTime() / 1000 / step) * step) as UTCTimestamp,
        position: (s.score >= 0 ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
        color: REGIME_HEX[s.regime] ?? "#8b8f98",
        shape: "circle" as const,
        text: `${s.timeframe} ${formatScore(s.score)}`,
      }))
      .filter((m) => {
        if (seen.has(m.time)) return false;
        seen.add(m.time);
        return true;
      })
      .sort((a, b) => (a.time as number) - (b.time as number));
    api.series.setMarkers(markers);
  }, [signals, tf, candles.length]);

  const price = candles.at(-1)?.close ?? (latest?.price ? Number(latest.price) : null);
  const prev = candles.at(-2)?.close ?? price ?? 0;
  const up = price != null && price >= prev;

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-4 md:px-5">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-3">
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
        </div>
        <div className="flex items-center gap-1">
          {TFS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTf(t)}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
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
      <p className="mt-1 text-[10px] text-muted-foreground">
        {error
          ? `⚠ ${error}`
          : updatedAt
            ? `refreshed ${new Date(updatedAt).toLocaleTimeString()} · candles 10s · signals 20s`
            : "loading…"}
      </p>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* chart */}
        <div className="min-w-0">
          <div ref={chartDivRef} className="h-[420px] w-full md:h-[520px]" />
          {latest ? (
            <div className="mt-2 rounded-lg bg-muted/40 p-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Trend board · five timeframes
              </p>
              <div className="mt-1.5">
                <TrendBoard board={latest.board} highlightTf={latest.timeframe} />
              </div>
            </div>
          ) : null}
        </div>

        {/* right rail */}
        <div className="space-y-4">
          {latest ? (
            <>
              <section className="rounded-lg border border-border bg-card p-3">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  New high / low ladder
                </p>
                {latest.nhnl ? (
                  <NhnlLadder nhnl={latest.nhnl} className="mt-1.5 [&>p]:hidden" />
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    ladder warming up — windows not ready on the producer yet
                  </p>
                )}
              </section>

              <section className="rounded-lg border border-border bg-card p-3">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  Key levels (daily)
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
                    <dt className="text-muted-foreground">Donchian</dt>
                    <dd>
                      {latest.levels?.breakout === "up"
                        ? "broken ↑"
                        : latest.levels?.breakout === "down"
                          ? "broken ↓"
                          : "inside"}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-lg border border-border bg-card p-3">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  Recent pushes
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
