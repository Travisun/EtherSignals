'use client';

import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Segmented, Tabs } from '@/components/ui/tabs';
import { CONDITION_META, describeCondition } from '@/core/conditionTexts';
import { uid } from '@/lib/utils';
import { Plus, Trash2 } from 'lucide-react';
import { TIMEFRAMES, type Condition, type ConditionLogic, type ConditionType, type MarketType, type Strategy, type StrategyAction, type Timeframe } from '@/core/types';

const CONDITION_OPTIONS: { value: ConditionType; labelKey: string }[] = [
  { value: 'price_above', labelKey: 'cond.price_above' },
  { value: 'price_below', labelKey: 'cond.price_below' },
  { value: 'price_cross_up', labelKey: 'cond.price_cross_up' },
  { value: 'price_cross_down', labelKey: 'cond.price_cross_down' },
  { value: 'price_change_pct', labelKey: 'cond.price_change_pct' },
  { value: 'rsi_above', labelKey: 'cond.rsi_above' },
  { value: 'rsi_below', labelKey: 'cond.rsi_below' },
  { value: 'macd_golden', labelKey: 'cond.macd_golden' },
  { value: 'macd_death', labelKey: 'cond.macd_death' },
  { value: 'ma_cross_up', labelKey: 'cond.ma_cross_up' },
  { value: 'ma_cross_down', labelKey: 'cond.ma_cross_down' },
  { value: 'volume_spike', labelKey: 'cond.volume_spike' },
  { value: 'boll_break_up', labelKey: 'cond.boll_break_up' },
  { value: 'boll_break_down', labelKey: 'cond.boll_break_down' },
  { value: 'llm_bias', labelKey: 'cond.llm_bias' },
];

const PARAM_LABELS: Record<string, string> = {
  value: 'strategies.value', period: 'strategies.period', threshold: 'strategies.threshold',
  fast: 'strategies.fastMa', slow: 'strategies.slowMa', ratio: 'strategies.ratio',
  bars: 'strategies.bars', pct: 'strategies.pct', bias: 'strategies.bias',
  minConfidence: 'strategies.minConfidence', mult: 'strategies.ratio',
};

export interface EditorState {
  id?: string;
  name: string;
  symbol: string;
  marketType: MarketType;
  timeframe: Timeframe;
  logic: ConditionLogic;
  conditions: Condition[];
  actions: StrategyAction[];
  cooldownSec: number;
  repeat: boolean;
  paper: boolean;
  accountIds: string[];
  note?: string;
  status?: 'running' | 'stopped';
}

export function emptyEditor(symbol = 'BTCUSDT'): EditorState {
  return {
    name: '',
    symbol,
    marketType: 'futures',
    timeframe: '15m',
    logic: 'all',
    conditions: [{ id: uid('c_'), type: 'rsi_below', params: { period: 14, value: 30 } }],
    actions: [{ type: 'notify' }],
    cooldownSec: 300,
    repeat: true,
    paper: true,
    accountIds: [],
  };
}

export function fromStrategy(s: Strategy): EditorState {
  return {
    id: s.id,
    name: s.name,
    symbol: s.symbol,
    marketType: s.marketType,
    timeframe: s.timeframe,
    logic: s.logic,
    conditions: s.conditions,
    actions: s.actions,
    cooldownSec: s.cooldownSec,
    repeat: s.repeat,
    paper: s.paper,
    accountIds: s.accountIds ?? [],
    note: s.note,
    status: s.status,
  };
}

export function StrategyEditor({
  open, state, onClose, onSaved,
}: {
  open: boolean;
  state: EditorState | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState<EditorState | null>(state);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [tab, setTab] = useState('conditions');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [accounts, setAccounts] = useState<{ id: string; label: string; demoMode: boolean }[]>([]);

  React.useEffect(() => {
    setForm(state);
    setTestResult(null);
    setTab('conditions');
  }, [state]);

  React.useEffect(() => {
    if (!open) return;
    fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => j?.ok && setAccounts(j.data.settings.accounts))
      .catch(() => undefined);
  }, [open]);

  const patch = (p: Partial<EditorState>) => setForm((f) => (f ? { ...f, ...p } : f));

  const description = useMemo(() => {
    if (!form?.conditions.length) return '';
    return form.conditions
      .map((c) => describeCondition(c, locale))
      .join(form.logic === 'all' ? t('strategies.joinAnd') : t('strategies.joinOr'));
  }, [form, locale, t]);

  if (!form) return null;

  const save = async () => {
    setSaving(true);
    try {
      const method = form.id ? 'PUT' : 'POST';
      const res = await fetch('/api/strategies', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form }),
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

  const runTest = async () => {
    if (!form.id) {
      toast.info(t('strategies.testRun'), t('strategies.saveBeforeTest'));
      return;
    }
    setTesting(true);
    try {
      const res = await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', id: form.id }),
      });
      const j = await res.json();
      if (j?.ok) setTestResult(Boolean(j.data.matched));
    } finally {
      setTesting(false);
    }
  };

  const doImport = () => {
    try {
      const parsed = JSON.parse(importText) as Partial<EditorState>;
      patch({
        name: parsed.name ?? form.name,
        symbol: parsed.symbol ?? form.symbol,
        marketType: parsed.marketType ?? form.marketType,
        timeframe: parsed.timeframe ?? form.timeframe,
        logic: parsed.logic ?? form.logic,
        conditions: parsed.conditions ?? form.conditions,
        actions: parsed.actions ?? form.actions,
        cooldownSec: parsed.cooldownSec ?? form.cooldownSec,
        repeat: parsed.repeat ?? form.repeat,
        paper: parsed.paper ?? form.paper,
      });
      setImportOpen(false);
      setImportText('');
      toast.success(t('strategies.importSuccess'));
    } catch {
      toast.error(t('strategies.importFailed'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={form.id ? `${t('common.edit')} · ${form.name}` : t('strategies.create')}
      description={description || undefined}
      footer={
        <>
          <div className="mr-auto flex items-center gap-2">
            {testResult != null && (
              <span className={cn('text-2xs font-medium', testResult ? 'text-up' : 'text-gray-400')}>
                {testResult ? t('strategies.testMatched') : t('strategies.testNotMatched')}
              </span>
            )}
            <Button size="sm" variant="outline" loading={testing} onClick={runTest}>{t('strategies.testRun')}</Button>
          </div>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={saving} onClick={save}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('strategies.name')}>
            <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t('strategies.namePlaceholder')} />
          </Field>
          <Field label={t('strategies.symbol')}>
            <Input value={form.symbol} onChange={(e) => patch({ symbol: e.target.value.toUpperCase() })} placeholder="BTCUSDT" />
          </Field>
          <Field label={t('common.type')}>
            <Segmented
              block
              value={form.marketType}
              onChange={(v) => patch({ marketType: v as MarketType })}
              options={[
                { value: 'futures', label: t('markets.futures') },
                { value: 'spot', label: t('markets.spot') },
              ]}
            />
          </Field>
          <Field label={t('strategies.timeframe')}>
            <Select
              value={form.timeframe}
              onChange={(v) => patch({ timeframe: v as Timeframe })}
              options={TIMEFRAMES.map((tf) => ({ value: tf, label: tf.toUpperCase() }))}
            />
          </Field>
        </div>

        <Tabs
          tabs={[
            { key: 'conditions', label: t('strategies.conditions'), badge: <Count n={form.conditions.length} /> },
            { key: 'actions', label: t('strategies.actions'), badge: <Count n={form.actions.length} /> },
            { key: 'risk', label: `${t('strategies.cooldown')} / ${t('settings.tabRisk')}` },
          ]}
          active={tab}
          onChange={setTab}
          size="sm"
        />

        {tab === 'conditions' && (
          <div className="space-y-3">
            <Segmented
              value={form.logic}
              onChange={(v) => patch({ logic: v as ConditionLogic })}
              options={[
                { value: 'all', label: t('strategies.logicAll') },
                { value: 'any', label: t('strategies.logicAny') },
              ]}
            />
            <p className="rounded-md bg-brand-50/60 px-3 py-2 text-2xs leading-relaxed text-brand-700">{t('strategies.scopeHint')}</p>
            {form.conditions.map((cond, idx) => (
              <ConditionRow
                key={cond.id}
                cond={cond}
                index={idx}
                onChange={(c) => patch({ conditions: form.conditions.map((x) => (x.id === cond.id ? c : x)) })}
                onRemove={() => patch({ conditions: form.conditions.filter((x) => x.id !== cond.id) })}
              />
            ))}
            <Button size="sm" variant="outline" onClick={() => patch({ conditions: [...form.conditions, { id: uid('c_'), type: 'price_above', params: { value: 0 } }] })}>
              <Plus className="h-3.5 w-3.5" /> {t('strategies.addCondition')}
            </Button>
            {form.conditions.some((c) => c.type === 'llm_bias') && (
              <p className="rounded-md bg-purple-50 px-3 py-2 text-2xs leading-relaxed text-purple-600">{t('strategies.llmCondHint')}</p>
            )}
          </div>
        )}

        {tab === 'actions' && (
          <div className="space-y-3">
            {form.actions.map((action, idx) => (
              <div key={idx} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-600">#{idx + 1}</span>
                  {form.actions.length > 1 && (
                    <button onClick={() => patch({ actions: form.actions.filter((_, i) => i !== idx) })} className="text-gray-300 hover:text-down">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field label={t('strategies.actions')}>
                    <Select
                      value={action.type}
                      onChange={(v) => {
                        const next = [...form.actions];
                        next[idx] = v === 'notify' ? { type: 'notify' } : v === 'close_positions' ? { type: 'close_positions' } : { type: 'order', orderType: 'market', side: 'buy', tradeSide: 'open', size: 0.01 };
                        patch({ actions: next });
                      }}
                      options={[
                        { value: 'notify', label: t('strategies.actionNotify') },
                        { value: 'order', label: t('strategies.actionOrder') },
                        { value: 'close_positions', label: t('strategies.actionClose') },
                      ]}
                    />
                  </Field>
                  {action.type === 'order' && (
                    <>
                      <Field label={t('trade.side')}>
                        <Select
                          value={action.side}
                          onChange={(v) => patch({ actions: form.actions.map((a, i) => (i === idx && a.type === 'order' ? { ...a, side: v as 'buy' | 'sell' } : a)) })}
                          options={[
                            { value: 'buy', label: t('common.long') },
                            { value: 'sell', label: t('common.short') },
                          ]}
                        />
                      </Field>
                      <Field label={t('ordersPage.orderType')}>
                        <Select
                          value={action.orderType}
                          onChange={(v) => patch({ actions: form.actions.map((a, i) => (i === idx && a.type === 'order' ? { ...a, orderType: v as 'limit' | 'market' } : a)) })}
                          options={[
                            { value: 'market', label: t('trade.market') },
                            { value: 'limit', label: t('trade.limit') },
                          ]}
                        />
                      </Field>
                      <Field label={t('strategies.size')}>
                        <Input
                          inputMode="decimal"
                          value={String(action.size ?? '')}
                          onChange={(e) => patch({ actions: form.actions.map((a, i) => (i === idx && a.type === 'order' ? { ...a, size: Number(e.target.value) || 0 } : a)) })}
                          placeholder={t('strategies.sizePlaceholder')}
                        />
                      </Field>
                      {action.orderType === 'limit' && (
                        <Field label={t('strategies.limitPrice')}>
                          <Input
                            inputMode="decimal"
                            value={String(action.price ?? '')}
                            onChange={(e) => patch({ actions: form.actions.map((a, i) => (i === idx && a.type === 'order' ? { ...a, price: Number(e.target.value) || undefined } : a)) })}
                            placeholder={t('strategies.pricePlaceholder')}
                          />
                        </Field>
                      )}
                      {form.marketType === 'futures' && (
                        <>
                          <Field label={t('trade.leverage')}>
                            <Input
                              inputMode="numeric"
                              value={String(action.leverage ?? 1)}
                              onChange={(e) => patch({ actions: form.actions.map((a, i) => (i === idx && a.type === 'order' ? { ...a, leverage: Number(e.target.value) || 1 } : a)) })}
                            />
                          </Field>
                          <Field label={t('strategies.stopLoss')}>
                            <Input
                              inputMode="decimal"
                              value={String(action.stopLossPct ?? '')}
                              onChange={(e) => patch({ actions: form.actions.map((a, i) => (i === idx && a.type === 'order' ? { ...a, stopLossPct: Number(e.target.value) || undefined } : a)) })}
                              placeholder="1.5"
                            />
                          </Field>
                          <Field label={t('strategies.takeProfit')}>
                            <Input
                              inputMode="decimal"
                              value={String(action.takeProfitPct ?? '')}
                              onChange={(e) => patch({ actions: form.actions.map((a, i) => (i === idx && a.type === 'order' ? { ...a, takeProfitPct: Number(e.target.value) || undefined } : a)) })}
                              placeholder="3"
                            />
                          </Field>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => patch({ actions: [...form.actions, { type: 'notify' }] })}>
                <Plus className="h-3.5 w-3.5" /> {t('strategies.addAction')}
              </Button>
              {!form.actions.length && <span className="self-center text-2xs text-gray-400">{t('strategies.noActionsHint')}</span>}
            </div>
            <Field label={t('common.note')}>
              <Input value={form.note ?? ''} onChange={(e) => patch({ note: e.target.value })} />
            </Field>
          </div>
        )}

        {tab === 'risk' && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`${t('strategies.cooldown')} (${t('common.seconds')})`} hint={t('strategies.cooldownHint')}>
                <Input inputMode="numeric" value={String(form.cooldownSec)} onChange={(e) => patch({ cooldownSec: Number(e.target.value) || 0 })} />
              </Field>
              <Field label={t('strategies.repeat')} hint={t('strategies.repeatHint')}>
                <Segmented
                  block
                  value={form.repeat ? '1' : '0'}
                  onChange={(v) => patch({ repeat: v === '1' })}
                  options={[
                    { value: '1', label: t('common.yes') },
                    { value: '0', label: t('common.no') },
                  ]}
                />
              </Field>
              <Field label={t('strategies.orderAction')} hint={t('settings.paperModeHint')}>
                <Segmented
                  block
                  value={form.paper ? 'paper' : 'live'}
                  onChange={(v) => patch({ paper: v === 'paper' })}
                  options={[
                    { value: 'paper', label: t('strategies.paperExec') },
                    { value: 'live', label: t('strategies.liveExec') },
                  ]}
                />
              </Field>
              <div className="flex items-end gap-2">
                <Button size="sm" variant="outline" onClick={() => {
                  const json = JSON.stringify(form, null, 2);
                  void navigator.clipboard?.writeText(json);
                  toast.success(t('common.copied'));
                }}>
                  {t('strategies.exportJson')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                  {t('strategies.importJson')}
                </Button>
              </div>
            </div>

            <Field label={t('strategies.bindAccounts')} hint={t('strategies.accountsHint')}>
              {accounts.length === 0 ? (
                <p className="rounded-lg bg-gray-50 px-3 py-2 text-2xs text-gray-400">{t('settings.noAccounts')}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {accounts.map((a) => {
                    const active = form.accountIds.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        onClick={() =>
                          patch({ accountIds: active ? form.accountIds.filter((x) => x !== a.id) : [...form.accountIds, a.id] })
                        }
                        className={cn(
                          'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                          active ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-500 hover:border-gray-300',
                        )}
                      >
                        {a.label || a.id.slice(0, 8)}
                        {a.demoMode && <span className="ml-1 text-2xs text-amber-500">DEMO</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>

            <Field label={t('common.note')}>
              <Input value={form.note ?? ''} onChange={(e) => patch({ note: e.target.value })} />
            </Field>
          </div>
        )}
      </div>

      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title={t('strategies.importJson')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setImportOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={doImport}>{t('common.confirm')}</Button>
          </>
        }
      >
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={t('strategies.jsonPlaceholder')}
          rows={10}
          className="w-full rounded-lg border border-gray-300 p-2 font-mono text-xs focus:border-brand-500 focus:outline-none"
        />
      </Dialog>
    </Dialog>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-2xs text-gray-500">{n}</span>;
}

export function ConditionRow({
  cond, index, onChange, onRemove,
}: {
  cond: Condition;
  index: number;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const { t, locale } = useI18n();
  const meta = CONDITION_META[cond.type] ?? { params: [] };

  const conditionOptions = useMemo(
    () =>
      CONDITION_OPTIONS.map((o) => {
        const defParams: Record<string, number | string> = {};
        for (const p of CONDITION_META[o.value]?.params ?? []) defParams[p.key] = p.def;
        return {
          value: o.value,
          label: describeCondition({ id: '', type: o.value, params: defParams }, locale),
        };
      }),
    [locale],
  );

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-2xs text-gray-500">{index + 1}</span>
        <Select
          className="flex-1"
          size="sm"
          value={cond.type}
          onChange={(v) => {
            const defParams: Record<string, number | string> = {};
            for (const p of CONDITION_META[v]?.params ?? []) defParams[p.key] = p.def;
            onChange({ ...cond, type: v as ConditionType, params: defParams });
          }}
          options={conditionOptions}
          searchable
        />
        <button onClick={onRemove} className="shrink-0 rounded p-1 text-gray-300 transition-colors hover:text-down">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-1.5 text-2xs text-gray-400">{describeCondition(cond, locale)}</div>
      {cond.type !== 'llm_bias' && (
        <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-gray-50/80 p-2">
          <label className="block">
            <span className="mb-1 block text-2xs text-gray-400">{t('strategies.scopeMarket')}</span>
            <Select
              size="sm"
              value={cond.marketType ?? ''}
              onChange={(v) => onChange({ ...cond, marketType: (v || undefined) as MarketType | undefined })}
              options={[
                { value: '', label: t('strategies.scopeDefault') },
                { value: 'futures', label: t('markets.futures') },
                { value: 'spot', label: t('markets.spot') },
              ]}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-2xs text-gray-400">{t('strategies.scopeSymbol')}</span>
            <Input
              className="h-8 text-xs"
              value={cond.symbol ?? ''}
              onChange={(e) => onChange({ ...cond, symbol: e.target.value.toUpperCase() || undefined })}
              placeholder={t('strategies.scopeSymbolDefault')}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-2xs text-gray-400">{t('strategies.scopeTf')}</span>
            <Select
              size="sm"
              value={cond.tf ?? ''}
              onChange={(v) => onChange({ ...cond, tf: (v || undefined) as Timeframe | undefined })}
              options={[
                { value: '', label: t('strategies.scopeTfDefault') },
                ...TIMEFRAMES.map((tf) => ({ value: tf, label: tf.toUpperCase() })),
              ]}
            />
          </label>
        </div>
      )}
      {meta.params.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {meta.params.map((p) => (
            <label key={p.key} className="block">
              <span className="mb-1 block text-2xs text-gray-400">{t(PARAM_LABELS[p.key] ?? p.key)}</span>
              {p.key === 'bias' ? (
                <Select
                  size="sm"
                  value={String(cond.params[p.key] ?? 'long')}
                  onChange={(v) => onChange({ ...cond, params: { ...cond.params, [p.key]: v } })}
                  options={[
                    { value: 'long', label: t('assistant.bias_long') },
                    { value: 'short', label: t('assistant.bias_short') },
                    { value: 'neutral', label: t('assistant.bias_neutral') },
                  ]}
                />
              ) : (
                <Input
                  inputMode="decimal"
                  className="h-8 text-xs"
                  value={String(cond.params[p.key] ?? '')}
                  onChange={(e) => onChange({ ...cond, params: { ...cond.params, [p.key]: Number(e.target.value) || e.target.value } })}
                />
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
