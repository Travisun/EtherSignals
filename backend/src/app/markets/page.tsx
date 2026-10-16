'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { Card, EmptyState } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { useMarketStore, loadTickers, useMarketSubscriptions } from '@/lib/marketWs';
import { usePrefs, upDownColors } from '@/stores/prefs';
import { useTradeIntent } from '@/stores/tradeIntent';
import { fmtCompact, fmtPrice, fmtSignedPct } from '@/lib/format';
import { Star } from 'lucide-react';
import type { MarketType, Ticker } from '@/core/types';

type SortKey = 'volume' | 'change' | 'symbol';

export default function MarketsPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [marketType, setMarketType] = useState<MarketType>('futures');
  const [tab, setTab] = useState<'all' | 'fav'>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortAsc, setSortAsc] = useState(false);
  const tickers = useMarketStore((s) => s.tickers);
  const { favorites, toggleFavorite } = usePrefs();
  const { upClass, downClass } = upDownColors(usePrefs((s) => s.upDown), locale);

  useEffect(() => {
    void loadTickers('futures');
    void loadTickers('spot');
    const timer = setInterval(() => void loadTickers(marketType), 15_000);
    return () => clearInterval(timer);
  }, [marketType]);

  // live updates for the visible top rows
  useMarketSubscriptions([
    { channel: 'ticker', marketType, instId: 'BTCUSDT' },
    { channel: 'ticker', marketType, instId: 'ETHUSDT' },
  ]);

  const rows = useMemo(() => {
    const prefix = marketType === 'spot' ? 'spot:' : 'futures:';
    let list: Ticker[] = Object.entries(tickers)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v);
    if (tab === 'fav') list = list.filter((tk) => favorites.includes(tk.symbol));
    const q = query.trim().toUpperCase();
    if (q) list = list.filter((tk) => tk.symbol.includes(q));
    const dir = sortAsc ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === 'volume') return (a.quoteVolume - b.quoteVolume) * dir;
      if (sortKey === 'change') return (a.change24h - b.change24h) * dir;
      return a.symbol.localeCompare(b.symbol) * (sortAsc ? 1 : -1);
    });
    return list.slice(0, 300);
  }, [tickers, marketType, tab, query, favorites, sortKey, sortAsc]);

  const goTrade = (tk: Ticker) => {
    useTradeIntent.getState().set({ symbol: tk.symbol, marketType });
    router.push('/trade');
  };

  const SortHead = ({ label, k, right }: { label: string; k: SortKey; right?: boolean }) => (
    <th className={cn('select-none whitespace-nowrap px-3 py-2 font-medium', right ? 'text-right' : '')}>
      <button
        onClick={() => {
          if (sortKey === k) setSortAsc((v) => !v);
          else {
            setSortKey(k);
            setSortAsc(false);
          }
        }}
        className={cn('inline-flex items-center gap-1 hover:text-gray-800', sortKey === k && 'text-gray-900')}
      >
        {label}
        {sortKey === k && <span className="text-2xs">{sortAsc ? '↑' : '↓'}</span>}
      </button>
    </th>
  );

  return (
    <div className="w-full space-y-3 p-3 md:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{t('markets.title')}</h2>
        <Segmented
          value={marketType}
          onChange={(v) => setMarketType(v as MarketType)}
          options={[
            { value: 'futures', label: t('markets.futures') },
            { value: 'spot', label: t('markets.spot') },
          ]}
        />
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          options={[
            { value: 'all', label: t('markets.allTab') },
            { value: 'fav', label: `★ ${t('markets.favoritesTab')}` },
          ]}
        />
        <div className="ml-auto w-full sm:w-64">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.searchPlaceholder')}
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="max-h-[calc(100dvh-230px)] overflow-auto">
          <table className="w-full min-w-max text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-gray-100 bg-white text-gray-500">
              <tr>
                <th className="w-8 px-2 py-2" />
                <SortHead label={t('common.symbol')} k="symbol" />
                <th className="px-3 py-2 text-right font-medium">{t('markets.lastPrice')}</th>
                <SortHead label={t('markets.change24h')} k="change" right />
                <th className="px-3 py-2 text-right font-medium">{t('markets.high24h')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('markets.low24h')}</th>
                <SortHead label={t('markets.volume')} k="volume" right />
                {marketType === 'futures' && <th className="px-3 py-2 text-right font-medium">{t('markets.fundingRate')}</th>}
                <th className="px-3 py-2 text-right font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tk) => {
                const fav = favorites.includes(tk.symbol);
                return (
                  <tr key={tk.symbol} className="cursor-pointer border-b border-gray-50 transition-colors last:border-0 hover:bg-gray-50/80" onClick={() => goTrade(tk)}>
                    <td className="px-2 py-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(tk.symbol);
                        }}
                        className={cn('rounded p-0.5 transition-colors', fav ? 'text-amber-400' : 'text-gray-200 hover:text-gray-400')}
                      >
                        <Star className={cn('h-3.5 w-3.5', fav && 'fill-amber-400')} />
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">{tk.symbol}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPrice(tk.last, locale)}</td>
                    <td className={cn('px-3 py-2 text-right font-medium tabular-nums', tk.change24h >= 0 ? upClass : downClass)}>
                      {fmtSignedPct(tk.change24h, locale)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtPrice(tk.high24h, locale)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtPrice(tk.low24h, locale)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtCompact(tk.quoteVolume, locale)}</td>
                    {marketType === 'futures' && (
                      <td className={cn('px-3 py-2 text-right tabular-nums', (tk.fundingRate ?? 0) >= 0 ? upClass : downClass)}>
                        {fmtSignedPct(tk.fundingRate, locale, 4)}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <span className="rounded-md bg-brand-50 px-2 py-1 text-2xs font-medium text-brand-600">{t('markets.trade')}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <EmptyState title={t('common.empty')} description={tab === 'fav' ? t('dashboard.addWatchlistHint') : undefined} />}
        </div>
      </Card>
    </div>
  );
}
