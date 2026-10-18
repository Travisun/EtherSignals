'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useLevels } from '@/stores/levels';
import { upDownColors, usePrefs } from '@/stores/prefs';
import { fmtDate, fmtPrice, fmtTime } from '@/lib/format';
import { NHNL_TFS } from '@/core/nhnl';
import type { MarketType, NhnlRow, Timeframe } from '@/core/types';

/**
 * Full new-high/new-low ladder table — surfaces every dimension of the
 * NhnlSnapshot structure (per timeframe: forming-bar extremes + NH/NL state,
 * previous-bar extremes + break, Donchian channel + break, distance %, bar
 * open time). Rows are clickable to switch the chart timeframe; the active
 * chart timeframe is highlighted.
 */
export function NhnlPanel({
  marketType, symbol, activeTf, onPickTf, className,
}: {
  marketType: MarketType;
  symbol: string;
  activeTf?: Timeframe;
  onPickTf?: (tf: Timeframe) => void;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const snapshot = useLevels((s) => s.snapshot);
  const { upClass, downClass } = upDownColors(usePrefs((s) => s.upDown), locale);

  const live = snapshot && snapshot.marketType === marketType && snapshot.symbol === symbol ? snapshot : null;
  const donN = live?.donN ?? 20;
  const rowFor = (tf: Timeframe): NhnlRow | undefined => live?.rows.find((r) => r.tf === tf);

  const barTimeText = (r: NhnlRow): string => {
    const ms = r.barTime * 1000;
    // intraday rows: time only; day+ rows: date only
    return ['1m', '1h', '4h', '8h'].includes(r.tf) ? fmtTime(ms, locale, false) : fmtDate(ms, locale);
  };

  return (
    <div className={cn('overflow-x-auto px-3 pb-2', className)}>
      <div className="mb-1 flex items-center gap-3 text-2xs text-gray-400">
        <span>
          {t('levels.price')} <span className="font-mono tabular-nums text-gray-600 dark:text-gray-300">{fmtPrice(live?.price, locale)}</span>
        </span>
        <span>
          Donchian <span className="font-mono">N={donN}</span>
        </span>
      </div>
      <table className="w-full min-w-[720px] border-collapse text-2xs">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-400 dark:border-gray-700">
            <th className="py-1 pr-2 font-medium">{t('levels.colTf')}</th>
            <th className="py-1 pr-2 font-medium">{t('levels.colSignal')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('levels.barHigh')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('levels.barLow')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('levels.prevHigh')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('levels.prevLow')}</th>
            <th className="py-1 pr-2 text-right font-medium">D{donN}{locale === 'zh-CN' ? '上' : ' ↑'}</th>
            <th className="py-1 pr-2 text-right font-medium">D{donN}{locale === 'zh-CN' ? '下' : ' ↓'}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('levels.distToHigh')}%</th>
            <th className="py-1 pr-2 text-right font-medium">{t('levels.distToLow')}%</th>
            <th className="py-1 font-medium">{t('levels.barOpen')}</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {NHNL_TFS.map((tf) => {
            const row = rowFor(tf);
            if (!row) {
              return (
                <tr key={tf} className="border-b border-gray-100 text-gray-300 dark:border-gray-800 dark:text-gray-600">
                  <td className="py-1 pr-2">{tf}</td>
                  <td className="py-1 pr-2" colSpan={10}>…</td>
                </tr>
              );
            }
            const bull = row.nh || row.brkUp || row.donUp;
            const bear = row.nl || row.brkDown || row.donDown;
            const mixed = bull && bear;
            const tone = mixed
              ? 'bg-amber-500/5'
              : bull
                ? 'bg-up/5'
                : bear
                  ? 'bg-down/5'
                  : '';
            const signalTone = mixed
              ? 'text-amber-600 dark:text-amber-400'
              : bull
                ? upClass
                : bear
                  ? downClass
                  : 'text-gray-400 dark:text-gray-500';
            const badge = (on: boolean, label: string) =>
              on ? (
                <span className="mr-1 rounded bg-current/10 px-1 py-px">{label}</span>
              ) : null;
            return (
              <tr
                key={tf}
                onClick={() => onPickTf?.(tf)}
                className={cn(
                  'cursor-pointer border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/40',
                  tone,
                  tf === activeTf && 'ring-1 ring-inset ring-brand-400/60',
                )}
              >
                <td className={cn('py-1 pr-2 font-semibold', tf === activeTf ? 'text-brand-600 dark:text-brand-400' : 'text-gray-600 dark:text-gray-300')}>{tf}</td>
                <td className={cn('py-1 pr-2 font-sans', signalTone)}>
                  {badge(row.nh, t('levels.nh'))}
                  {badge(row.nl, t('levels.nl'))}
                  {badge(row.brkUp, t('levels.brkUp'))}
                  {badge(row.brkDown, t('levels.brkDown'))}
                  {badge(row.donUp, `D${donN}↑`)}
                  {badge(row.donDown, `D${donN}↓`)}
                  {!bull && !bear && '·'}
                </td>
                <td className="py-1 pr-2 text-right text-gray-600 dark:text-gray-300">{fmtPrice(row.barHigh, locale)}</td>
                <td className="py-1 pr-2 text-right text-gray-600 dark:text-gray-300">{fmtPrice(row.barLow, locale)}</td>
                <td className="py-1 pr-2 text-right text-gray-500 dark:text-gray-400">{fmtPrice(row.prevHigh, locale)}</td>
                <td className="py-1 pr-2 text-right text-gray-500 dark:text-gray-400">{fmtPrice(row.prevLow, locale)}</td>
                <td className="py-1 pr-2 text-right text-gray-500 dark:text-gray-400">{fmtPrice(row.donHigh, locale)}</td>
                <td className="py-1 pr-2 text-right text-gray-500 dark:text-gray-400">{fmtPrice(row.donLow, locale)}</td>
                <td className={cn('py-1 pr-2 text-right', row.distHighPct === 0 ? signalTone : 'text-gray-500 dark:text-gray-400')}>
                  {(row.distHighPct ?? 0).toFixed(2)}
                </td>
                <td className={cn('py-1 pr-2 text-right', row.distLowPct === 0 ? signalTone : 'text-gray-500 dark:text-gray-400')}>
                  {(row.distLowPct ?? 0).toFixed(2)}
                </td>
                <td className="py-1 text-gray-400">{barTimeText(row)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
