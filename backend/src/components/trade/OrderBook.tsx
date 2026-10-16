'use client';

import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useMarketStore, marketKey } from '@/lib/marketWs';
import { fmtAmount, fmtPrice } from '@/lib/format';
import type { MarketType } from '@/core/types';

/** 15-level depth ladder with cumulative bars, click-to-fill price.
 *  Picks hint the order side: asks fill a buy price, bids a sell price. */
export function OrderBook({ marketType, symbol, onPickPrice }: { marketType: MarketType; symbol: string; onPickPrice?: (p: number, sideHint: 'buy' | 'sell') => void }) {
  const { t, locale } = useI18n();
  const book = useMarketStore((s) => s.books[marketKey(marketType, symbol)]);
  const wsOpen = useMarketStore((s) => s.status === 'open');
  const [mode, setMode] = useState<'both' | 'bids' | 'asks'>('both');

  const rows = useMemo(() => {
    if (!book) return { asks: [], bids: [] };
    const asks = book.asks.slice(0, 11).reverse();
    const bids = book.bids.slice(0, 11);
    let cum = 0;
    const asksRows = asks.map((l) => ({ ...l, cum: (cum += l.size) }));
    cum = 0;
    const bidsRows = bids.map((l) => ({ ...l, cum: (cum += l.size) }));
    const maxCum = Math.max(asksRows.at(-1)?.cum ?? 0, bidsRows.at(-1)?.cum ?? 0, 1);
    return { asks: asksRows, bids: bidsRows, maxCum };
  }, [book]);

  const cell = 'relative px-2 py-[3px] text-2xs tabular-nums';

  return (
    <div className="flex h-full flex-col text-xs">
      {!wsOpen && (
        <div className="border-b border-amber-100 bg-amber-50 px-2 py-1 text-center text-2xs text-amber-600">
          {t('trade.feedFallback')}
        </div>
      )}
      <div className="flex items-center justify-between px-2 pb-1 pt-2 text-2xs text-gray-400">
        <button onClick={() => setMode('both')} className={cn('px-1', mode === 'both' && 'font-semibold text-gray-700')}>{t('trade.orderBook')}</button>
        <div className="flex items-center gap-1">
          <button onClick={() => setMode('bids')} className={cn('rounded px-1.5 py-0.5', mode === 'bids' ? 'bg-up/10 text-up' : 'text-gray-400')}>{t('common.buy')}</button>
          <button onClick={() => setMode('asks')} className={cn('rounded px-1.5 py-0.5', mode === 'asks' ? 'bg-down/10 text-down' : 'text-gray-400')}>{t('common.sell')}</button>
        </div>
      </div>
      <div className="grid grid-cols-3 px-2 pb-1 text-2xs text-gray-400">
        <span>{t('common.price')}</span>
        <span className="text-right">{t('common.size')}</span>
        <span className="text-right">{t('common.total')}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode !== 'bids' && rows.asks.map((l, i) => (
          <button key={`a${i}`} onClick={() => onPickPrice?.(l.price, 'buy')} className={cn('grid w-full grid-cols-3', cell, 'hover:bg-gray-50')}>
            <span className="absolute inset-y-0 right-0 bg-down/[0.07]" style={{ width: `${(l.cum / (rows.maxCum ?? 1)) * 100}%` }} />
            <span className="relative text-down">{fmtPrice(l.price, locale)}</span>
            <span className="relative text-right text-gray-700">{fmtAmount(l.size, locale)}</span>
            <span className="relative text-right text-gray-400">{fmtAmount(l.cum, locale)}</span>
          </button>
        ))}
        {mode === 'both' && <SpreadRow marketType={marketType} symbol={symbol} />}
        {mode !== 'asks' && rows.bids.map((l, i) => (
          <button key={`b${i}`} onClick={() => onPickPrice?.(l.price, 'sell')} className={cn('grid w-full grid-cols-3', cell, 'hover:bg-gray-50')}>
            <span className="absolute inset-y-0 right-0 bg-up/[0.07]" style={{ width: `${(l.cum / (rows.maxCum ?? 1)) * 100}%` }} />
            <span className="relative text-up">{fmtPrice(l.price, locale)}</span>
            <span className="relative text-right text-gray-700">{fmtAmount(l.size, locale)}</span>
            <span className="relative text-right text-gray-400">{fmtAmount(l.cum, locale)}</span>
          </button>
        ))}
        {!book && <div className="px-2 py-6 text-center text-2xs text-gray-300">…</div>}
      </div>
    </div>
  );
}

function SpreadRow({ marketType, symbol }: { marketType: MarketType; symbol: string }) {
  const { locale } = useI18n();
  const ticker = useMarketStore((s) => s.tickers[marketKey(marketType, symbol)]);
  if (!ticker) return null;
  const spread = ticker.ask != null && ticker.bid != null ? ticker.ask - ticker.bid : null;
  return (
    <div className="flex items-center justify-between px-2 py-1.5">
      <span className="text-sm font-semibold tabular-nums">{fmtPrice(ticker.last, locale)}</span>
      {spread != null && <span className="text-2xs text-gray-400">⇅ {fmtPrice(spread, locale)}</span>}
    </div>
  );
}

/** Scrolling tape of recent public trades. */
export function TradesTape({ marketType, symbol }: { marketType: MarketType; symbol: string }) {
  const { t, locale } = useI18n();
  const trades = useMarketStore((s) => s.trades[marketKey(marketType, symbol)]);
  const wsOpen = useMarketStore((s) => s.status === 'open');
  return (
    <div className="flex h-full flex-col text-xs">
      {!wsOpen && (
        <div className="border-b border-amber-100 bg-amber-50 px-2 py-1 text-center text-2xs text-amber-600">
          {t('trade.feedFallback')}
        </div>
      )}
      <div className="px-2 pb-1 pt-2 text-2xs text-gray-400">{t('trade.trades')}</div>
      <div className="grid grid-cols-3 px-2 pb-1 text-2xs text-gray-400">
        <span>{t('common.price')}</span>
        <span className="text-right">{t('common.size')}</span>
        <span className="text-right">{t('common.time')}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(trades ?? []).map((tr, i) => (
          <div key={`${tr.ts}-${i}`} className="grid grid-cols-3 px-2 py-[3px] text-2xs tabular-nums hover:bg-gray-50">
            <span className={tr.side === 'buy' ? 'text-up' : 'text-down'}>{fmtPrice(tr.price, locale)}</span>
            <span className="text-right text-gray-700">{fmtAmount(tr.size, locale)}</span>
            <span className="text-right text-gray-400">
              {new Date(tr.ts).toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { hour12: false })}
            </span>
          </div>
        ))}
        {!trades?.length && <div className="px-2 py-6 text-center text-2xs text-gray-300">…</div>}
      </div>
    </div>
  );
}
