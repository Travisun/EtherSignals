'use client';

import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useSignals } from '@/stores/signals';
import type { TFSignal, TrendRegime } from '@/core/types';

const REGIME_LABEL: Record<TrendRegime, { zh: string; en: string }> = {
  strong_up: { zh: '强势上涨', en: 'Strong Up' },
  up: { zh: '上涨', en: 'Up' },
  neutral: { zh: '震荡', en: 'Range' },
  down: { zh: '下跌', en: 'Down' },
  strong_down: { zh: '强势下跌', en: 'Strong Down' },
};
const REGIME_ICON: Record<TrendRegime, string> = { strong_up: '↑↑', up: '↑', neutral: '→', down: '↓', strong_down: '↓↓' };

const REGIME_COLOR: Record<TrendRegime, string> = {
  strong_up: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10',
  up: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/25 bg-emerald-50/60 dark:bg-emerald-500/5',
  neutral: 'text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/40',
  down: 'text-red-600 dark:text-red-400 border-red-500/25 bg-red-50/60 dark:bg-red-500/5',
  strong_down: 'text-red-600 dark:text-red-400 border-red-500/40 bg-red-50 dark:bg-red-500/10',
};

function chipText(s: TFSignal): string {
  const prob = s.prob == null ? '·' : `${Math.round(s.prob * 100)}%`;
  return `${s.tf} ${REGIME_ICON[s.regime]} ${prob}`;
}

/**
 * Compact multi-timeframe trend-signal strip (2m/5m/30m/2h/1d by default).
 * Data arrives via the `signals:update` socket push; each chip shows the
 * regime icon and the walk-forward continuation probability, with the full
 * one-line guidance (patterns + hit rates) in the tooltip. Clicking a chip
 * switches the chart to that timeframe.
 */
export function SignalStrip({ onPickTf, className }: { onPickTf?: (tf: TFSignal) => void; className?: string }) {
  const { t, locale } = useI18n();
  const snapshot = useSignals((s) => s.snapshot);
  if (!snapshot?.signals.length) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="mr-0.5 text-[11px] font-medium text-gray-400">{t('signals.title')}</span>
      {snapshot.signals.map((s) => (
        <button
          key={s.tf}
          type="button"
          title={locale === 'zh-CN' ? s.line : s.lineEn}
          onClick={() => onPickTf?.(s)}
          className={cn(
            'rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums transition-colors hover:brightness-95',
            REGIME_COLOR[s.regime],
          )}
        >
          {chipText(s)}
        </button>
      ))}
    </div>
  );
}

/** full guidance line for tooltips elsewhere (activity etc.) */
export function signalLine(s: TFSignal, locale: string): string {
  return locale === 'zh-CN' ? s.line : s.lineEn;
}

export { REGIME_LABEL };
