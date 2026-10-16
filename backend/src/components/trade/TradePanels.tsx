'use client';

import React, { useState } from 'react';
import { cn, floorTo } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Badge, Table, THead, TR, TH, TD, EmptyState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useTradeIntent } from '@/stores/tradeIntent';
import { useRouter } from 'next/navigation';
import { fmtAmount, fmtPrice, fmtQty, fmtTime, fmtSignedPct } from '@/lib/format';
import { closePositionApi } from '@/hooks/useOrders';
import type { OrderRecord, PositionRecord } from '@/core/types';

export function statusBadge(status: string, t: (k: string) => string) {
  const map: Record<string, 'brand' | 'up' | 'down' | 'gray' | 'amber'> = {
    live: 'brand', partially_filled: 'amber', filled: 'up', canceled: 'gray', failed: 'down',
  };
  return <Badge tone={map[status] ?? 'gray'}>{t(`ordersPage.status_${status}`)}</Badge>;
}

export function sideLabel(order: Pick<OrderRecord, 'side' | 'tradeSide' | 'marketType'>, t: (k: string) => string): { text: string; tone: 'up' | 'down' } {
  const long = order.side === 'buy';
  const open = order.marketType === 'spot' || order.tradeSide !== 'close';
  const text = order.marketType === 'futures' ? (open ? t('common.long') : t('common.short')) : long ? t('common.buy') : t('common.sell');
  return { text: `${text}${order.marketType === 'futures' ? (open ? `·${t('trade.openSide')}` : `·${t('trade.closeSide')}`) : ''}`, tone: long ? 'up' : 'down' };
}

/** Clickable symbol that deep-links into the trade workbench. */
export function SymbolLink({ symbol, className }: { symbol: string; className?: string }) {
  const setIntent = useTradeIntent((s) => s.set);
  const router = useRouter();
  return (
    <button
      type="button"
      className={cn('font-medium text-gray-900 hover:text-brand-600 hover:underline', className)}
      onClick={() => {
        setIntent({ symbol, marketType: undefined });
        router.push('/trade');
      }}
    >
      {symbol}
    </button>
  );
}

export function PositionsTable({
  positions, onClose, upTone, downTone, compact, onChanged,
}: {
  positions: PositionRecord[];
  onClose?: (p: PositionRecord) => void;
  upTone?: string;
  downTone?: string;
  compact?: boolean;
  /** called after a partial close / TP-SL edit so the parent can refresh */
  onChanged?: () => void;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [partialFor, setPartialFor] = useState<PositionRecord | null>(null);
  const [tpslFor, setTpslFor] = useState<PositionRecord | null>(null);
  if (!positions.length) {
    return <EmptyState title={t('positions.empty')} />;
  }
  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>{t('common.symbol')}</TH>
            <TH>{t('trade.side')}</TH>
            <TH className="text-right">{t('positions.size')}</TH>
            {compact || <TH className="text-right">{t('positions.available')}</TH>}
            <TH className="text-right">{t('positions.entryPrice')}</TH>
            <TH className="text-right">{t('positions.markPrice')}</TH>
            <TH className="text-right">{t('trade.liqPrice')}</TH>
            <TH className="text-right">{t('positions.leverage')}</TH>
            <TH className="text-right">{t('positions.unrealizedPnl')}</TH>
            <TH className="text-right">{t('trade.roe')}</TH>
            {onClose && <TH className="text-right">{t('common.actions')}</TH>}
          </TR>
        </THead>
        <tbody>
          {positions.map((p, i) => {
            const long = p.side === 'long';
            const margin = p.marginSize ?? (p.openPriceAvg && p.size ? (p.openPriceAvg * p.size) / Math.max(1, p.leverage) : 0);
            const roe = margin > 0 ? p.unrealizedPL / margin : 0;
            const pnlTone = p.unrealizedPL >= 0 ? (upTone ?? 'text-up') : (downTone ?? 'text-down');
            return (
              <TR key={`${p.symbol}-${p.side}-${i}`}>
                <TD>
                  <SymbolLink symbol={p.symbol} />
                  {p.paper && <Badge tone="amber" className="ml-1.5">{t('positions.paper')}</Badge>}
                </TD>
                <TD>
                  <span className={cn('font-medium', long ? (upTone ?? 'text-up') : (downTone ?? 'text-down'))}>
                    {long ? t('common.long') : t('common.short')}
                  </span>
                  <span className="ml-1 text-gray-400">{p.marginMode === 'crossed' ? t('positions.cross') : t('positions.isolated')}</span>
                </TD>
                <TD className="text-right tabular-nums">{fmtAmount(p.size, locale)}</TD>
                {compact || <TD className="text-right tabular-nums">{fmtAmount(p.available, locale)}</TD>}
                <TD className="text-right tabular-nums">{fmtPrice(p.openPriceAvg, locale)}</TD>
                <TD className="text-right tabular-nums">{fmtPrice(p.markPrice, locale)}</TD>
                <TD className="text-right tabular-nums text-gray-400">{fmtPrice(p.liquidationPrice, locale)}</TD>
                <TD className="text-right tabular-nums">{p.leverage}×</TD>
                <TD className={cn('text-right tabular-nums font-medium', pnlTone)}>
                  {p.unrealizedPL >= 0 ? '+' : ''}{fmtAmount(p.unrealizedPL, locale)}
                </TD>
                <TD className={cn('text-right tabular-nums', pnlTone)}>{fmtSignedPct(roe, locale)}</TD>
                {onClose && (
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setTpslFor(p)} title={t('trade.slTp')}>
                        {t('trade.slTpShort')}
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => setPartialFor(p)}>
                        {t('trade.closePosition')}
                      </Button>
                    </div>
                  </TD>
                )}
              </TR>
            );
          })}
        </tbody>
      </Table>

      {partialFor && (
        <PartialCloseDialog
          position={partialFor}
          onClose={() => setPartialFor(null)}
          onDone={() => {
            setPartialFor(null);
            onChanged?.();
          }}
        />
      )}
      {tpslFor && (
        <TpSlDialog
          position={tpslFor}
          onClose={() => setTpslFor(null)}
          onDone={() => {
            setTpslFor(null);
            onChanged?.();
          }}
        />
      )}
    </>
  );
}

/** Partial close: market close a fraction (25/50/75%) or a custom size. */
function PartialCloseDialog({ position, onClose, onDone }: { position: PositionRecord; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [pct, setPct] = useState(50);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const size = custom !== '' ? parseFloat(custom) || 0 : floorTo((position.available * pct) / 100, 6);

  const submit = async () => {
    if (!(size > 0) || size > position.available) return;
    setBusy(true);
    try {
      const res = await closePositionApi(position.symbol, position.side, size, position.paper);
      if (res.ok) toast.success(t('positions.closeSuccess'));
      else toast.error(t('positions.closeFailed'), res.error);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('trade.partialClose', { symbol: position.symbol })}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant={position.side === 'long' ? 'sell' : 'buy'} loading={busy} disabled={!(size > 0)} onClick={submit}>
            {t('trade.closePosition')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          {[25, 50, 75, 100].map((p) => (
            <button
              key={p}
              onClick={() => {
                setPct(p);
                setCustom('');
              }}
              className={cn(
                'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium tabular-nums transition-colors',
                custom === '' && pct === p ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:border-gray-300',
              )}
            >
              {p}%
            </button>
          ))}
        </div>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3">
          <span className="text-2xs text-gray-400">{t('trade.quantity')}</span>
          <input
            inputMode="decimal"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={fmtQty((position.available * pct) / 100, 6)}
            className="w-full bg-transparent text-right text-sm tabular-nums outline-none"
          />
          <span className="text-2xs text-gray-400">/ {fmtQty(position.available, 6)}</span>
        </label>
        <p className="text-2xs text-gray-400">
          {t('trade.closeSide')} · {position.side === 'long' ? t('common.long') : t('common.short')} · {position.paper ? t('positions.paper') : t('positions.live')}
        </p>
      </div>
    </Dialog>
  );
}

/** Edit stop-loss / take-profit on an open position (absolute prices). */
function TpSlDialog({ position, onClose, onDone }: { position: PositionRecord; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const long = position.side === 'long';
  const [slPrice, setSlPrice] = useState(
    position.slPct ? String(position.openPriceAvg * (1 + (long ? -1 : 1) * position.slPct / 100)) : '',
  );
  const [tpPrice, setTpPrice] = useState(
    position.tpPct ? String(position.openPriceAvg * (1 + (long ? 1 : -1) * position.tpPct / 100)) : '',
  );
  const [busy, setBusy] = useState(false);

  const slNum = parseFloat(slPrice) || 0;
  const tpNum = parseFloat(tpPrice) || 0;
  // sanity: SL below entry for longs, above for shorts (and vice versa for TP)
  const slInvalid = slNum > 0 && (long ? slNum >= position.openPriceAvg : slNum <= position.openPriceAvg);
  const tpInvalid = tpNum > 0 && (long ? tpNum <= position.openPriceAvg : tpNum >= position.openPriceAvg);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/trade/tpsl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: position.symbol,
          side: position.side,
          slPrice: slNum > 0 ? slNum : undefined,
          tpPrice: tpNum > 0 ? tpNum : undefined,
          paper: position.paper,
        }),
      });
      const j = await res.json();
      if (j?.ok) {
        toast.success(t('trade.tpslUpdated'));
        onDone();
      } else {
        toast.error(t('trade.tpslFailed'), j?.error);
      }
    } catch (e) {
      toast.error(t('trade.tpslFailed'), String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('trade.editTpSl', { symbol: position.symbol })}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={busy} disabled={slInvalid || tpInvalid} onClick={submit}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-2xs text-gray-400">
          {t('trade.editTpSlHint', { entry: fmtPrice(position.openPriceAvg, locale), mark: fmtPrice(position.markPrice, locale) })}
        </p>
        <label className="block">
          <span className="text-2xs text-down">{t('trade.slPrice')}</span>
          <input
            inputMode="decimal"
            value={slPrice}
            onChange={(e) => setSlPrice(e.target.value)}
            placeholder={long ? '< ' + fmtPrice(position.openPriceAvg, locale) : '> ' + fmtPrice(position.openPriceAvg, locale)}
            className={cn(
              'mt-1 h-9 w-full rounded-lg border bg-white px-3 text-right text-sm tabular-nums outline-none focus:border-brand-500',
              slInvalid ? 'border-down' : 'border-gray-300',
            )}
          />
        </label>
        <label className="block">
          <span className="text-2xs text-up">{t('trade.tpPrice')}</span>
          <input
            inputMode="decimal"
            value={tpPrice}
            onChange={(e) => setTpPrice(e.target.value)}
            placeholder={long ? '> ' + fmtPrice(position.openPriceAvg, locale) : '< ' + fmtPrice(position.openPriceAvg, locale)}
            className={cn(
              'mt-1 h-9 w-full rounded-lg border bg-white px-3 text-right text-sm tabular-nums outline-none focus:border-brand-500',
              tpInvalid ? 'border-down' : 'border-gray-300',
            )}
          />
        </label>
        <p className="text-2xs leading-relaxed text-gray-400">
          {position.paper ? t('trade.tpslPaperNote') : t('trade.tpslLiveNote')}
        </p>
      </div>
    </Dialog>
  );
}

export function OrdersTable({
  orders, onCancel, mode,
}: {
  orders: OrderRecord[];
  onCancel?: (o: OrderRecord) => void;
  mode: 'pending' | 'history' | 'fills';
}) {
  const { t, locale } = useI18n();
  if (!orders.length) {
    return <EmptyState title={mode === 'pending' ? t('ordersPage.emptyPending') : mode === 'history' ? t('ordersPage.emptyHistory') : t('ordersPage.emptyFills')} />;
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH>{t('common.time')}</TH>
          <TH>{t('common.symbol')}</TH>
          <TH>{t('trade.side')}</TH>
          {mode !== 'fills' && <TH>{t('ordersPage.orderType')}</TH>}
          <TH className="text-right">{mode === 'fills' ? t('common.avgPrice') : t('common.price')}</TH>
          <TH className="text-right">{t('common.size')}</TH>
          {mode !== 'fills' && <TH className="text-right">{t('trade.fills')}</TH>}
          {mode === 'history' && <TH className="text-right">{t('backtest.pnl')}</TH>}
          {mode !== 'fills' && <TH>{t('ordersPage.status')}</TH>}
          {mode === 'pending' && onCancel && <TH className="text-right">{t('common.actions')}</TH>}
        </TR>
      </THead>
      <tbody>
        {orders.map((o, idx) => {
          const sl = sideLabel(o, t);
          return (
            <TR key={`${o.orderId}-${idx}`}>
              <TD className="text-gray-500">{fmtTime(o.ts, locale)}</TD>
              <TD><SymbolLink symbol={o.symbol} /></TD>
              <TD>
                <span className={cn('font-medium', sl.tone === 'up' ? 'text-up' : 'text-down')}>{sl.text}</span>
                {o.source === 'strategy' && <Badge tone="purple" className="ml-1.5">{t('ordersPage.strategyTag')}</Badge>}
                {o.strategyId?.startsWith('pp') || o.orderId.startsWith('pp_') ? (
                  <Badge tone="amber" className="ml-1">{t('ordersPage.paperTag')}</Badge>
                ) : null}
              </TD>
              {mode !== 'fills' && <TD>{o.orderType === 'limit' ? t('trade.limit') : t('trade.market')}</TD>}
              <TD className="text-right tabular-nums">{fmtPrice(o.avgPrice ?? o.price, locale)}</TD>
              <TD className="text-right tabular-nums">{fmtAmount(o.filledSize || o.size, locale)}</TD>
              {mode !== 'fills' && <TD className="text-right tabular-nums">{fmtAmount(o.filledSize, locale)}</TD>}
              {mode === 'history' && (
                <TD className={cn('text-right tabular-nums', (o.pnl ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                  {o.pnl != null ? `${o.pnl >= 0 ? '+' : ''}${fmtAmount(o.pnl, locale)}` : '—'}
                </TD>
              )}
              {mode !== 'fills' && <TD>{statusBadge(o.status, t)}</TD>}
              {mode === 'pending' && onCancel && (
                <TD className="text-right">
                  <Button size="xs" variant="outline" onClick={() => onCancel(o)}>{t('trade.cancelOrder')}</Button>
                </TD>
              )}
            </TR>
          );
        })}
      </tbody>
    </Table>
  );
}
