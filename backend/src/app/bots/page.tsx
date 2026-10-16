'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Card, Badge, EmptyState, Stat } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ConditionRow } from '@/components/strategy/StrategyEditor';
import { Drawer } from '@/components/ui/dialog';
import { fmtAmount, fmtPrice, fmtTime } from '@/lib/format';
import { uid } from '@/lib/utils';
import { Grid3x3, Play, Plus, Square, Trash2, Pencil, RotateCcw } from 'lucide-react';
import type { Condition, ConditionLogic, GridBot, MarketType, Timeframe } from '@/core/types';

interface EditorState {
  id?: string;
  name: string;
  symbol: string;
  marketType: MarketType;
  paper: boolean;
  accountIds: string[];
  leverage: number;
  lowerPrice: number;
  upperPrice: number;
  grids: number;
  quantityPerGrid: number;
  initialBuy: boolean;
  entryLogic: 'all' | 'any';
  entryConditions: Condition[];
  stopLogic: ConditionLogic;
  stopConditions: Condition[];
}

function emptyEditor(symbol = 'BTCUSDT', price = 0): EditorState {
  const lower = price > 0 ? Number((price * 0.9).toPrecision(6)) : 0;
  const upper = price > 0 ? Number((price * 1.1).toPrecision(6)) : 0;
  return {
    name: '',
    symbol,
    marketType: 'futures',
    paper: true,
    accountIds: [],
    leverage: 2,
    lowerPrice: lower,
    upperPrice: upper,
    grids: 8,
    quantityPerGrid: 0.01,
    initialBuy: false,
    entryLogic: 'all',
    entryConditions: [],
    stopLogic: 'any',
    stopConditions: [],
  };
}

export default function BotsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [bots, setBots] = useState<GridBot[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; label: string }[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<GridBot | null>(null);
  const [resetting, setResetting] = useState<GridBot | null>(null);
  const [detail, setDetail] = useState<GridBot | null>(null);
  const [tickers, setTickers] = useState<Record<string, number>>({});

  const reload = useCallback(() => {
    fetch('/api/bots')
      .then((r) => r.json())
      .then((j) => j?.ok && setBots(j.data.bots))
      .catch(() => undefined);
    fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => j?.ok && setAccounts(j.data.settings.accounts))
      .catch(() => undefined);
    fetch('/api/market/tickers?marketType=futures')
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) {
          const map: Record<string, number> = {};
          for (const tk of j.data.tickers) map[tk.symbol] = tk.last;
          setTickers(map);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 8000);
    return () => clearInterval(timer);
  }, [reload]);

  const act = async (body: Record<string, unknown>, okMsg?: string) => {
    const res = await fetch('/api/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (j?.ok) {
      if (okMsg) toast.success(okMsg);
    } else {
      toast.error(t('common.requestFailed'), j?.error);
    }
    reload();
  };

  const remove = async () => {
    if (!deleting) return;
    await fetch(`/api/bots?id=${deleting.id}`, { method: 'DELETE' });
    setDeleting(null);
    reload();
  };

  const confirmReset = async () => {
    if (!resetting) return;
    const id = resetting.id;
    setResetting(null);
    await act({ id, action: 'reset-stats' }, t('settings.saved'));
  };

  const totalPnl = bots.reduce((s, b) => s + b.stats.realizedPnl, 0);

  return (
    <div className="w-full space-y-3 p-3 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{t('bots.title')}</h2>
          <p className="text-xs text-gray-400">{t('bots.subtitle')}</p>
        </div>
        <Button onClick={() => { setEditing(emptyEditor('BTCUSDT', tickers['BTCUSDT'] ?? 0)); setEditorOpen(true); }}>
          <Plus className="h-4 w-4" /> {t('bots.create')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('bots.total')} value={`${bots.length}`} sub={`${bots.filter((b) => b.status === 'running').length} ${t('strategies.started')}`} />
        <Stat label={t('bots.realizedPnl')} value={`${totalPnl >= 0 ? '+' : ''}${fmtAmount(totalPnl, locale)}`} tone={totalPnl >= 0 ? 'up' : 'down'} />
        <Stat label={t('bots.buyFills')} value={fmtAmount(bots.reduce((s, b) => s + b.stats.buyFills, 0), locale)} />
        <Stat label={t('bots.sellFills')} value={fmtAmount(bots.reduce((s, b) => s + b.stats.sellFills, 0), locale)} />
      </div>

      {bots.length === 0 && (
        <Card>
          <EmptyState icon={<Grid3x3 className="h-8 w-8" />} title={t('bots.empty')} action={<Button size="sm" onClick={() => { setEditing(emptyEditor('BTCUSDT', tickers['BTCUSDT'] ?? 0)); setEditorOpen(true); }}>{t('bots.create')}</Button>} />
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {bots.map((bot) => {
          const running = bot.status === 'running';
          const range = bot.upperPrice - bot.lowerPrice;
          const cur = tickers[bot.symbol] ?? bot.lastPrice ?? 0;
          const posInRange = range > 0 ? Math.min(1, Math.max(0, (cur - bot.lowerPrice) / range)) : 0;
          return (
            <Card key={bot.id} className={cn('p-4', running && 'ring-1 ring-up/30')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', running ? 'animate-pulse bg-up' : 'bg-gray-300')} />
                    <h3 className="truncate text-sm font-semibold">{bot.name}</h3>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-gray-500">
                    <Badge tone="brand">{bot.symbol}</Badge>
                    <Badge tone={bot.paper ? 'amber' : 'down'}>{bot.paper ? t('strategies.paperExec') : t('strategies.liveExec')}</Badge>
                    <Badge tone="purple">{bot.grids} {t('bots.gridsUnit')}</Badge>
                    {!bot.paper && bot.accountIds.length > 0 && <Badge tone="brand">🏦 {bot.accountIds.length}</Badge>}
                    {bot.entryConditions.length > 0 && <Badge tone="purple">{t('strategies.crossBadge')}</Badge>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant={running ? 'secondary' : 'success'} onClick={() => act({ id: bot.id, action: 'toggle' })}>
                    {running ? <><Square className="h-3 w-3" />{t('strategies.stop')}</> : <><Play className="h-3 w-3" />{t('strategies.start')}</>}
                  </Button>
                </div>
              </div>

              {/* price range bar */}
              <div className="mt-3">
                <div className="relative h-2 rounded-full bg-gray-100">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-brand-200" style={{ width: `${posInRange * 100}%` }} />
                  <div className="absolute -top-1 h-4 w-1 rounded bg-brand-600" style={{ left: `calc(${posInRange * 100}% - 2px)` }} />
                </div>
                <div className="mt-1 flex justify-between text-2xs tabular-nums text-gray-400">
                  <span>{fmtPrice(bot.lowerPrice, locale)}</span>
                  <span className="font-medium text-gray-700">{cur || '—'}</span>
                  <span>{fmtPrice(bot.upperPrice, locale)}</span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2 text-2xs">
                <MiniStat label={t('bots.realizedPnl')} value={`${bot.stats.realizedPnl >= 0 ? '+' : ''}${fmtAmount(bot.stats.realizedPnl, locale)}`} tone={bot.stats.realizedPnl >= 0 ? 'text-up' : 'text-down'} />
                <MiniStat label={t('bots.buyFills')} value={String(bot.stats.buyFills)} />
                <MiniStat label={t('bots.sellFills')} value={String(bot.stats.sellFills)} />
                <MiniStat label={t('bots.inventory')} value={String(bot.levels.filter((l) => l.hasInventory).length)} />
              </div>

              <div className="mt-3 flex items-center justify-between text-2xs text-gray-400">
                <button className="text-brand-600 hover:underline" onClick={() => setDetail(bot)}>{t('bots.viewTasks')}</button>
                <div className="flex gap-1">
                  <button onClick={() => setResetting(bot)} className="rounded p-1 hover:text-gray-700" title={t('bots.resetStats')}><RotateCcw className="h-3.5 w-3.5" /></button>
                  <button onClick={() => { setEditing(fromBot(bot)); setEditorOpen(true); }} className="rounded p-1 hover:text-brand-600" title={t('common.edit')}><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setDeleting(bot)} className="rounded p-1 hover:text-down" title={t('common.delete')}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <BotEditor open={editorOpen} state={editing} accounts={accounts} onClose={() => setEditorOpen(false)} onSaved={reload} />

      {/* detail drawer: levels + fills ledger */}
      <Drawer open={detail != null} onClose={() => setDetail(null)} side={typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'bottom' : 'right'} width="w-[460px]">
        {detail && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <span className="text-sm font-semibold">{detail.name} · {t('bots.tasksTitle')}</span>
              <button onClick={() => setDetail(null)} className="rounded p-1 text-gray-400"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <h4 className="mb-2 text-xs font-semibold text-gray-600">{t('bots.levels')}</h4>
                <div className="space-y-1">
                  {[...detail.levels].sort((a, b) => b.price - a.price).map((l) => (
                    <div key={l.price} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-2xs">
                      <span className="tabular-nums text-gray-600">{l.price}</span>
                      <Badge tone={l.hasInventory ? 'up' : 'gray'}>{l.hasInventory ? t('bots.holding') : t('bots.idle')}</Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold text-gray-600">{t('bots.fillsLog')}</h4>
                {detail.fills.length === 0 && <p className="text-2xs text-gray-400">{t('common.empty')}</p>}
                <div className="space-y-1">
                  {detail.fills.map((f, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-gray-50 px-3 py-1.5 text-2xs">
                      <span className={cn('font-medium', f.side === 'buy' ? 'text-up' : 'text-down')}>{f.side === 'buy' ? t('common.buy') : t('common.sell')}</span>
                      <span className="tabular-nums text-gray-500">{f.qty} @ {f.price}</span>
                      {f.pnl != null && <span className={cn('tabular-nums font-medium', f.pnl >= 0 ? 'text-up' : 'text-down')}>{f.pnl >= 0 ? '+' : ''}{fmtAmount(f.pnl, locale)}</span>}
                      <span className="text-gray-400">{fmtTime(f.ts, locale, false)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={deleting != null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        text={`${t('bots.deleteWarning')} (${deleting?.name ?? ''})`}
      />
      <ConfirmDialog
        open={resetting != null}
        onClose={() => setResetting(null)}
        onConfirm={confirmReset}
        danger={false}
        title={t('bots.resetStats')}
        text={`${t('bots.resetStats')} — ${resetting?.name ?? ''}`}
        confirmLabel={t('common.confirm')}
      />
    </div>
  );
}

function fromBot(b: GridBot): EditorState {
  return {
    id: b.id, name: b.name, symbol: b.symbol, marketType: b.marketType, paper: b.paper,
    accountIds: b.accountIds, leverage: b.leverage, lowerPrice: b.lowerPrice, upperPrice: b.upperPrice,
    grids: b.grids, quantityPerGrid: b.quantityPerGrid, initialBuy: b.initialBuy,
    entryLogic: b.entryLogic, entryConditions: b.entryConditions,
    stopLogic: b.stopLogic, stopConditions: b.stopConditions,
  };
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2 py-1.5 text-center">
      <div className="text-gray-400">{label}</div>
      <div className={cn('mt-0.5 font-medium tabular-nums text-gray-800', tone)}>{value}</div>
    </div>
  );
}

function BotEditor({
  open, state, accounts, onClose, onSaved,
}: {
  open: boolean;
  state: EditorState | null;
  accounts: { id: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState<EditorState | null>(state);
  const [saving, setSaving] = useState(false);
  const [gateTab, setGateTab] = useState<'entry' | 'stop'>('entry');

  React.useEffect(() => setForm(state), [state]);
  if (!form) return null;
  const patch = (p: Partial<EditorState>) => setForm((f) => (f ? { ...f, ...p } : f));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/bots', {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (j?.ok) {
        toast.success(t('settings.saved'));
        onSaved();
        onClose();
      } else {
        toast.error(t('common.requestFailed'), j?.error);
      }
    } finally {
      setSaving(false);
    }
  };

  const step = form.upperPrice > form.lowerPrice && form.grids > 0 ? (form.upperPrice - form.lowerPrice) / form.grids : 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={form.id ? `${t('common.edit')} · ${form.name}` : t('bots.create')}
      description={step > 0 ? `${t('bots.stepSize')}: ${step.toPrecision(6)}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={saving} onClick={save}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('strategies.name')}>
            <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t('bots.namePlaceholder')} />
          </Field>
          <Field label={t('strategies.symbol')}>
            <Input value={form.symbol} onChange={(e) => patch({ symbol: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={t('common.type')}>
            <Segmented block value={form.marketType} onChange={(v) => patch({ marketType: v as MarketType })} options={[{ value: 'futures', label: t('markets.futures') }, { value: 'spot', label: t('markets.spot') }]} />
          </Field>
          <Field label={t('strategies.orderAction')}>
            <Segmented block value={form.paper ? 'paper' : 'live'} onChange={(v) => patch({ paper: v === 'paper' })} options={[{ value: 'paper', label: t('strategies.paperExec') }, { value: 'live', label: t('strategies.liveExec') }]} />
          </Field>
          <Field label={t('bots.lower')}>
            <Input inputMode="decimal" value={String(form.lowerPrice)} onChange={(e) => patch({ lowerPrice: Number(e.target.value) || 0 })} />
          </Field>
          <Field label={t('bots.upper')}>
            <Input inputMode="decimal" value={String(form.upperPrice)} onChange={(e) => patch({ upperPrice: Number(e.target.value) || 0 })} />
          </Field>
          <Field label={t('bots.gridsCount')}>
            <Input inputMode="numeric" value={String(form.grids)} onChange={(e) => patch({ grids: Number(e.target.value) || 2 })} />
          </Field>
          <Field label={t('bots.qtyPerGrid')}>
            <Input inputMode="decimal" value={String(form.quantityPerGrid)} onChange={(e) => patch({ quantityPerGrid: Number(e.target.value) || 0 })} />
          </Field>
          <Field label={t('trade.leverage')}>
            <Input inputMode="numeric" value={String(form.leverage)} onChange={(e) => patch({ leverage: Number(e.target.value) || 1 })} />
          </Field>
          <Field label={t('bots.initialBuy')} hint={t('bots.initialBuyHint')}>
            <Segmented block value={form.initialBuy ? '1' : '0'} onChange={(v) => patch({ initialBuy: v === '1' })} options={[{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }]} />
          </Field>
        </div>

        {form.paper && accounts.length > 0 && (
          <Field label={t('strategies.bindAccounts')} hint={t('strategies.accountsHint')}>
            <div className="flex flex-wrap gap-1.5">
              {accounts.map((a) => {
                const active = form.accountIds.includes(a.id);
                return (
                  <button key={a.id} onClick={() => patch({ accountIds: active ? form.accountIds.filter((x) => x !== a.id) : [...form.accountIds, a.id] })}
                    className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors', active ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-500')}>
                    {a.label || a.id.slice(0, 8)}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {/* cross-chart gates */}
        <div className="rounded-xl border border-gray-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">{t('bots.gates')}</span>
            <Segmented size="xs" value={gateTab} onChange={(v) => setGateTab(v as typeof gateTab)} options={[{ value: 'entry', label: t('bots.entryGate') }, { value: 'stop', label: t('bots.stopGate') }]} />
          </div>
          <p className="mb-2 text-2xs leading-relaxed text-gray-400">{t('bots.gatesHint')}</p>
          {(() => {
            const conds = gateTab === 'entry' ? form.entryConditions : form.stopConditions;
            const setConds = (c: Condition[]) => patch(gateTab === 'entry' ? { entryConditions: c } : { stopConditions: c });
            return (
              <div className="space-y-2">
                {conds.length > 0 && (
                  <Segmented
                    size="xs"
                    value={gateTab === 'entry' ? form.entryLogic : form.stopLogic}
                    onChange={(v) => patch(gateTab === 'entry' ? { entryLogic: v as 'all' | 'any' } : { stopLogic: v as ConditionLogic })}
                    options={[{ value: 'all', label: t('strategies.logicAll') }, { value: 'any', label: t('strategies.logicAny') }]}
                  />
                )}
                {conds.map((cond, idx) => (
                  <ConditionRow
                    key={cond.id}
                    cond={cond}
                    index={idx}
                    onChange={(c) => setConds(conds.map((x) => (x.id === cond.id ? c : x)))}
                    onRemove={() => setConds(conds.filter((x) => x.id !== cond.id))}
                  />
                ))}
                <Button size="sm" variant="outline" onClick={() => setConds([...conds, { id: uid('c_'), type: 'rsi_below', params: { period: 14, value: 35 } }])}>
                  <Plus className="h-3 w-3" /> {t('strategies.addCondition')}
                </Button>
              </div>
            );
          })()}
        </div>
      </div>
    </Dialog>
  );
}

import { X } from 'lucide-react';
