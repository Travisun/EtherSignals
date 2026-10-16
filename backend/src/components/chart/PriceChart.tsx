'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import { useMarketStore, candleKey } from '@/lib/marketWs';
import { useChartPrefs, type DrawTool } from '@/stores/chart';
import { useI18n } from '@/i18n/provider';
import { computeIndicators } from '@/core/indicators';
import { fmtQty, tfSeconds } from '@/lib/format';
import type { Candle, MarketType, Timeframe } from '@/core/types';

const MA_PERIODS = [5, 10, 20, 60];
const MA_COLORS = ['#f59e0b', '#8b5cf6', '#3c6cf2', '#14b8a6'];
const EMA_COLORS = ['#ef4444', '#06b6d4', '#a3e635', '#f97316'];
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

interface Drawing {
  id: string;
  type: Exclude<DrawTool, 'cursor'>;
  p1: { time: number; price: number };
  p2?: { time: number; price: number };
}

interface PriceChartProps {
  marketType: MarketType;
  symbol: string;
  tf: Timeframe;
  upColor: string;
  downColor: string;
  /** position overlays drawn as horizontal price lines */
  positionLines?: { entry?: number | null; sl?: number | null; tp?: number | null } | null;
}

/** Professional candlestick chart: MAs / BOLL / volume / MACD-RSI-KDJ sub-pane + drawing tools. */
export function PriceChart({ marketType, symbol, tf, upColor, downColor, positionLines }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    candle?: ISeriesApi<'Candlestick'>;
    volume?: ISeriesApi<'Histogram'>;
    ma?: ISeriesApi<'Line'>[];
    ema?: ISeriesApi<'Line'>[];
    bollUpper?: ISeriesApi<'Line'>;
    bollMid?: ISeriesApi<'Line'>;
    bollLower?: ISeriesApi<'Line'>;
    subLines?: ISeriesApi<'Line'>[];
    subHist?: ISeriesApi<'Histogram'>;
    subPriceLines?: ReturnType<ISeriesApi<'Line'>['createPriceLine']>[];
  }>({});
  const lastApplied = useRef(0);
  const [precision, setPrecision] = useState(2);

  const prefs = useChartPrefs();
  const { t } = useI18n();
  const candles = useMarketStore((s) => s.candles[candleKey(marketType, symbol, tf)]);

  // ─── drawing state ─────────────────────────────────────────────────────────
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [pending, setPending] = useState<Drawing | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tickState, setTick] = useState(0);

  const storageKey = `gt.drawings.${marketType}.${symbol}`;

  useEffect(() => {
    try {
      setDrawings(JSON.parse(localStorage.getItem(storageKey) ?? '[]'));
    } catch {
      setDrawings([]);
    }
    setPending(null);
  }, [storageKey]);

  const persist = useCallback((next: Drawing[]) => {
    setDrawings(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // quota; ignore
    }
  }, [storageKey]);

  // precision from instrument
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/market/instrument?marketType=${marketType}&symbol=${symbol}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) {
          const p = j.data?.instrument?.pricePrecision;
          if (typeof p === 'number' && p >= 0) setPrecision(Math.min(p, 8));
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [marketType, symbol]);

  // "clear drawings" toolbar action for the active symbol
  useEffect(() => {
    const onClear = () => persist([]);
    window.addEventListener('gt:drawings-cleared', onClear);
    return () => window.removeEventListener('gt:drawings-cleared', onClear);
  }, [persist]);

  // ─── chart lifecycle ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#6b7280',
        fontSize: 11,
        fontFamily: "ui-sans-serif, -apple-system, 'PingFang SC', sans-serif",
      },
      grid: {
        vertLines: { color: '#f3f4f6' },
        horzLines: { color: '#f3f4f6' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#9ca3af', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1f2937' },
        horzLine: { color: '#9ca3af', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1f2937' },
      },
      rightPriceScale: { borderColor: '#e5e7eb', scaleMargins: { top: 0.08, bottom: 0.32 } },
      timeScale: { borderColor: '#e5e7eb', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
      autoSize: true,
    });
    chartRef.current = chart;

    const s = seriesRef.current;
    s.candle = chart.addCandlestickSeries({
      upColor, downColor, wickUpColor: upColor, wickDownColor: downColor,
      borderVisible: false,
      priceFormat: { type: 'price', precision, minMove: Math.pow(10, -precision) },
    });
    // NOTE: price scale options may only be applied AFTER a series with that
    // scale id exists — 'sub' is configured when sub-pane lines are created.
    s.volume = chart.addHistogramSeries({
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      color: '#9ca3af',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    s.volume.applyOptions({ visible: prefs.volume });

    lastApplied.current = 0;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = {};
      lastApplied.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // volume visibility toggle
  useEffect(() => {
    seriesRef.current.volume?.applyOptions({ visible: useChartPrefs.getState().volume });
  }, [prefs.volume]);

  // ─── position overlays (entry / SL / TP price lines) ─────────────────────
  const posLinesRef = useRef<{ sig: string; lines: ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[] }>({ sig: '', lines: [] });
  useEffect(() => {
    const candle = seriesRef.current.candle;
    if (!candle) return;
    const e = positionLines?.entry ?? null;
    const sl = positionLines?.sl ?? null;
    const tp = positionLines?.tp ?? null;
    const sig = `${e ?? ''}|${sl ?? ''}|${tp ?? ''}`;
    if (posLinesRef.current.sig === sig) return;
    for (const line of posLinesRef.current.lines) {
      try {
        candle.removePriceLine(line);
      } catch {
        // series already removed
      }
    }
    const lines: ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[] = [];
    if (e && e > 0) {
      lines.push(candle.createPriceLine({ price: e, color: '#3c6cf2', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: t('trade.costLine') }));
    }
    if (sl && sl > 0) {
      lines.push(candle.createPriceLine({ price: sl, color: downColor, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: t('trade.slLine') }));
    }
    if (tp && tp > 0) {
      lines.push(candle.createPriceLine({ price: tp, color: upColor, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: t('trade.tpLine') }));
    }
    posLinesRef.current = { sig, lines };
  }, [positionLines, upColor, downColor, t]);

  // precision change → apply to candle series
  useEffect(() => {
    seriesRef.current.candle?.applyOptions({
      priceFormat: { type: 'price', precision, minMove: Math.pow(10, -precision) },
    });
  }, [precision]);

  // ─── data binding ──────────────────────────────────────────────────────────
  useEffect(() => {
    const s = seriesRef.current;
    if (!s.candle || !s.volume) return;
    if (!candles || candles.length === 0) {
      s.candle.setData([]);
      s.volume.setData([]);
      lastApplied.current = 0;
      return;
    }
    // last-resort guard: lightweight-charts throws on non-ascending or
    // duplicate times — sanitize before touching either series
    const clean: Candle[] = [];
    for (const c of candles) {
      const prev = clean.at(-1);
      if (prev && c.time === prev.time) clean[clean.length - 1] = c;
      else if (!prev || c.time > prev.time) clean.push(c);
      else if (c.time < prev.time) {
        // out-of-order segment: rebuild via sort+dedup (rare path)
        const map = new Map<number, Candle>();
        for (const x of [...clean, c]) map.set(x.time, x);
        clean.length = 0;
        clean.push(...[...map.values()].sort((a, b) => a.time - b.time));
      }
    }
    const toSeries = (arr: Candle[]) =>
      arr.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));
    const last = clean.at(-1)!;
    if (lastApplied.current && last.time === lastApplied.current && clean.length >= 2) {
      s.candle.update({ time: last.time as UTCTimestamp, open: last.open, high: last.high, low: last.low, close: last.close });
      s.volume.update({
        time: last.time as UTCTimestamp,
        value: last.baseVol ?? 0,
        color: last.close >= last.open ? `${upColor}66` : `${downColor}66`,
      });
    } else {
      s.candle.setData(toSeries(clean));
      s.volume.setData(
        clean.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.baseVol ?? 0,
          color: c.close >= c.open ? `${upColor}66` : `${downColor}66`,
        })),
      );
      lastApplied.current = last.time;
    }
    // keep candle colors in sync with the up/down preference
    s.candle.applyOptions({ upColor, downColor, wickUpColor: upColor, wickDownColor: downColor });
  }, [candles, upColor, downColor]);

  // ─── indicators ────────────────────────────────────────────────────────────
  const indicatorData = useMemo(() => {
    if (!candles || candles.length < 10) return null;
    return {
      candles,
      ind: computeIndicators(candles, {
        maPeriods: MA_PERIODS,
        emaPeriods: MA_PERIODS,
        boll: true,
        rsi: true,
        macd: true,
        kdj: true,
      }),
    };
  }, [candles]);

  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!chart || !s.candle) return;

    const toLine = (arr: (number | null)[]) => {
      const out: { time: UTCTimestamp; value: number }[] = [];
      const candlesArr = candles ?? [];
      for (let i = 0; i < candlesArr.length; i++) {
        const v = arr[i];
        if (v != null && Number.isFinite(v)) out.push({ time: candlesArr[i].time as UTCTimestamp, value: v });
      }
      return out;
    };

    // MA / EMA lines
    const ensureLines = (
      key: 'ma' | 'ema',
      colors: string[],
      enabled: boolean,
    ): ISeriesApi<'Line'>[] => {
      const existing = s[key];
      if (!enabled) {
        existing?.forEach((l) => chart.removeSeries(l));
        s[key] = undefined;
        return [];
      }
      if (existing?.length) return existing;
      const lines = colors.map((color) =>
        chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      );
      s[key] = lines;
      return lines;
    };

    if (!indicatorData) return;
    const { ind } = indicatorData;

    MA_PERIODS.forEach((_, i) => {
      const lines = ensureLines('ma', MA_COLORS, prefs.ma);
      lines[i]?.setData(toLine(ind.ma?.[i] ?? []));
    });
    MA_PERIODS.forEach((_, i) => {
      const lines = ensureLines('ema', EMA_COLORS, prefs.ema);
      lines[i]?.setData(toLine(ind.ema?.[i] ?? []));
    });

    // BOLL
    if (!prefs.boll) {
      if (s.bollUpper) { chart.removeSeries(s.bollUpper); s.bollUpper = undefined; }
      if (s.bollMid) { chart.removeSeries(s.bollMid); s.bollMid = undefined; }
      if (s.bollLower) { chart.removeSeries(s.bollLower); s.bollLower = undefined; }
    } else {
      if (!s.bollUpper) {
        s.bollUpper = chart.addLineSeries({ color: '#94a3b8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.bollMid = chart.addLineSeries({ color: '#64748b', lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.bollLower = chart.addLineSeries({ color: '#94a3b8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      }
      s.bollUpper?.setData(toLine(ind.boll?.upper ?? []));
      s.bollMid?.setData(toLine(ind.boll?.mid ?? []));
      s.bollLower?.setData(toLine(ind.boll?.lower ?? []));
    }

    // Sub-pane: MACD / RSI / KDJ
    if (prefs.sub === 'none') {
      s.subLines?.forEach((l) => chart.removeSeries(l));
      if (s.subHist) chart.removeSeries(s.subHist);
      s.subLines = undefined;
      s.subHist = undefined;
      s.subPriceLines = undefined;
    } else {
      if (!s.subLines?.length) {
        s.subLines = [
          chart.addLineSeries({ color: '#3c6cf2', lineWidth: 1, priceScaleId: 'sub', priceLineVisible: false, lastValueVisible: false }),
          chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceScaleId: 'sub', priceLineVisible: false, lastValueVisible: false }),
        ];
        s.subHist = chart.addHistogramSeries({ priceScaleId: 'sub', color: '#9ca3af' });
        // the 'sub' scale exists now that series reference it
        chart.priceScale('sub').applyOptions({ scaleMargins: { top: 0.64, bottom: 0.2 } });
      }
      // drop previous RSI guide lines before re-applying
      if (s.subPriceLines) {
        for (const pl of s.subPriceLines) s.subLines[0]?.removePriceLine(pl);
        s.subPriceLines = undefined;
      }
      const [lineA, lineB, hist] = [s.subLines[0], s.subLines[1], s.subHist];
      if (prefs.sub === 'macd') {
        lineA?.setData(toLine(ind.macd?.macd ?? []));
        lineB?.setData(toLine(ind.macd?.signal ?? []));
        hist?.setData(
          (candles ?? []).map((c, i) => ({
            time: c.time as UTCTimestamp,
            value: ind.macd?.hist?.[i] ?? 0,
            color: (ind.macd?.hist?.[i] ?? 0) >= 0 ? `${upColor}88` : `${downColor}88`,
          })).filter((d) => Number.isFinite(d.value)),
        );
      } else if (prefs.sub === 'rsi') {
        lineA?.setData(toLine(ind.rsi ?? []));
        lineB?.setData([]);
        hist?.setData([]);
        if (lineA) {
          s.subPriceLines = [
            lineA.createPriceLine({ price: 70, color: '#d1d5db', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false }),
            lineA.createPriceLine({ price: 30, color: '#d1d5db', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false }),
          ];
        }
      } else {
        // kdj
        lineA?.setData(toLine(ind.kdj?.k ?? []));
        lineB?.setData(toLine(ind.kdj?.d ?? []));
        hist?.setData(toLine(ind.kdj?.j ?? []).map((d) => ({ ...d })));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicatorData, prefs.ma, prefs.ema, prefs.boll, prefs.sub, upColor, downColor]);

  // ─── drawing interaction ───────────────────────────────────────────────────

  const coordsFor = useCallback((d: Drawing) => {
    const chart = chartRef.current;
    const candle = seriesRef.current.candle;
    if (!chart || !candle) return null;
    const ts = chart.timeScale();
    const x1 = ts.timeToCoordinate(d.p1.time as UTCTimestamp);
    const y1 = candle.priceToCoordinate(d.p1.price);
    if (x1 == null || y1 == null) return null;
    let x2: number | null = null;
    let y2: number | null = null;
    if (d.p2) {
      x2 = ts.timeToCoordinate(d.p2.time as UTCTimestamp);
      y2 = candle.priceToCoordinate(d.p2.price);
    }
    return { x1, y1, x2, y2 };
  }, []);

  // rAF loop to keep drawings glued while panning/zooming
  useEffect(() => {
    if (!drawings.length && !pending) return;
    let raf = 0;
    const loop = () => {
      setTick((t) => (t + 1) % 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [drawings.length, pending]);

  const pointFromEvent = useCallback((e: React.MouseEvent) => {
    const chart = chartRef.current;
    const candle = seriesRef.current.candle;
    const svg = svgRef.current;
    if (!chart || !candle || !svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const time = chart.timeScale().coordinateToTime(x);
    const price = candle.coordinateToPrice(y);
    if (price == null) return null;
    const candlesArr = candles ?? [];
    const tfSec = tfSeconds(tf);
    const timeNum = time != null ? Math.floor(Number(time)) : Math.floor((candlesArr.at(-1)?.time ?? 0) + tfSec);
    return { time: timeNum, price: Number(price), x, y };
  }, [candles, tf]);

  const onSvgClick = useCallback((e: React.MouseEvent) => {
    const tool = useChartPrefs.getState().tool;
    if (tool === 'cursor') return;
    const pt = pointFromEvent(e);
    if (!pt) return;

    if (tool === 'hline') {
      persist([...drawings, { id: `d${Date.now()}${Math.random().toString(36).slice(2, 5)}`, type: 'hline', p1: { time: pt.time, price: pt.price } }]);
      useChartPrefs.getState().set({ tool: 'cursor' });
      return;
    }
    if (!pending) {
      setPending({ id: `pending${Math.random().toString(36).slice(2, 8)}`, type: tool, p1: { time: pt.time, price: pt.price } });
      return;
    }
    // second click completes the shape
    const done: Drawing = { ...pending, p2: { time: pt.time, price: pt.price } };
    persist([...drawings, done]);
    setPending(null);
    useChartPrefs.getState().set({ tool: 'cursor' });
  }, [drawings, pending, persist, pointFromEvent]);

  const onSvgMove = useCallback((e: React.MouseEvent) => {
    if (!pending) return;
    const pt = pointFromEvent(e);
    if (pt) setPending({ ...pending, p2: { time: pt.time, price: pt.price } });
  }, [pending, pointFromEvent]);

  // render SVG shapes (tickState forces recomputation while panning/zooming)
  const shapes = useMemo(() => {
    void tickState;
    const all = pending ? [...drawings, pending] : drawings;
    const out: React.ReactNode[] = [];
    const width = svgRef.current?.clientWidth ?? 800;
    for (const d of all) {
      const c = coordsFor(d);
      if (!c) continue;
      const key = d.id;
      if (d.type === 'hline') {
        out.push(
          <g key={key}>
            <line x1={0} x2={width} y1={c.y1} y2={c.y1} stroke="#3c6cf2" strokeWidth={1} strokeDasharray="4 3" />
            <rect x={width - 72} y={c.y1 - 8} width={72} height={16} rx={2} fill="#3c6cf2" opacity={0.9} />
            <text x={width - 66} y={c.y1 + 3.5} fontSize={9} fill="#fff" fontFamily="monospace">
              {fmtQty(d.p1.price, 6)}
            </text>
          </g>,
        );
      } else if (c.x2 != null && c.y2 != null) {
        if (d.type === 'trend' || d.type === 'ray') {
          out.push(
            <line key={key} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="#7c3aed" strokeWidth={1.4} />,
          );
          if (d.type === 'ray' && c.x2 !== c.x1) {
            const slope = (c.y2 - c.y1) / (c.x2 - c.x1);
            const endX = slope >= 0 ? width : 0;
            out.push(
              <line key={`${key}-ray`} x1={c.x2} y1={c.y2} x2={endX} y2={c.y2 + slope * (endX - c.x2)} stroke="#7c3aed" strokeWidth={1.4} strokeDasharray="5 4" />,
            );
          }
        } else if (d.type === 'rect') {
          const x = Math.min(c.x1, c.x2);
          const y = Math.min(c.y1, c.y2);
          out.push(
            <rect key={key} x={x} y={y} width={Math.abs(c.x2 - c.x1)} height={Math.abs(c.y2 - c.y1)} fill="#3c6cf21a" stroke="#3c6cf2" strokeWidth={1} />,
          );
        } else if (d.type === 'fib') {
          const hi = Math.max(d.p1.price, d.p2!.price);
          const lo = Math.min(d.p1.price, d.p2!.price);
          const left = Math.min(c.x1, c.x2);
          FIB_LEVELS.forEach((lv) => {
            const price = lo + (hi - lo) * lv;
            const candle = seriesRef.current.candle;
            const y = candle?.priceToCoordinate(price);
            if (y == null) return;
            out.push(
              <g key={`${key}-${lv}`}>
                <line x1={left} x2={width} y1={y} y2={y} stroke={lv === 0.5 ? '#f59e0b' : '#94a3b8'} strokeWidth={1} strokeDasharray="3 3" />
                <text x={left + 4} y={y - 2} fontSize={9} fill="#64748b" fontFamily="monospace">
                  {(lv * 100).toFixed(1)}% · {fmtQty(price, 6)}
                </text>
              </g>,
            );
          });
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawings, pending, coordsFor, precision, tickState]);

  const drawingActive = prefs.tool !== 'cursor';

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <svg
        ref={svgRef}
        className={`absolute inset-0 h-full w-full ${drawingActive ? 'cursor-crosshair' : 'pointer-events-none'}`}
        onClick={onSvgClick}
        onMouseMove={onSvgMove}
      >
        {shapes}
      </svg>
      {drawingActive && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-gray-900/80 px-3 py-1 text-2xs text-white">
          {pending ? t('trade.clickToFinish') : t('trade.clickToStart')} · {t('trade.escToCancel')}
        </div>
      )}
      <EscapeHandler onEsc={() => { setPending(null); useChartPrefs.getState().set({ tool: 'cursor' }); }} />
    </div>
  );
}

function EscapeHandler({ onEsc }: { onEsc: () => void }) {
  React.useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && onEsc();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onEsc]);
  return null;
}

export function clearDrawingsFor(marketType: MarketType, symbol: string) {
  try {
    localStorage.removeItem(`gt.drawings.${marketType}.${symbol}`);
  } catch {
    // ignore
  }
}
