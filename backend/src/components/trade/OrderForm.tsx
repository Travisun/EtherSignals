'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { cn, clamp } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/tabs';
import { useMarketStore, marketKey } from '@/lib/marketWs';
import { useAccountStore } from '@/stores/account';
import { useTradeIntent } from '@/stores/tradeIntent';
import { usePrefs } from '@/stores/prefs';
import { fmtAmount, fmtPrice, fmtQty } from '@/lib/format';
import type { Locale } from '@/lib/format';
import type { MarketType, OrderSide, OrderType } from '@/core/types';

interface InstrumentSpec {
  pricePrecision: number;
  quantityPrecision: number;
  priceTick?: number;
  minTradeAmount?: number;
  minTradeUSDT?: number;
}

interface OrderFormProps {
  symbol: string;
  marketType: MarketType;
  leverage: number;
  initialSide?: OrderSide;
  onLeverageChange?: (lev: number) => void;
}

/** Professional order entry: limit/market, buy/sell, size slider, risk confirm. */
export function OrderForm({ symbol, marketType, leverage, initialSide, onLeverageChange }: OrderFormProps) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const ticker = useMarketStore((s) => s.tickers[marketKey(marketType, symbol)]);
  const summary = useAccountStore((s) => s.summary);
  const prefill = useTradeIntent((s) => s.prefill);
  const setIntent = useTradeIntent((s) => s.set);
  const paperMode = usePrefs((s) => s.engineStatus?.paper ?? false);

  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [slPct, setSlPct] = useState('');
  const [tpPct, setTpPct] = useState('');
  const [slTpOpen, setSlTpOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [accounts, setAccounts] = useState<{ id: string; label: string }[]>([]);
  const [accountId, setAccountId] = useState('paper');
  const [spec, setSpec] = useState<InstrumentSpec | null>(null);
  /** false → live orders submit without the confirmation dialog (user setting) */
  const [confirmOrders, setConfirmOrders] = useState(true);
  const effectivePaper = paperMode || accountId === 'paper';

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) {
          setAccounts(j.data.settings.accounts);
          if (typeof j.data.settings.risk?.confirmOrders === 'boolean') {
            setConfirmOrders(j.data.settings.risk.confirmOrders);
          }
        }
      })
      .catch(() => undefined);
  }, []);

  // exchange instrument constraints: precision / tick / minimums
  useEffect(() => {
    let dead = false;
    fetch(`/api/market/instrument?symbol=${symbol}&marketType=${marketType}`)
      .then((r) => r.json())
      .then((j) => {
        if (!dead && j?.ok && j.data?.instrument) setSpec(j.data.instrument);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [symbol, marketType]);

  useEffect(() => {
    if (prefill) {
      if (prefill.side) setSide(prefill.side);
      if (prefill.price) {
        setOrderType('limit');
        setPrice(String(prefill.price));
      }
      if (prefill.size) setSize(String(prefill.size));
      // AI advice carries a full plan — apply the SL/TP percentages too
      const p = prefill as typeof prefill & { slPct?: number; tpPct?: number };
      if (p.slPct && p.slPct > 0) setSlPct(String(p.slPct));
      if (p.tpPct && p.tpPct > 0) setTpPct(String(p.tpPct));
      setIntent({ prefill: undefined });
    }
  }, [prefill, setIntent]);

  useEffect(() => {
    if (initialSide) setSide(initialSide);
  }, [initialSide]);

  useEffect(() => {
    if (orderType === 'market' && ticker?.last) setPrice('');
  }, [orderType, ticker?.last]);

  const qPrec = spec?.quantityPrecision ?? 4;
  const priceStep = spec?.priceTick ?? (ticker?.last && ticker.last < 1 ? 0.0001 : ticker?.last && ticker.last < 100 ? 0.01 : 0.5);

  const useLast = () => {
    if (ticker?.last) {
      setOrderType('limit');
      setPrice(fmtQty(ticker.last, 8));
    }
  };

  /** nudge the limit price by whole ticks (keyboard-friendly, exchange-aligned) */
  const stepPrice = (dir: 1 | -1) => {
    const cur = parseFloat(price) || ticker?.last;
    if (!cur) return;
    const next = clamp(cur + dir * priceStep, priceStep, Number.MAX_SAFE_INTEGER);
    setPrice(fmtQty(next, 8));
  };

  const availableUsdt = useMemo(() => {
    if (!summary) return 0;
    if (marketType === 'futures') {
      return summary.futures.find((f) => f.marginCoin === 'USDT')?.available ?? summary.totals.availableUsd;
    }
    return summary.spot.find((a) => a.coin === 'USDT')?.available ?? 0;
  }, [summary, marketType]);

  // spot sells draw from the base coin balance, not USDT
  const baseCoin = symbol.replace(/(USDT|USDC|BTC|ETH|USD)$/, '');
  const availableBase = useMemo(() => {
    if (marketType !== 'spot' || !summary) return 0;
    return summary.spot.find((a) => a.coin === baseCoin)?.available ?? 0;
  }, [summary, marketType, baseCoin]);
  const isSpotSell = marketType === 'spot' && side === 'sell';
  const effectiveAvailable = isSpotSell ? availableBase : availableUsdt;

  const effPrice = parseFloat(price) || ticker?.last || 0;
  const sizeNum = parseFloat(size) || 0;
  const notional = sizeNum * effPrice;
  const marginNeeded = marketType === 'futures' ? notional / Math.max(1, leverage) : notional;
  // rough liquidation estimate: entry moved against by (1/lev − maint. margin)
  const liqEstimate =
    marketType === 'futures' && effPrice > 0 && side && leverage > 1
      ? effPrice * (1 + (side === 'buy' ? -1 : 1) * (1 / leverage - 0.005))
      : 0;

  // TP/SL percent inputs (futures only): levels are derived from the entry
  // price — the limit price for limit orders, the latest price for market
  const slPctNum = parseFloat(slPct) || 0;
  const tpPctNum = parseFloat(tpPct) || 0;
  const slInvalid = slPctNum !== 0 && (slPctNum <= 0 || slPctNum >= 100);
  const tpInvalid = tpPctNum !== 0 && (tpPctNum <= 0 || tpPctNum >= 100);
  const slPrice = slPctNum > 0 ? effPrice * (1 + (side === 'buy' ? -1 : 1) * slPctNum / 100) : 0;
  const tpPrice = tpPctNum > 0 ? effPrice * (1 + (side === 'buy' ? 1 : -1) * tpPctNum / 100) : 0;
  const slTpActive = slPctNum > 0 || tpPctNum > 0;

  const maxSize = useMemo(() => {
    if (!effPrice) return 0;
    if (isSpotSell) return availableBase; // sell: base coin balance
    const base = marketType === 'futures' ? availableUsdt * leverage : availableUsdt;
    return base / effPrice;
  }, [isSpotSell, availableBase, availableUsdt, effPrice, leverage, marketType]);

  const insufficient = !isSpotSell && marginNeeded > availableUsdt && sizeNum > 0;
  const belowMin = spec?.minTradeAmount != null && sizeNum > 0 && sizeNum < spec.minTradeAmount;
  const belowMinUsd = spec?.minTradeUSDT != null && notional > 0 && notional < spec.minTradeUSDT;

  const submit = async () => {
    setSubmitting(true);
    try {
      // exchange-aligned rounding: never exceed the quote precision
      const snappedSize = Number(fmtQty(sizeNum, qPrec));
      const res = await fetch('/api/trade/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          marketType,
          side,
          orderType,
          size: snappedSize,
          // market orders carry the reference price: required for spot market
          // buys (quote amount) and paper fills
          price: orderType === 'limit' ? parseFloat(price) : effPrice || undefined,
          leverage: marketType === 'futures' ? leverage : undefined,
          tradeSide: marketType === 'futures' ? 'open' : undefined,
          stopLossPct: marketType === 'futures' && slPctNum > 0 ? slPctNum : undefined,
          takeProfitPct: marketType === 'futures' && tpPctNum > 0 ? tpPctNum : undefined,
          paper: effectivePaper ? true : undefined,
          accountId: !effectivePaper && accountId !== 'paper' ? accountId : undefined,
        }),
      });
      const j = await res.json();
      if (j?.ok && j.data?.ok) {
        toast.success(t('trade.orderSubmitted'), t('trade.orderSent'));
        setSize('');
        setConfirmOpen(false);
      } else {
        toast.error(t('trade.orderFailed'), j?.error ?? j?.data?.error ?? t('common.requestFailed'));
      }
    } catch (e) {
      toast.error(t('trade.orderFailed'), String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    sizeNum > 0 &&
    (orderType === 'market' || parseFloat(price) > 0) &&
    !slInvalid &&
    !tpInvalid &&
    !belowMin &&
    !belowMinUsd;

  return (
    <div className="flex flex-col gap-3 p-3">
      <label className="flex h-9 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 transition-colors focus-within:border-brand-500">
        <span className="text-2xs text-gray-400">{t('trade.account')}</span>
        <select
          value={paperMode ? 'paper' : accountId}
          onChange={(e) => setAccountId(e.target.value)}
          disabled={paperMode}
          className="w-full bg-transparent text-right text-xs font-medium outline-none disabled:text-gray-400"
        >
          <option value="paper">📝 {t('strategies.paperExec')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>🏦 {a.label || a.id.slice(0, 8)}</option>
          ))}
        </select>
      </label>

      <Segmented
        block
        value={side}
        onChange={(v) => setSide(v as OrderSide)}
        options={[
          { value: 'buy', label: <span className={side === 'buy' ? 'text-up' : ''}>{marketType === 'futures' ? t('common.long') : t('common.buy')}</span> },
          { value: 'sell', label: <span className={side === 'sell' ? 'text-down' : ''}>{marketType === 'futures' ? t('common.short') : t('common.sell')}</span> },
        ]}
      />
      <Segmented
        block
        size="xs"
        value={orderType}
        onChange={(v) => setOrderType(v as OrderType)}
        options={[
          { value: 'limit', label: t('trade.limit') },
          { value: 'market', label: t('trade.market') },
        ]}
      />

      <div
        className={cn(
          'flex h-9 items-center gap-1 rounded-lg border bg-white px-2 transition-colors focus-within:border-brand-500',
          orderType === 'market' && 'opacity-70',
        )}
      >
        <span className="shrink-0 pl-1 text-2xs text-gray-400">{t('common.price')}</span>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => stepPrice(-1)}
          disabled={orderType === 'market'}
          className="h-6 w-6 shrink-0 rounded bg-gray-100 text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-40"
          title={`−${priceStep}`}
        >
          −
        </button>
        <input
          inputMode="decimal"
          value={orderType === 'market' ? t('trade.market') : price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={() => {
            // snap to the exchange tick on blur so live orders never reprice
            const v = parseFloat(price);
            if (Number.isFinite(v) && v > 0) setPrice(fmtQty(Math.round(v / priceStep) * priceStep, 8));
          }}
          disabled={orderType === 'market'}
          placeholder="0.00"
          className="w-full bg-transparent text-center text-sm tabular-nums outline-none placeholder:text-gray-300 disabled:text-gray-400"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => stepPrice(1)}
          disabled={orderType === 'market'}
          className="h-6 w-6 shrink-0 rounded bg-gray-100 text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-40"
          title={`+${priceStep}`}
        >
          +
        </button>
        <button onClick={useLast} className="mr-1 shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-2xs text-gray-500 hover:bg-gray-200">
          {t('trade.usePrice')}
        </button>
      </div>

      {marketType === 'futures' && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-1.5">
          <span className="text-2xs text-gray-400">{t('trade.leverage')}</span>
          <input
            type="range"
            min={1}
            max={50}
            value={leverage}
            onChange={(e) => onLeverageChange?.(Number(e.target.value))}
            className="h-1 flex-1 accent-brand-600"
          />
          <span className="w-10 text-right text-xs font-semibold tabular-nums text-gray-700">{leverage}×</span>
        </div>
      )}

      <label className="flex h-9 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 transition-colors focus-within:border-brand-500">
        <span className="text-2xs text-gray-400">{t('trade.quantity')}</span>
        <input
          inputMode="decimal"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder="0.00"
          className="w-full bg-transparent text-right text-sm tabular-nums outline-none placeholder:text-gray-300"
        />
        <span className="shrink-0 text-2xs text-gray-400">{symbol.replace(/USDT$/, '')}</span>
      </label>

      <div>
        <input
          type="range"
          min={0}
          max={100}
          disabled={!maxSize}
          value={maxSize ? Math.min(100, ((isSpotSell ? sizeNum / (maxSize || 1) : notional / (availableUsdt * (marketType === 'futures' ? leverage : 1) || 1)) * 100)) : 0}
          onChange={(e) => {
            const pct = Number(e.target.value) / 100;
            setSize(fmtQty(maxSize * pct, qPrec));
          }}
          className="h-1 w-full accent-brand-600 disabled:opacity-40"
        />
        <div className="mt-1 flex justify-between text-2xs text-gray-400">
          {[25, 50, 75, 100].map((p) => (
            <button key={p} disabled={!maxSize} onClick={() => setSize(fmtQty(maxSize * (p / 100), qPrec))} className="hover:text-gray-700 disabled:opacity-40">
              {p}%
            </button>
          ))}
        </div>
      </div>

      {marketType === 'futures' && (
        <div className="rounded-lg border border-gray-200 bg-white">
          <button
            type="button"
            onClick={() => setSlTpOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-2xs text-gray-500 transition-colors hover:text-gray-700"
          >
            <span className="flex items-center gap-1.5">
              {t('trade.slTp')}
              {slTpActive && (
                <span className="rounded bg-brand-50 px-1 py-px font-medium text-brand-700">
                  {tpPctNum > 0 ? `TP ${tpPctNum}%` : ''}{tpPctNum > 0 && slPctNum > 0 ? ' · ' : ''}{slPctNum > 0 ? `SL ${slPctNum}%` : ''}
                </span>
              )}
            </span>
            <span className={cn('text-gray-300 transition-transform', slTpOpen && 'rotate-180')}>▾</span>
          </button>
          {slTpOpen && (
            <div className="space-y-2 border-t border-gray-100 px-3 py-2.5">
              <p className="text-2xs leading-relaxed text-gray-400">{t('trade.slTpHint')}</p>
              <SlTpRow
                label={t('trade.tpPct')}
                value={tpPct}
                onChange={setTpPct}
                invalid={tpInvalid}
                levelPrice={tpPrice}
                side={side}
                locale={locale}
                chips={[1, 2, 5, 10]}
              />
              <SlTpRow
                label={t('trade.slPct')}
                value={slPct}
                onChange={setSlPct}
                invalid={slInvalid}
                levelPrice={slPrice}
                side={side}
                locale={locale}
                chips={[0.5, 1, 2, 5]}
              />
            </div>
          )}
        </div>
      )}

      <div className="space-y-1 rounded-lg bg-gray-50/80 px-3 py-2 text-2xs text-gray-500">
        <Row label={t('trade.available')} value={isSpotSell ? `${fmtAmount(availableBase, locale)} ${baseCoin}` : `${fmtAmount(availableUsdt, locale)} USDT`} />
        <Row label={t('trade.estimated')} value={isSpotSell ? `${fmtAmount(notional, locale)} USDT` : `${fmtAmount(marginNeeded, locale)} USDT`} />
        {marketType === 'futures' && <Row label={t('common.size')} value={`${fmtAmount(notional, locale)} USDT`} />}
        {liqEstimate > 0 && <Row label={t('trade.liqEstimate')} value={`≈ ${fmtPrice(liqEstimate, locale)}`} />}
        {tpPrice > 0 && <Row label={t('trade.tpPrice')} value={fmtPrice(tpPrice, locale)} />}
        {slPrice > 0 && <Row label={t('trade.slPrice')} value={fmtPrice(slPrice, locale)} />}
        {spec?.minTradeAmount != null && <Row label={t('trade.minSize')} value={fmtQty(spec.minTradeAmount, 8)} />}
      </div>

      {insufficient && <div className="rounded-md bg-down/5 px-3 py-1.5 text-2xs text-down">{t('trade.insufficient')}</div>}
      {belowMin && <div className="rounded-md bg-down/5 px-3 py-1.5 text-2xs text-down">{t('trade.belowMin', { min: String(spec?.minTradeAmount) })}</div>}
      {belowMinUsd && <div className="rounded-md bg-down/5 px-3 py-1.5 text-2xs text-down">{t('trade.belowMinUsd', { min: String(spec?.minTradeUSDT) })}</div>}
      {paperMode && <div className="rounded-md bg-amber-50 px-3 py-1.5 text-2xs text-amber-600">{t('trade.paperHint')}</div>}

      <Button
        variant={side === 'buy' ? 'buy' : 'sell'}
        size="lg"
        disabled={!canSubmit}
        loading={submitting}
        onClick={() => {
          if (effectivePaper || !confirmOrders) {
            void submit();
          } else {
            setConfirmOpen(true);
          }
        }}
      >
        {side === 'buy' ? t('trade.submitBuy') : t('trade.submitSell')}
      </Button>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('trade.confirmOrderTitle')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
            <Button variant={side === 'buy' ? 'buy' : 'sell'} loading={submitting} onClick={submit}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-gray-700">
          {t('trade.confirmOrderText', {
            side: side === 'buy' ? t('common.long') : t('common.short'),
            size: fmtAmount(sizeNum, locale),
            symbol,
            orderType: orderType === 'limit' ? `@ ${fmtPrice(parseFloat(price), locale)}` : t('trade.market'),
            notional: fmtAmount(notional, locale),
          })}
        </p>
        {(slPctNum > 0 || tpPctNum > 0) && (
          <div className="mt-2 space-y-1 rounded-md bg-gray-50 px-2.5 py-2 text-2xs text-gray-500">
            {tpPctNum > 0 && (
              <div className="flex justify-between">
                <span className="text-up">{t('trade.tpPct')} {tpPctNum}%</span>
                <span className="tabular-nums">{fmtPrice(tpPrice, locale)}</span>
              </div>
            )}
            {slPctNum > 0 && (
              <div className="flex justify-between">
                <span className="text-down">{t('trade.slPct')} {slPctNum}%</span>
                <span className="tabular-nums">{fmtPrice(slPrice, locale)}</span>
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-2xs leading-relaxed text-gray-400">{t('trade.confirmRisk')}</p>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="tabular-nums text-gray-700">{value}</span>
    </div>
  );
}

function SlTpRow({
  label, value, onChange, invalid, levelPrice, side, locale, chips,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  levelPrice: number;
  side: OrderSide;
  locale: Locale;
  chips: number[];
}) {
  return (
    <div>
      <div
        className={cn(
          'flex h-8 items-center gap-2 rounded-lg border bg-white px-2.5 transition-colors focus-within:border-brand-500',
          invalid ? 'border-down' : 'border-gray-300',
        )}
      >
        <span className={cn('text-2xs', side === 'buy' ? 'text-up' : 'text-down')}>{label}</span>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="w-full bg-transparent text-right text-xs tabular-nums outline-none placeholder:text-gray-300"
        />
        <span className="shrink-0 text-2xs text-gray-400">%</span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <div className="flex gap-2 text-2xs text-gray-400">
          {chips.map((p) => (
            <button key={p} type="button" onClick={() => onChange(String(p))} className="hover:text-gray-700">
              {p}%
            </button>
          ))}
        </div>
        {levelPrice > 0 && (
          <span className="text-2xs tabular-nums text-gray-400">≈ {fmtPrice(levelPrice, locale)}</span>
        )}
      </div>
    </div>
  );
}

export function SymbolStat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'up' | 'down' }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xs text-gray-400">{label}</span>
      <span className={cn('text-xs font-medium tabular-nums', tone === 'up' && 'text-up', tone === 'down' && 'text-down')}>{value}</span>
    </div>
  );
}
