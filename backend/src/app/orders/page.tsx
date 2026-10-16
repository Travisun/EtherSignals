'use client';

import React, { useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Card, Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Tabs, Segmented } from '@/components/ui/tabs';
import { OrdersTable } from '@/components/trade/TradePanels';
import { useOrders, cancelOrderApi, cancelAllApi } from '@/hooks/useOrders';
import type { MarketType } from '@/core/types';

export default function OrdersPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [marketType, setMarketType] = useState<MarketType>('futures');
  const [tab, setTab] = useState('pending');
  const [query, setQuery] = useState('');
  const [cancelAllOpen, setCancelAllOpen] = useState(false);
  const [cancelingAll, setCancelingAll] = useState(false);
  const orders = useOrders(marketType, { pollMs: 10_000 });

  const onCancel = async (o: { orderId: string; symbol: string }) => {
    const res = await cancelOrderApi(o.orderId, o.symbol, marketType);
    if (res.ok) toast.success(t('ordersPage.cancelSuccess'));
    else toast.error(t('ordersPage.cancelFailed'), res.error);
    orders.reload();
  };

  const onCancelAll = async () => {
    setCancelingAll(true);
    try {
      const res = await cancelAllApi(undefined, undefined);
      if (res.ok) toast.success(t('ordersPage.cancelAllDone', { count: String(res.canceled ?? 0) }));
      else toast.error(t('ordersPage.cancelFailed'), res.error);
      setCancelAllOpen(false);
      orders.reload();
    } finally {
      setCancelingAll(false);
    }
  };

  const match = (sym: string) => !query || sym.toUpperCase().includes(query.toUpperCase());
  const filtered = useMemo(
    () => ({
      pending: orders.pending.filter((o) => match(o.symbol)),
      history: orders.history.filter((o) => match(o.symbol)),
      fills: orders.fills.filter((o) => match(o.symbol)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders.pending, orders.history, orders.fills, query],
  );

  return (
    <div className="w-full space-y-3 p-3 md:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{t('ordersPage.title')}</h2>
        <Segmented
          value={marketType}
          onChange={(v) => setMarketType(v as MarketType)}
          options={[
            { value: 'futures', label: t('ordersPage.futures') },
            { value: 'spot', label: t('ordersPage.spot') },
          ]}
        />
        <Badge tone={orders.loading ? 'brand' : 'gray'}>{t('ordersPage.autoRefresh', { n: '10' })}</Badge>
        <div className="flex-1" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('ordersPage.searchPlaceholder')}
          className="h-8 w-40 rounded-lg border border-gray-300 bg-white px-2.5 text-xs outline-none focus:border-brand-500"
        />
        {tab === 'pending' && orders.pending.length > 0 && (
          <Button size="sm" variant="danger" onClick={() => setCancelAllOpen(true)}>
            {t('trade.cancelAll')}
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <Tabs
          tabs={[
            { key: 'pending', label: t('ordersPage.pending'), badge: orders.pending.length ? <span className="ml-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-2xs text-brand-600">{orders.pending.length}</span> : undefined },
            { key: 'history', label: t('ordersPage.history') },
            { key: 'fills', label: t('ordersPage.fills') },
          ]}
          active={tab}
          onChange={setTab}
          className="px-2 pt-1"
        />
        <div className="max-h-[calc(100dvh-260px)] overflow-y-auto p-1">
          {tab === 'pending' && <OrdersTable orders={filtered.pending} onCancel={onCancel} mode="pending" />}
          {tab === 'history' && <OrdersTable orders={filtered.history} mode="history" />}
          {tab === 'fills' && <OrdersTable orders={filtered.fills} mode="fills" />}
        </div>
      </Card>

      <ConfirmDialog
        open={cancelAllOpen}
        onClose={() => setCancelAllOpen(false)}
        onConfirm={onCancelAll}
        title={t('trade.cancelAll')}
        text={t('ordersPage.cancelAllConfirm', { count: String(orders.pending.length) })}
        confirmLabel={t('trade.cancelAll')}
        loading={cancelingAll}
      />
    </div>
  );
}
