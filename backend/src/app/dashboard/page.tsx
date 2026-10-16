'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { Card, Stat, Badge, EmptyState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { useAccountStore } from '@/stores/account';
import { usePrefs, upDownColors } from '@/stores/prefs';
import { useMarketStore, marketKey, useMarketSubscriptions } from '@/lib/marketWs';
import { EventRow } from '@/components/layout/AppShell';
import { useTradeIntent } from '@/stores/tradeIntent';
import { fmtAmount, fmtSignedPct, fmtPrice } from '@/lib/format';
import { Activity, BarChart3, CheckCircle2, CircleDashed, Wallet, Zap } from 'lucide-react';
import type { EquitySnapshot, MarketType, Ticker } from '@/core/types';

interface StatsSummary {
  today: { realizedPnl: number; trades: number; wins: number };
  paper: { realizedPnl: number; trades: number; winRate: number; openPositions: number };
}

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const summary = useAccountStore((s) => s.summary);
  const positions = useAccountStore((s) => s.positions);
  const engineStatus = usePrefs((s) => s.engineStatus);
  const events = usePrefs((s) => s.notifications);
  const favorites = usePrefs((s) => s.favorites);
  const { upClass, downClass } = upDownColors(usePrefs((s) => s.upDown), locale);

  const [movers, setMovers] = useState<{ gainers: Ticker[]; losers: Ticker[] } | null>(null);
  const [equity, setEquity] = useState<EquitySnapshot[] | null>(null);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [setup, setSetup] = useState<{ hasAccount: boolean; hasSmtp: boolean }>({ hasAccount: false, hasSmtp: false });

  useEffect(() => {
    void useAccountStore.getState().refresh();
    const load = () =>
      fetch('/api/market/tickers?marketType=futures')
        .then((r) => r.json())
        .then((j) => {
          if (!j?.ok) return;
          const list = (j.data.tickers as Ticker[]).filter((x) => x.quoteVolume > 1_000_000);
          const byChange = [...list].sort((a, b) => b.change24h - a.change24h);
          setMovers({ gainers: byChange.slice(0, 6), losers: byChange.slice(-6).reverse() });
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  // equity curve + performance rollup + real setup-state
  useEffect(() => {
    fetch('/api/account/equity-history?points=120').then((r) => r.json()).then((j) => {
      if (j?.ok) setEquity(j.data.series as EquitySnapshot[]);
    }).catch(() => undefined);
    fetch('/api/stats/summary').then((r) => r.json()).then((j) => {
      if (j?.ok) setStats(j.data as StatsSummary);
    }).catch(() => undefined);
    fetch('/api/settings').then((r) => r.json()).then((j) => {
      if (j?.ok) {
        setSetup({
          hasAccount: (j.data.settings.accounts ?? []).length > 0,
          hasSmtp: Boolean(j.data.settings.smtp?.host),
        });
      }
    }).catch(() => undefined);
  }, []);

  useMarketSubscriptions(
    favorites.slice(0, 10).map((s) => ({ channel: 'ticker', marketType: 'futures' as MarketType, instId: s })),
  );

  const pnlTone = (summary?.totals.unrealizedPnl ?? 0) >= 0 ? 'up' : 'down';

  return (
    <div className="w-full space-y-3 p-3 md:p-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{t('dashboard.title')}</h2>
          <p className="text-xs text-gray-400">{t('app.tagline')}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/trade"><Button size="sm">{t('dashboard.goTrade')}</Button></Link>
          <Link href="/settings"><Button size="sm" variant="outline">{t('nav.settings')}</Button></Link>
        </div>
      </div>

      {/* equity cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t('dashboard.equity')} value={`$${fmtAmount(summary?.totals.equityUsd, locale)}`} icon={<Wallet className="h-4 w-4" />} />
        <Stat label={t('dashboard.available')} value={`$${fmtAmount(summary?.totals.availableUsd, locale)}`} icon={<BarChart3 className="h-4 w-4" />} />
        <Stat label={t('dashboard.unrealizedPnl')} value={`${(summary?.totals.unrealizedPnl ?? 0) >= 0 ? '+' : ''}${fmtAmount(summary?.totals.unrealizedPnl, locale)}`} tone={pnlTone} icon={<Activity className="h-4 w-4" />} />
        <Stat
          label={t('dashboard.todayPnl')}
          value={`${(stats?.today.realizedPnl ?? 0) >= 0 ? '+' : ''}${fmtAmount(stats?.today.realizedPnl ?? 0, locale)}`}
          tone={(stats?.today.realizedPnl ?? 0) >= 0 ? 'up' : 'down'}
          sub={stats ? t('dashboard.todayTrades', { n: String(stats.today.trades) }) : undefined}
        />
        <Stat
          label={t('dashboard.runningStrategies')}
          value={`${engineStatus?.runningStrategies ?? 0}`}
          sub={`${t('common.total')} ${engineStatus?.totalStrategies ?? 0}`}
          icon={<Zap className="h-4 w-4" />}
        />
      </div>

      {/* equity curve + performance */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <h3 className="text-sm font-semibold">{t('dashboard.equityCurve')}</h3>
            <span className="text-2xs text-gray-400">{t('dashboard.equityCurveHint')}</span>
          </div>
          <div className="px-2 py-2">
            {equity && equity.length >= 2 ? (
              <EquityArea series={equity} upClass={upClass} downClass={downClass} />
            ) : (
              <div className="flex h-36 items-center justify-center text-xs text-gray-300">{t('dashboard.equityNoData')}</div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2.5 text-sm font-semibold">{t('dashboard.performance')}</h3>
          {stats ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <PerfLine label={t('dashboard.winRate')} value={`${(stats.paper.winRate ?? 0).toFixed(1)}%`} />
              <PerfLine label={t('dashboard.closedTrades')} value={String(stats.paper.trades)} />
              <PerfLine
                label={t('dashboard.realizedPnl')}
                value={`${(stats.paper.realizedPnl ?? 0) >= 0 ? '+' : ''}${fmtAmount(stats.paper.realizedPnl ?? 0, locale)}`}
                tone={(stats.paper.realizedPnl ?? 0) >= 0 ? 'up' : 'down'}
              />
              <PerfLine label={t('positions.openPositions')} value={String(stats.paper.openPositions)} />
              <PerfLine label={t('dashboard.todayWins')} value={String(stats.today.wins)} />
              <PerfLine label={t('dashboard.todayTradesShort')} value={String(stats.today.trades)} />
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-gray-300">…</div>
          )}
          <div className="mt-3 border-t border-gray-100 pt-2.5">
            <Link href="/strategies" className="text-xs text-brand-600 hover:underline">{t('nav.strategies')} →</Link>
          </div>
        </Card>
      </div>

      {/* setup checklist (when unconfigured) */}
      {(!engineStatus || engineStatus.privateWs === 'no-account') && (
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold text-gray-900">{t('dashboard.setup')}</div>
          <div className="grid gap-2 sm:grid-cols-3">
            <SetupItem href="/settings" done={setup.hasAccount} label={t('dashboard.setupAccount')} />
            <SetupItem href="/settings" done={setup.hasSmtp} label={t('dashboard.setupSmtp')} />
            <SetupItem href="/strategies" done={(engineStatus?.totalStrategies ?? 0) > 0} label={t('dashboard.setupStrategy')} />
          </div>
          {engineStatus?.paper && <p className="mt-2 text-2xs text-amber-600">{t('dashboard.setupPaper')}</p>}
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {/* watchlist */}
        <Card>
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <h3 className="text-sm font-semibold">{t('dashboard.watchlist')}</h3>
            <Link href="/markets" className="text-xs text-brand-600 hover:underline">{t('common.viewAll')}</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {favorites.length === 0 && <div className="px-4 py-8 text-center text-xs text-gray-400">{t('dashboard.addWatchlistHint')}</div>}
            {favorites.slice(0, 8).map((sym) => (
              <WatchRow key={sym} symbol={sym} />
            ))}
          </div>
        </Card>

        {/* movers */}
        <Card>
          <div className="border-b border-gray-100 px-4 py-2.5">
            <h3 className="text-sm font-semibold">{t('dashboard.topGainers')} / {t('dashboard.topLosers')}</h3>
          </div>
          <div className="grid grid-cols-2 gap-px bg-gray-50">
            <MoverList title={t('dashboard.topGainers')} list={movers?.gainers ?? []} />
            <MoverList title={t('dashboard.topLosers')} list={movers?.losers ?? []} />
          </div>
        </Card>

        {/* engine + events */}
        <div className="space-y-3">
          <Card className="p-4">
            <h3 className="mb-2.5 text-sm font-semibold">{t('dashboard.engineStatus')}</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <StatusLine label={t('dashboard.publicWs')} ok={engineStatus?.publicWs === 'connected'} />
              <StatusLine label={t('dashboard.privateWs')} ok={engineStatus?.privateWs === 'connected'} />
              <StatusLine label={t('dashboard.queue')} ok value={`${engineStatus?.queueDepth ?? 0}`} />
              <StatusLine
                label={t('common.status')}
                ok
                value={engineStatus?.paper ? t('app.paperMode') : engineStatus?.accountLabel ?? t('app.noAccount')}
              />
              {(engineStatus?.staleWindows ?? 0) > 0 && (
                <StatusLine label={t('dashboard.staleFeeds')} ok={false} value={String(engineStatus?.staleWindows)} />
              )}
              {(engineStatus?.rateLimited429 ?? 0) > 0 && (
                <StatusLine label="429" ok={false} value={String(engineStatus?.rateLimited429)} />
              )}
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
              <h3 className="text-sm font-semibold">{t('dashboard.recentEvents')}</h3>
              <Link href="/activity" className="text-xs text-brand-600 hover:underline">{t('common.viewAll')}</Link>
            </div>
            <div className="max-h-72 divide-y divide-gray-50 overflow-y-auto">
              {events.length === 0 && <EmptyState title={t('activity.empty')} />}
              {events.slice(0, 12).map((ev) => <EventRow key={ev.id} event={ev} />)}
            </div>
          </Card>
        </div>
      </div>

      {/* positions */}
      <Card>
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <h3 className="text-sm font-semibold">{t('dashboard.positionsNow')}</h3>
          <Link href="/positions" className="text-xs text-brand-600 hover:underline">{t('common.viewAll')}</Link>
        </div>
        {positions.length === 0 ? (
          <EmptyState title={t('dashboard.noPositions')} />
        ) : (
          <div className="divide-y divide-gray-50">
            {positions.map((p, i) => (
              <div key={`${p.symbol}-${i}`} className="flex items-center justify-between px-4 py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{p.symbol}</span>
                  <Badge tone={p.side === 'long' ? 'up' : 'down'}>{p.side === 'long' ? t('common.long') : t('common.short')}</Badge>
                  <span className="text-gray-400">{p.leverage}×</span>
                </div>
                <div className="flex items-center gap-4 tabular-nums">
                  <span className="text-gray-500">@ {fmtPrice(p.openPriceAvg, locale)}</span>
                  <span className={cn('font-medium', p.unrealizedPL >= 0 ? 'text-up' : 'text-down')}>
                    {p.unrealizedPL >= 0 ? '+' : ''}{fmtAmount(p.unrealizedPL, locale)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="pb-2 text-center text-2xs text-gray-300">
        DownTrade · {t('app.engine')} v1.0
      </div>
    </div>
  );
}

/** Compact SVG area chart of the account equity history (no chart deps). */
function EquityArea({ series, upClass, downClass }: { series: EquitySnapshot[]; upClass: string; downClass: string }) {
  const { locale } = useI18n();
  const data = useMemo(() => [...series].sort((a, b) => a.ts - b.ts), [series]);
  const w = 600;
  const h = 140;
  const values = data.map((d) => d.equityUsd);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((d, i) => `${(i * step).toFixed(1)},${(h - 8 - ((d.equityUsd - min) / range) * (h - 20)).toFixed(1)}`);
  const positive = values[values.length - 1] >= values[0];
  const stroke = positive ? '#16a34a' : '#dc2626';
  const first = values[0];
  const last = values[values.length - 1];
  const changePct = first ? ((last - first) / first) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-2xs text-gray-400">{data.length ? new Date(data[0].ts).toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US') : ''} →</span>
        <span className={cn('text-xs font-semibold tabular-nums', positive ? upClass : downClass)}>
          ${fmtAmount(last, locale)} · {fmtSignedPct(changePct, locale)}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" preserveAspectRatio="none">
        <polygon
          points={`0,${h} ${pts.join(' ')} ${w},${h}`}
          fill={stroke}
          opacity={0.08}
        />
        <polyline
          points={pts.join(' ')}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function PerfLine({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-400">{label}</span>
      <span className={cn('font-semibold tabular-nums', tone === 'up' && 'text-up', tone === 'down' && 'text-down', !tone && 'text-gray-800')}>{value}</span>
    </div>
  );
}

function SetupItem({ href, done, label }: { href: string; done: boolean; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-xs text-gray-700 transition-colors hover:border-brand-300 hover:bg-brand-50/40">
      {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-up" /> : <CircleDashed className="h-4 w-4 shrink-0 text-gray-300" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
  );
}

function WatchRow({ symbol }: { symbol: string }) {
  const { locale } = useI18n();
  const { upClass, downClass } = upDownColors(usePrefs((s) => s.upDown), locale);
  const ticker = useMarketStore((s) => s.tickers[marketKey('futures', symbol)]);
  const change = ticker?.change24h ?? 0;
  return (
    <Link
      href="/trade"
      className="flex items-center justify-between px-4 py-2.5 text-xs transition-colors hover:bg-gray-50"
      onClick={() => useTradeIntent.getState().set({ symbol, marketType: 'futures' })}
    >
      <span className="font-medium text-gray-900">{symbol}</span>
      <span className="flex items-center gap-3 tabular-nums">
        <span className="text-gray-700">{fmtPrice(ticker?.last, locale)}</span>
        <span className={cn('w-16 rounded px-1.5 py-0.5 text-center text-2xs font-medium', change >= 0 ? upClass : downClass)}>
          {fmtSignedPct(change, locale)}
        </span>
      </span>
    </Link>
  );
}

function MoverList({ title, list }: { title: string; list: Ticker[] }) {
  const { locale } = useI18n();
  const { upClass, downClass } = upDownColors(usePrefs((s) => s.upDown), locale);
  return (
    <div className="bg-white p-2">
      <div className="px-1 pb-1 text-2xs text-gray-400">{title}</div>
      {list.map((tk) => (
        <Link
          key={tk.symbol}
          href="/trade"
          className="flex items-center justify-between rounded px-1 py-1 text-2xs hover:bg-gray-50"
          onClick={() => useTradeIntent.getState().set({ symbol: tk.symbol, marketType: 'futures' })}
        >
          <span className="truncate font-medium text-gray-700">{tk.symbol.replace('USDT', '')}</span>
          <span className={cn('font-medium tabular-nums', tk.change24h >= 0 ? upClass : downClass)}>
            {fmtSignedPct(tk.change24h, locale, 1)}
          </span>
        </Link>
      ))}
      {!list.length && <div className="px-1 py-4 text-2xs text-gray-300">…</div>}
    </div>
  );
}

function StatusLine({ label, ok, value }: { label: string; ok: boolean; value?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-up' : 'bg-gray-300')} />
      <span className="text-gray-400">{label}</span>
      {value && <span className="truncate text-gray-700">{value}</span>}
    </div>
  );
}
