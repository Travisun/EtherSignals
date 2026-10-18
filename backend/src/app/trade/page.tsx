'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Card, Badge } from '@/components/ui/primitives';
import { Tabs, Segmented } from '@/components/ui/tabs';
import { Drawer } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PriceChart, clearDrawingsFor } from '@/components/chart/PriceChart';
import { TradingViewEmbed } from '@/components/chart/TradingViewEmbed';
import { OrderBook, TradesTape } from '@/components/trade/OrderBook';
import { OrderForm } from '@/components/trade/OrderForm';
import { PositionsTable, OrdersTable } from '@/components/trade/TradePanels';
import { SignalStrip } from '@/components/trade/SignalStrip';
import { NhnlStrip } from '@/components/trade/NhnlStrip';
import { useSignals } from '@/stores/signals';
import { useMarketStore, marketKey, loadCandles, loadBook, loadTrades, loadTickers, useMarketSubscriptions } from '@/lib/marketWs';
import { useChartPrefs, type DrawTool } from '@/stores/chart';
import { useTradeIntent } from '@/stores/tradeIntent';
import { usePrefs, upDownColors } from '@/stores/prefs';
import { useAccountStore } from '@/stores/account';
import { useOrders, cancelOrderApi, closePositionApi } from '@/hooks/useOrders';
import { fmtAmount, fmtPrice, fmtCompact, fmtSignedPct } from '@/lib/format';
import { TIMEFRAMES } from '@/core/types';
import {
  ArrowLeftRight, Eraser, MousePointer2, Slash, Square, TrendingUp,
  MoveUpRight, AlignHorizontalDistributeCenter, X,
} from 'lucide-react';
import type { MarketType, PositionRecord, Timeframe } from '@/core/types';

export default function TradePage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const intent = useTradeIntent();
  const generalDefaults = useDefaultPrefs();

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [marketType, setMarketType] = useState<MarketType>('futures');
  const [tf, setTf] = useState<Timeframe>('15m');
  const [leverage, setLeverage] = useState(5);
  const [mobileView, setMobileView] = useState<'chart' | 'form' | 'book'>('chart');
  const [panelTab, setPanelTab] = useState('pos');
  const [formDrawer, setFormDrawer] = useState<'buy' | 'sell' | null>(null);
  // multi-chart workbench: pane 0 follows the page symbol/tf; extra panes pin
  // their own (symbol ?? page symbol, tf) — persisted as a workspace layout.
  // Restored after mount (not in the initializer) to avoid an SSR mismatch.
  const [layout, setLayout] = useState<PaneLayout>(1);
  const [extras, setExtras] = useState<ExtraPane[]>([]);
  useEffect(() => {
    const saved = restorePanes();
    setLayout(saved.layout);
    setExtras(saved.extras);
  }, []);
  // desktop tab 'hist' maps to 'pos' in the compact mobile panel
  const mobileTab = panelTab === 'hist' ? 'pos' : panelTab;

  useEffect(() => {
    if (intent.symbol) setSymbol(intent.symbol);
    if (intent.marketType) setMarketType(intent.marketType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // apply workspace defaults once the settings load (asynchronous on mount)
  const appliedDefaults = React.useRef(false);
  useEffect(() => {
    if (appliedDefaults.current || !generalDefaults) return;
    appliedDefaults.current = true;
    if (!intent.symbol) {
      setSymbol(generalDefaults.defaultSymbol);
      setMarketType(generalDefaults.defaultMarketType);
      setTf(generalDefaults.defaultTimeframe);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generalDefaults]);

  // persist the multi-chart workspace
  useEffect(() => {
    try {
      localStorage.setItem(PANES_KEY, JSON.stringify({ layout, extras }));
    } catch {
      // quota; ignore
    }
  }, [layout, extras]);

  // resolved pane descriptors (pane 0 = page symbol/tf)
  const panes: ChartPane[] = useMemo(() => {
    const list: ChartPane[] = [{ id: 'p0', tf, symbol, main: true }];
    for (let i = 0; i < layout - 1; i++) {
      const e = extras[i];
      list.push({ id: `p${i + 1}`, tf: e?.tf ?? tf, symbol: e?.symbol ?? symbol, main: false });
    }
    return list;
  }, [tf, symbol, layout, extras]);

  // data bootstrap — one candle window per pane (+ book/trades for the page symbol)
  const paneSig = panes.map((p) => `${p.symbol}|${p.tf}`).join(',');
  useEffect(() => {
    const quiet = (p: Promise<void>) => p.catch(() => undefined);
    void quiet(loadCandles(marketType, symbol, tf));
    void quiet(loadBook(marketType, symbol));
    void quiet(loadTrades(marketType, symbol));
    for (const p of panes) {
      if (!p.main) void quiet(loadCandles(marketType, p.symbol, p.tf));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketType, paneSig]);

  // realtime insurance: WS pushes are live, but sleep/tab-background can
  // drop frames — reconcile candles (and book) against REST periodically
  useEffect(() => {
    const reconcile = () => {
      for (const p of panes) void loadCandles(marketType, p.symbol, p.tf).catch(() => undefined);
      void loadBook(marketType, symbol).catch(() => undefined);
    };
    const timer = setInterval(reconcile, 30_000);
    const onVisible = () => document.visibilityState === 'visible' && reconcile();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketType, paneSig, symbol]);

  // ticker universe for the symbol picker (markets page normally seeds this)
  useEffect(() => {
    void loadTickers(marketType);
  }, [marketType]);

  useMarketSubscriptions([
    { channel: 'ticker', marketType, instId: symbol },
    { channel: 'books15', marketType, instId: symbol },
    { channel: 'trade', marketType, instId: symbol },
    // candle subs carry the logical tf — the server relays already-aggregated
    // windows (incl. synthetics 2m/2h/8h/2d) keyed `${marketType}:${symbol}:${tf}`
    ...panes.map((p) => ({ channel: 'candle', tf: p.tf, marketType, instId: p.symbol })),
  ]);

  const ticker = useMarketStore((s) => s.tickers[marketKey(marketType, symbol)]);
  const { up, down } = upDownColors(usePrefs((s) => s.upDown), locale);
  const positions = useAccountStore((s) => s.positions);
  const orders = useOrders(marketType, { pollMs: 10_000 });
  const prefs = useChartPrefs();

  const symbolPositions = positions.filter((p) => p.symbol === symbol);

  const onClose = async (p: PositionRecord) => {
    const res = await closePositionApi(p.symbol, p.side, p.available, p.paper);
    if (res.ok) toast.success(t('positions.closeSuccess'));
    else toast.error(t('positions.closeFailed'), res.error);
    void useAccountStore.getState().refresh();
  };

  const onCancel = async (o: { orderId: string; symbol: string }) => {
    const res = await cancelOrderApi(o.orderId, o.symbol, marketType);
    if (res.ok) toast.success(t('trade.orderCanceled'));
    else toast.error(t('ordersPage.cancelFailed'), res.error);
    orders.reload();
  };

  const change = ticker?.change24h ?? 0;
  const tone = change >= 0 ? 'text-up' : 'text-down';

  // position overlays for the chart (cost / SL / TP lines)
  const pos = symbolPositions[0];
  const positionLines = pos
    ? {
        entry: pos.openPriceAvg,
        sl: pos.slPct ? pos.openPriceAvg * (1 + (pos.side === 'long' ? -1 : 1) * pos.slPct / 100) : null,
        tp: pos.tpPct ? pos.openPriceAvg * (1 + (pos.side === 'long' ? 1 : -1) * pos.tpPct / 100) : null,
      }
    : null;

  const openForm = (side: 'buy' | 'sell') => setFormDrawer(side);
  // reactive viewport probe for the order-form drawer side
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* symbol header */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-gray-200 bg-white px-4 py-2.5">
        <SymbolPicker symbol={symbol} marketType={marketType} onPick={(s, mt) => { setSymbol(s); setMarketType(mt); }} />
        <div className="flex items-baseline gap-2">
          <span className={cn('font-mono text-xl font-bold tabular-nums', tone)}>{fmtPrice(ticker?.last, locale)}</span>
          <span className={cn('text-xs font-medium tabular-nums', tone)}>{fmtSignedPct(change, locale)}</span>
        </div>
        <div className="hidden flex-wrap items-center gap-x-5 gap-y-1 sm:flex">
          <HeaderStat label={t('markets.high24h')} value={fmtPrice(ticker?.high24h, locale)} />
          <HeaderStat label={t('markets.low24h')} value={fmtPrice(ticker?.low24h, locale)} />
          <HeaderStat label={t('markets.volume')} value={`${fmtCompact(ticker?.baseVolume, locale)} ${symbol.replace(/USDT$/, '')}`} />
          {marketType === 'futures' && (
            <>
              <HeaderStat label={t('trade.markPrice')} value={fmtPrice(ticker?.indexPrice, locale)} />
              <HeaderStat
                label={t('trade.fundingRate')}
                value={fmtSignedPct(ticker?.fundingRate, locale, 4)}
                tone={(ticker?.fundingRate ?? 0) >= 0 ? 'text-up' : 'text-down'}
              />
            </>
          )}
        </div>
      </div>

      {/* mobile view switcher — also covers the md–lg stacked layout where
          the right rail is not visible alongside the chart */}
      <div className="border-b border-gray-200 bg-white px-3 py-2 lg:hidden">
        <Segmented
          block
          value={mobileView}
          onChange={(v) => setMobileView(v as typeof mobileView)}
          options={[
            { value: 'chart', label: t('trade.chart') },
            { value: 'form', label: t('trade.orderForm') },
            { value: 'book', label: t('trade.orderBook') },
          ]}
        />
      </div>

      {/* below lg the page stacks and the outer scroll takes over; at lg it
          becomes a fixed-height split with internal scrolling */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden">
        {/* chart column — multi-pane workbench grid */}
        <div
          className={cn(
            'min-h-[360px] min-w-0 flex-1 flex-col p-2 md:p-3 lg:min-h-0',
            mobileView === 'chart' ? 'flex' : 'hidden',
            'lg:flex',
          )}
        >
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SignalStrip
              className="border-b border-gray-100 px-3 py-1.5"
              onPickTf={(s) => {
                const snap = useSignals.getState().snapshot;
                if (snap && snap.symbol !== symbol) {
                  setSymbol(snap.symbol);
                  setMarketType(snap.marketType);
                }
                setTf(s.tf);
              }}
            />
            <NhnlStrip
              className="border-b border-gray-100 px-3 py-1.5"
              marketType={marketType}
              symbol={symbol}
              activeTf={tf}
              onPickTf={setTf}
            />
            <ChartToolbar
              symbol={symbol} marketType={marketType} tf={tf} onTf={setTf}
              layout={layout} onLayout={(n) => {
                setLayout(n);
                // grow/shrink the extras list, preferring timeframes not shown yet
                setExtras((old) => {
                  const next = old.slice(0, Math.max(0, n - 1));
                  const used = new Set([tf, ...next.map((e) => e.tf)]);
                  while (next.length < n - 1) {
                    const tf2 = EXTRA_TF_CANDIDATES.find((c) => !used.has(c)) ?? '1h';
                    used.add(tf2);
                    next.push({ tf: tf2, symbol: undefined });
                  }
                  return next;
                });
              }}
            />
            <div
              className={cn(
                'min-h-0 flex-1 overflow-y-auto lg:overflow-hidden',
                layout === 2 && 'grid grid-rows-2 max-lg:grid-rows-none max-lg:block lg:grid-rows-1 lg:grid-cols-2',
                layout === 4 && 'grid grid-rows-2 max-lg:grid-rows-none max-lg:block lg:grid-cols-2',
              )}
            >
              {panes.map((p, i) => (
                <div
                  key={p.id}
                  className={cn(
                    'relative min-h-0 border-gray-100',
                    i > 0 && 'border-t lg:border-t-0',
                    i === 1 && 'lg:border-l',
                    i === 2 && 'lg:border-t',
                    i === 3 && 'lg:border-t lg:border-l',
                    layout > 1 && 'h-[240px] lg:h-auto',
                  )}
                >
                  {p.main ? (
                    <div className="flex h-full flex-col">
                      <div className="min-h-0 flex-1">
                        {prefs.source === 'native' ? (
                          <PriceChart marketType={marketType} symbol={p.symbol} tf={p.tf} upColor={up} downColor={down} positionLines={positionLines} />
                        ) : (
                          <TradingViewEmbed symbol={p.symbol} tf={p.tf} />
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col">
                      <PaneToolbar
                        pane={p}
                        marketType={marketType}
                        onTf={(v) => setExtras((old) => old.map((e, j) => (j === i - 1 ? { ...e, tf: v } : e)))}
                        onSymbol={(s) => setExtras((old) => old.map((e, j) => (j === i - 1 ? { ...e, symbol: s } : e)))}
                        onRemove={() => {
                          setExtras((old) => old.filter((_, j) => j !== i - 1));
                          setLayout((n) => (n === 4 ? 2 : 1) as PaneLayout);
                        }}
                      />
                      <div className="min-h-0 flex-1">
                        <PriceChart marketType={marketType} symbol={p.symbol} tf={p.tf} upColor={up} downColor={down} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* bottom panels */}
          <Card className="mt-2 hidden md:mt-3 md:block">
            <Tabs
              tabs={[
                { key: 'pos', label: t('trade.positions'), badge: symbolPositions.length ? <Count n={symbolPositions.length} /> : undefined },
                { key: 'open', label: t('trade.openOrders'), badge: orders.pending.length ? <Count n={orders.pending.length} /> : undefined },
                { key: 'hist', label: t('trade.historyOrders') },
              ]}
              active={panelTab}
              onChange={setPanelTab}
              size="sm"
              className="px-2 pt-1"
            />
            <div className="max-h-56 overflow-y-auto">
              {panelTab === 'pos' && (
                <PositionsTable positions={symbolPositions} onClose={onClose} upTone="text-up" downTone="text-down" compact />
              )}
              {panelTab === 'open' && <OrdersTable orders={orders.pending} onCancel={onCancel} mode="pending" />}
              {panelTab === 'hist' && <OrdersTable orders={orders.history} mode="history" />}
            </div>
          </Card>
        </div>

        {/* right rail: trade actions + full-height order book */}
        <div
          className={cn(
            'flex w-full shrink-0 flex-col gap-2 border-gray-200 p-2 md:p-3 lg:w-[400px] lg:max-h-full lg:gap-3 lg:border-l lg:overflow-y-auto',
            mobileView === 'chart' ? 'hidden lg:flex' : 'flex',
          )}
        >
          <div className="grid grid-cols-2 gap-2">
            <Button variant="sell" size="lg" onClick={() => openForm('sell')}>
              {t('common.sell')} {fmtPrice(ticker?.bid, locale)}
            </Button>
            <Button variant="buy" size="lg" onClick={() => openForm('buy')}>
              {t('common.buy')} {fmtPrice(ticker?.ask, locale)}
            </Button>
          </div>

          <Card className="flex min-h-[320px] flex-1 flex-col overflow-hidden lg:min-h-[280px]">
            <div className="flex min-h-0 flex-1">
              <div className="min-w-0 flex-1">
                <OrderBook
                  marketType={marketType}
                  symbol={symbol}
                  onPickPrice={(p, sideHint) => useTradeIntent.getState().set({ prefill: { side: sideHint, price: p } })}
                />
              </div>
              <div className="hidden w-px bg-gray-100 sm:block" />
              <div className="hidden min-w-0 flex-1 sm:block">
                <TradesTape marketType={marketType} symbol={symbol} />
              </div>
            </div>
          </Card>

          <Card className="md:hidden">
            <Tabs tabs={[{ key: 'pos', label: t('trade.positions') }, { key: 'open', label: t('trade.openOrders') }]} active={mobileTab} onChange={(k) => setPanelTab(k)} size="sm" className="px-2 pt-1" />
            <div className="max-h-64 overflow-y-auto">
              {mobileTab === 'pos' ? (
                <PositionsTable positions={symbolPositions} onClose={onClose} upTone="text-up" downTone="text-down" compact />
              ) : (
                <OrdersTable orders={orders.pending} onCancel={onCancel} mode="pending" />
              )}
            </div>
          </Card>

          <div className="hidden text-2xs text-gray-400 lg:block">
            <Link href="/strategies" className="text-brand-600 hover:underline">{t('nav.strategies')}</Link>
            {' · '}
            <Link href="/bots" className="text-brand-600 hover:underline">{t('nav.bots')}</Link>
            {' · '}
            <Link href="/assistant" className="text-brand-600 hover:underline">{t('nav.assistant')}</Link>
          </div>
        </div>
      </div>

      {/* order form drawer */}
      <Drawer
        open={formDrawer !== null}
        onClose={() => setFormDrawer(null)}
        side={compact ? 'bottom' : 'right'}
        width="w-[400px] max-w-[94vw]"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <span className="text-sm font-semibold">{symbol} · {t('trade.orderForm')}</span>
          <button onClick={() => setFormDrawer(null)} className="rounded p-1 text-gray-400 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(88dvh-53px)] overflow-y-auto">
          <OrderForm
            symbol={symbol}
            marketType={marketType}
            leverage={leverage}
            initialSide={formDrawer ?? undefined}
            onLeverageChange={setLeverage}
          />
        </div>
      </Drawer>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-2xs text-gray-500">{n}</span>;
}

// ─── Multi-chart workbench state ─────────────────────────────────────────────

type PaneLayout = 1 | 2 | 4;
interface ExtraPane { tf: Timeframe; symbol?: string }
interface ChartPane { id: string; tf: Timeframe; symbol: string; main: boolean }

const PANES_KEY = 'gt.tradePanes';
const EXTRA_TF_CANDIDATES: Timeframe[] = ['1h', '4h', '15m', '1d', '5m', '30m'];

function restorePanes(): { layout: PaneLayout; extras: ExtraPane[] } {
  if (typeof window === 'undefined') return { layout: 1, extras: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(PANES_KEY) ?? '{}');
    const layout = raw.layout === 2 || raw.layout === 4 ? (raw.layout as PaneLayout) : 1;
    const extras = Array.isArray(raw.extras)
      ? raw.extras
          .filter((e: unknown): e is ExtraPane => Boolean(e) && typeof (e as ExtraPane).tf === 'string')
          .slice(0, 3)
      : [];
    return { layout, extras: extras.slice(0, layout - 1) };
  } catch {
    return { layout: 1, extras: [] };
  }
}

/** Compact per-pane toolbar for secondary chart panes (tf / symbol / remove). */
function PaneToolbar({
  pane, marketType, onTf, onSymbol, onRemove,
}: {
  pane: ChartPane;
  marketType: MarketType;
  onTf: (tf: Timeframe) => void;
  onSymbol: (s: string) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const tickers = useMarketStore((s) => s.tickers);
  const options = useMemo(
    () =>
      Object.entries(tickers)
        .filter(([k]) => k.startsWith(marketType === 'spot' ? 'spot:' : 'futures:'))
        .sort((a, b) => b[1].quoteVolume - a[1].quoteVolume)
        .slice(0, 100)
        .map(([, tk]) => tk.symbol),
    [tickers, marketType],
  );
  if (!options.includes(pane.symbol)) options.unshift(pane.symbol);

  return (
    <div className="flex items-center gap-1 border-b border-gray-100 bg-gray-50/60 px-1.5 py-1">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {TIMEFRAMES.map((v) => (
          <button
            key={v}
            onClick={() => onTf(v)}
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium transition-colors',
              v === pane.tf ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700',
            )}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </div>
      <select
        value={pane.symbol}
        onChange={(e) => onSymbol(e.target.value)}
        className="h-5 shrink-0 rounded border border-gray-200 bg-white px-1 text-2xs font-medium text-gray-700 outline-none"
      >
        {!options.includes(pane.symbol) && <option value={pane.symbol}>{pane.symbol}</option>}
        {options.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <button
        onClick={onRemove}
        title={t('common.close')}
        className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function HeaderStat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xs text-gray-400">{label}</span>
      <span className={cn('text-xs tabular-nums text-gray-700', tone)}>{value}</span>
    </div>
  );
}

function useDefaultPrefs() {
  const [defaults, setDefaults] = useState<{ defaultSymbol: string; defaultMarketType: MarketType; defaultTimeframe: Timeframe } | null>(null);
  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((j) => {
      if (j?.ok) setDefaults(j.data.settings.general);
    }).catch(() => undefined);
  }, []);
  return defaults;
}

// ─── Symbol picker with search ───────────────────────────────────────────────

function SymbolPicker({ symbol, marketType, onPick }: { symbol: string; marketType: MarketType; onPick: (s: string, mt: MarketType) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const tickers = useMarketStore((s) => s.tickers);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const list = useMemo(() => {
    const q = query.trim().toUpperCase();
    return Object.entries(tickers)
      .filter(([k, tk]) => k.startsWith(marketType === 'spot' ? 'spot:' : 'futures:') && (!q || tk.symbol.includes(q)))
      .sort((a, b) => b[1].quoteVolume - a[1].quoteVolume)
      .slice(0, 50);
  }, [tickers, marketType, query]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 transition-colors hover:bg-gray-50">
        <ArrowLeftRight className="h-3.5 w-3.5 text-gray-400" />
        <span className="text-sm font-bold">{symbol}</span>
        <Badge tone="brand">{marketType === 'spot' ? t('markets.spot') : t('markets.futures')}</Badge>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-xl border border-gray-200 bg-white shadow-pop">
          <div className="border-b border-gray-100 p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('common.searchPlaceholder')}
              className="h-8 w-full rounded-lg border border-gray-200 px-3 text-xs focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {list.map(([k, tk]) => (
              <button
                key={k}
                onClick={() => {
                  onPick(tk.symbol, marketType);
                  setOpen(false);
                  setQuery('');
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-gray-50"
              >
                <span className="font-medium text-gray-800">{tk.symbol}</span>
                <span className="tabular-nums text-gray-500">{fmtPrice(tk.last)}</span>
              </button>
            ))}
            {!list.length && <div className="px-3 py-6 text-center text-xs text-gray-400">{t('common.empty')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Chart toolbar ───────────────────────────────────────────────────────────

const TOOLS: { tool: DrawTool; icon: React.ComponentType<{ className?: string }>; key: string }[] = [
  { tool: 'cursor', icon: MousePointer2, key: 'trade.toolCursor' },
  { tool: 'hline', icon: AlignHorizontalDistributeCenter, key: 'trade.toolHline' },
  { tool: 'trend', icon: Slash, key: 'trade.toolTrend' },
  { tool: 'ray', icon: MoveUpRight, key: 'trade.toolRay' },
  { tool: 'rect', icon: Square, key: 'trade.toolRect' },
  { tool: 'fib', icon: TrendingUp, key: 'trade.toolFib' },
];

function ChartToolbar({ symbol, marketType, tf, onTf, layout, onLayout }: {
  symbol: string;
  marketType: MarketType;
  tf: Timeframe;
  onTf: (tf: Timeframe) => void;
  layout: PaneLayout;
  onLayout: (n: PaneLayout) => void;
}) {
  const { t } = useI18n();
  const prefs = useChartPrefs();
  const [indOpen, setIndOpen] = useState(false);

  return (
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-gray-100 px-2.5 py-1.5">
      <div className="flex items-center overflow-x-auto">
        {TIMEFRAMES.map((v) => (
          <button
            key={v}
            onClick={() => onTf(v)}
            className={cn(
              'rounded px-2 py-1 text-2xs font-medium transition-colors',
              v === tf ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800',
            )}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Segmented
          size="xs"
          value={String(layout)}
          onChange={(v) => onLayout(Number(v) as PaneLayout)}
          options={[
            { value: '1', label: t('trade.layoutSingle') },
            { value: '2', label: t('trade.layoutDual') },
            { value: '4', label: t('trade.layoutQuad') },
          ]}
        />
        <div className="flex items-center rounded-lg border border-gray-200">
          {TOOLS.map(({ tool, icon: Icon, key }) => (
            <button
              key={tool}
              title={t(key)}
              onClick={() => prefs.set({ tool })}
              className={cn('p-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg', prefs.tool === tool ? 'bg-brand-50 text-brand-600' : 'text-gray-400 hover:text-gray-700')}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        <button
          title={t('trade.clearDrawings')}
          onClick={() => {
            clearDrawingsFor(marketType, symbol);
            window.dispatchEvent(new CustomEvent('gt:drawings-cleared'));
          }}
          className="rounded-lg border border-gray-200 p-1.5 text-gray-400 transition-colors hover:text-gray-700"
        >
          <Eraser className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setIndOpen((v) => !v)}
          className={cn('rounded-lg border px-2 py-1.5 text-2xs font-medium transition-colors', indOpen ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-500 hover:text-gray-800')}
        >
          {t('trade.indicators')}
        </button>
        <Segmented
          size="xs"
          value={prefs.source}
          onChange={(v) => prefs.set({ source: v as 'native' | 'tv' })}
          options={[
            { value: 'native', label: t('trade.nativeChart') },
            { value: 'tv', label: 'TV' },
          ]}
        />
      </div>

      {indOpen && (
        <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-gray-100 pt-1.5">
          <ToggleChip active={prefs.ma} onClick={() => prefs.set({ ma: !prefs.ma })} label={t('trade.maLine')} />
          <ToggleChip active={prefs.ema} onClick={() => prefs.set({ ema: !prefs.ema })} label={t('trade.emaLine')} />
          <ToggleChip active={prefs.boll} onClick={() => prefs.set({ boll: !prefs.boll })} label={t('trade.boll')} />
          <ToggleChip active={prefs.volume} onClick={() => prefs.set({ volume: !prefs.volume })} label={t('trade.volume')} />
          <span className="ml-1 text-2xs text-gray-400">{t('trade.subIndicator')}:</span>
          {(['none', 'macd', 'rsi', 'kdj'] as const).map((s) => (
            <ToggleChip key={s} active={prefs.sub === s} onClick={() => prefs.set({ sub: s })} label={s === 'none' ? t('trade.none') : s.toUpperCase()} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToggleChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-1 text-2xs font-medium transition-colors',
        active ? 'bg-brand-50 text-brand-700' : 'bg-gray-50 text-gray-500 hover:text-gray-700',
      )}
    >
      {label}
    </button>
  );
}
