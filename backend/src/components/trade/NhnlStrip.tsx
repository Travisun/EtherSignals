'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { subscribeLevels, unsubscribeLevels, useLevels } from '@/stores/levels';
import { upDownColors, usePrefs } from '@/stores/prefs';
import { fmtPrice } from '@/lib/format';
import { NHNL_TFS } from '@/core/nhnl';
import { NhnlPanel } from '@/components/trade/NhnlPanel';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { MarketType, NhnlRow, Timeframe } from '@/core/types';

/**
 * Multi-timeframe new-high / new-low ladder strip. One chip per timeframe
 * (1m → 1M); each chip shows at which ladder levels the live price is
 * breaking out: the forming bar's running high/low, the previous closed
 * bar's high/low, and the Donchian-N channel. Neutral chips show the
 * distance to the nearer bar extreme. Expand (chevron) for the full ladder
 * table with every dimension. Clicking a chip switches the chart timeframe.
 * Data: `levels:update` socket pushes (server-side evaluation — browsers
 * never touch the exchange).
 */
export function NhnlStrip({
  marketType, symbol, activeTf, onPickTf, className,
}: {
  marketType: MarketType;
  symbol: string;
  /** current chart timeframe — highlighted in strip + panel */
  activeTf?: Timeframe;
  onPickTf?: (tf: Timeframe) => void;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const snapshot = useLevels((s) => s.snapshot);
  const [open, setOpen] = useState(false);
  const { upClass, downClass } = upDownColors(usePrefs((s) => s.upDown), locale);

  useEffect(() => {
    subscribeLevels(marketType, symbol);
    return () => unsubscribeLevels(marketType, symbol);
  }, [marketType, symbol]);

  const live = snapshot && snapshot.marketType === marketType && snapshot.symbol === symbol ? snapshot : null;
  const donN = live?.donN ?? 20;
  const rowFor = (tf: Timeframe): NhnlRow | undefined => live?.rows.find((r) => r.tf === tf);

  const badges = (r: NhnlRow): string[] => {
    const zh = locale === 'zh-CN';
    const out: string[] = [];
    if (r.nh) out.push(zh ? '新高' : 'NH');
    else if (r.nl) out.push(zh ? '新低' : 'NL');
    if (r.brkUp) out.push(zh ? '破前高' : 'prev↑');
    else if (r.brkDown) out.push(zh ? '破前低' : 'prev↓');
    if (r.donUp) out.push(`D${donN}↑`);
    else if (r.donDown) out.push(`D${donN}↓`);
    return out;
  };

  /** distance to the nearer forming-bar extreme, for chips with no break */
  const nearerDist = (r: NhnlRow): string => {
    const toHigh = Math.abs(r.distHighPct ?? 0);
    const toLow = Math.abs(r.distLowPct ?? 0);
    return `${toHigh <= toLow ? '↥' : '↧'}${Math.min(toHigh, toLow).toFixed(2)}%`;
  };

  const tooltip = (r: NhnlRow): string =>
    [
      `${t('levels.price')} ${fmtPrice(live?.price, locale)}`,
      `${t('levels.barHigh')} ${fmtPrice(r.barHigh, locale)} · ${t('levels.barLow')} ${fmtPrice(r.barLow, locale)}`,
      `${t('levels.prevHigh')} ${fmtPrice(r.prevHigh, locale)} · ${t('levels.prevLow')} ${fmtPrice(r.prevLow, locale)}`,
      `D${donN} ${fmtPrice(r.donHigh, locale)} / ${fmtPrice(r.donLow, locale)}`,
      `${t('levels.distToHigh')} ${(r.distHighPct ?? 0).toFixed(2)}% · ${t('levels.distToLow')} ${(r.distLowPct ?? 0).toFixed(2)}%`,
    ].join('\n');

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[11px] font-medium text-gray-400">{t('levels.title')}</span>
        {NHNL_TFS.map((tf) => {
          const row = rowFor(tf);
          if (!row) {
            // window still loading — keep the ladder layout stable
            return (
              <span
                key={tf}
                className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] text-gray-300 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-600"
              >
                {tf} …
              </span>
            );
          }
          const bull = row.nh || row.brkUp || row.donUp;
          const bear = row.nl || row.brkDown || row.donDown;
          const tone =
            bull && bear
              ? 'border-amber-500/40 bg-amber-500/10'
              : bull
                ? 'border-up/40 bg-up/10'
                : bear
                  ? 'border-down/40 bg-down/10'
                  : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/40';
          const text = bull && bear
            ? 'text-amber-600 dark:text-amber-400'
            : bull
              ? upClass
              : bear
                ? downClass
                : 'text-gray-500 dark:text-gray-400';
          return (
            <button
              key={tf}
              type="button"
              title={tooltip(row)}
              onClick={() => onPickTf?.(tf)}
              className={cn(
                'rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums transition-colors hover:brightness-95',
                tone,
                text,
                tf === activeTf && 'ring-1 ring-brand-400/70',
              )}
            >
              {tf} {badges(row).join(' ') || nearerDist(row)}
            </button>
          );
        })}
        <button
          type="button"
          title={open ? t('levels.hide') : t('levels.full')}
          onClick={() => setOpen((o) => !o)}
          className="ml-auto rounded p-1 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-800"
        >
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>
      {open && (
        <NhnlPanel marketType={marketType} symbol={symbol} activeTf={activeTf} onPickTf={onPickTf} className="pt-1.5" />
      )}
    </div>
  );
}
