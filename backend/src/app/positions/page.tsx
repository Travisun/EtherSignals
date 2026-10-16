'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Card, Stat } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Segmented } from '@/components/ui/tabs';
import { PositionsTable, SymbolLink } from '@/components/trade/TradePanels';
import { useAccountStore } from '@/stores/account';
import { closePositionApi } from '@/hooks/useOrders';
import { fmtAmount } from '@/lib/format';
import type { PositionRecord } from '@/core/types';

type SortKey = 'pnl' | 'roe' | 'size' | 'symbol';

export default function PositionsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { positions, summary, refresh } = useAccountStore();
  const [sideFilter, setSideFilter] = useState<'all' | 'long' | 'short'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('pnl');
  const [closeAllOpen, setCloseAllOpen] = useState(false);
  const [closingAll, setClosingAll] = useState(false);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refresh();
    }, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const visible = useMemo(() => {
    let list: PositionRecord[] = sideFilter === 'all' ? positions : positions.filter((p) => p.side === sideFilter);
    const margin = (p: PositionRecord) => p.marginSize ?? (p.openPriceAvg * p.size) / Math.max(1, p.leverage);
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'roe': {
          const ra = margin(a) > 0 ? a.unrealizedPL / margin(a) : 0;
          const rb = margin(b) > 0 ? b.unrealizedPL / margin(b) : 0;
          return rb - ra;
        }
        case 'size':
          return b.size * (b.markPrice ?? b.openPriceAvg) - a.size * (a.markPrice ?? a.openPriceAvg);
        case 'symbol':
          return a.symbol.localeCompare(b.symbol);
        default:
          return b.unrealizedPL - a.unrealizedPL;
      }
    });
    return list;
  }, [positions, sideFilter, sortKey]);

  const totalUpl = positions.reduce((s, p) => s + p.unrealizedPL, 0);
  const totalMargin = positions.reduce((s, p) => s + (p.marginSize ?? (p.size * p.openPriceAvg) / Math.max(1, p.leverage)), 0);
  const closeAllNotional = positions.reduce((s, p) => s + p.size * (p.markPrice ?? p.openPriceAvg), 0);

  const onClose = async (p: PositionRecord) => {
    const res = await closePositionApi(p.symbol, p.side, p.available, p.paper);
    if (res.ok) toast.success(t('positions.closeSuccess'));
    else toast.error(t('positions.closeFailed'), res.error);
    void refresh();
  };

  const closeAll = async () => {
    setClosingAll(true);
    try {
      // settle every close independently — one failure must not hide the rest
      const results = await Promise.allSettled(
        positions.map((p) => closePositionApi(p.symbol, p.side, p.available, p.paper)),
      );
      const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
      const failed = results.length - ok;
      if (failed > 0) toast.error(t('trade.closeAllPartial', { ok: String(ok), failed: String(failed) }));
      else toast.success(t('trade.closeAllDone', { count: String(ok) }));
      setCloseAllOpen(false);
      void refresh();
    } finally {
      setClosingAll(false);
    }
  };

  return (
    <div className="w-full space-y-3 p-3 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{t('positions.title')}</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void refresh()}>{t('common.refresh')}</Button>
          {positions.length > 0 && (
            <Button size="sm" variant="danger" onClick={() => setCloseAllOpen(true)}>
              {t('trade.closeAll')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('dashboard.equity')} value={`$${fmtAmount(summary?.totals.equityUsd, locale)}`} />
        <Stat label={t('dashboard.available')} value={`$${fmtAmount(summary?.totals.availableUsd, locale)}`} />
        <Stat
          label={t('positions.unrealizedPnl')}
          value={`${totalUpl >= 0 ? '+' : ''}${fmtAmount(totalUpl, locale)}`}
          tone={totalUpl >= 0 ? 'up' : 'down'}
        />
        <Stat label={t('trade.margin')} value={fmtAmount(totalMargin, locale)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          size="xs"
          value={sideFilter}
          onChange={(v) => setSideFilter(v as typeof sideFilter)}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'long', label: t('common.long') },
            { value: 'short', label: t('common.short') },
          ]}
        />
        <Segmented
          size="xs"
          value={sortKey}
          onChange={(v) => setSortKey(v as SortKey)}
          options={[
            { value: 'pnl', label: t('positions.sortPnl') },
            { value: 'roe', label: t('trade.roe') },
            { value: 'size', label: t('common.size') },
            { value: 'symbol', label: t('common.symbol') },
          ]}
        />
      </div>

      <Card className="overflow-hidden p-1">
        <div className="max-h-[calc(100dvh-380px)] overflow-y-auto">
          <PositionsTable positions={visible} onClose={onClose} onChanged={() => void refresh()} />
        </div>
      </Card>

      <ConfirmDialog
        open={closeAllOpen}
        onClose={() => setCloseAllOpen(false)}
        onConfirm={closeAll}
        title={t('trade.closeAllConfirmTitle')}
        confirmLabel={t('trade.closeAll')}
        loading={closingAll}
      >
        <p className="text-sm leading-relaxed text-gray-700">{t('trade.closeAllConfirmText', { count: String(positions.length), notional: fmtAmount(closeAllNotional, locale) })}</p>
        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md bg-gray-50 px-2.5 py-2 text-2xs text-gray-500">
          {positions.map((p) => (
            <div key={`${p.symbol}-${p.side}`} className="flex justify-between">
              <span>
                <SymbolLink symbol={p.symbol} className="text-2xs" /> · {p.side === 'long' ? t('common.long') : t('common.short')} ×{p.leverage}
              </span>
              <span className={p.unrealizedPL >= 0 ? 'text-up' : 'text-down'}>
                {p.unrealizedPL >= 0 ? '+' : ''}{fmtAmount(p.unrealizedPL, locale)}
              </span>
            </div>
          ))}
        </div>
      </ConfirmDialog>
    </div>
  );
}
