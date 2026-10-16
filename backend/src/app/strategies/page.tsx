'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Card, Badge, EmptyState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { StrategyEditor, emptyEditor, fromStrategy, type EditorState } from '@/components/strategy/StrategyEditor';
import { describeCondition } from '@/core/conditionTexts';
import { fmtAmount, fmtTime } from '@/lib/format';
import { Play, Plus, Square, Trash2, Zap, Pencil, TrendingUp, Copy } from 'lucide-react';
import type { Strategy } from '@/core/types';

export default function StrategiesPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; label: string }[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<Strategy | null>(null);
  const [promoting, setPromoting] = useState<Strategy | null>(null);

  const reload = useCallback(() => {
    fetch('/api/strategies')
      .then((r) => r.json())
      .then((j) => j?.ok && setStrategies(j.data.strategies))
      .catch(() => undefined);
    fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => j?.ok && setAccounts(j.data.settings.accounts))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 8000);
    return () => clearInterval(timer);
  }, [reload]);

  const toggle = async (s: Strategy) => {
    const res = await fetch('/api/strategies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, action: 'toggle' }),
    });
    const j = await res.json().catch(() => null);
    if (j?.ok) toast.success(t(s.status === 'running' ? 'notif.strategy.stopped' : 'notif.strategy.started', { name: s.name }));
    else toast.error(t('common.requestFailed'), j?.error);
    reload();
  };

  /** Clone: copy the strategy JSON without id/status, stats start fresh — editor POSTs a new copy. */
  const clone = (s: Strategy) => {
    const copy = fromStrategy(s);
    copy.id = undefined;
    copy.status = undefined;
    setEditing(copy);
    setEditorOpen(true);
  };

  const promote = async () => {
    if (!promoting) return;
    const res = await fetch('/api/strategies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: promoting.id, paper: false }),
    });
    const j = await res.json().catch(() => null);
    if (j?.ok) toast.success(t('settings.saved'), t('strategies.promoted'));
    else toast.error(t('common.requestFailed'), j?.error);
    setPromoting(null);
    reload();
  };

  const remove = async () => {
    if (!deleting) return;
    const res = await fetch(`/api/strategies?id=${deleting.id}`, { method: 'DELETE' });
    const j = await res.json().catch(() => null);
    setDeleting(null);
    if (res.ok && j?.ok) toast.success(t('settings.saved'));
    else toast.error(t('common.requestFailed'), j?.error);
    reload();
  };

  const accountLabel = (id: string) => accounts.find((a) => a.id === id)?.label ?? id.slice(0, 10);

  return (
    <div className="w-full space-y-3 p-3 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{t('strategies.title')}</h2>
          <p className="text-xs text-gray-400">{t('strategies.subtitle')}</p>
        </div>
        <Button onClick={() => { setEditing(emptyEditor()); setEditorOpen(true); }}>
          <Plus className="h-4 w-4" /> {t('strategies.create')}
        </Button>
      </div>

      <p className="rounded-lg bg-brand-50/60 px-3 py-2 text-2xs leading-relaxed text-brand-700">{t('strategies.engineHint')}</p>

      {strategies.length === 0 && (
        <Card>
          <EmptyState
            icon={<Zap className="h-8 w-8" />}
            title={t('strategies.empty')}
            action={<Button size="sm" onClick={() => { setEditing(emptyEditor()); setEditorOpen(true); }}>{t('strategies.create')}</Button>}
          />
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {strategies.map((s) => {
          const running = s.status === 'running';
          const tradeCount = (s.stats.winCount ?? 0) + (s.stats.lossCount ?? 0);
          const winRate = tradeCount > 0 ? (s.stats.winCount ?? 0) / tradeCount : null;
          return (
            <Card key={s.id} className={cn('p-4', running && 'ring-1 ring-up/30')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', running ? 'animate-pulse bg-up' : 'bg-gray-300')} />
                    <h3 className="truncate text-sm font-semibold text-gray-900">{s.name}</h3>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-gray-500">
                    <Badge tone="brand">{s.symbol}</Badge>
                    <Badge>{s.timeframe.toUpperCase()}</Badge>
                    <Badge tone={s.marketType === 'futures' ? 'purple' : 'gray'}>{s.marketType === 'futures' ? t('markets.futures') : t('markets.spot')}</Badge>
                    <Badge tone={s.paper ? 'amber' : 'down'}>{s.paper ? t('strategies.paperExec') : t('strategies.liveExec')}</Badge>
                    {!s.paper && (s.accountIds?.length ?? 0) > 0 && (
                      <Badge tone="brand">🏦 {s.accountIds.map(accountLabel).join(' + ')}</Badge>
                    )}
                    {s.conditions.some((c) => c.tf || c.symbol) && (
                      <Badge tone="purple">{t('strategies.crossBadge')}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {s.paper && (
                    <Button size="sm" variant="outline" className="text-brand-600" onClick={() => setPromoting(s)} title={t('strategies.promote')}>
                      <TrendingUp className="h-3 w-3" /> {t('strategies.promote')}
                    </Button>
                  )}
                  <Button size="sm" variant={running ? 'secondary' : 'success'} onClick={() => toggle(s)}>
                    {running ? <><Square className="h-3 w-3" />{t('strategies.stop')}</> : <><Play className="h-3 w-3" />{t('strategies.start')}</>}
                  </Button>
                </div>
              </div>

              <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-2xs leading-relaxed text-gray-600">
                {s.conditions.map((c) => describeCondition(c, locale)).join(s.logic === 'all' ? ' ∧ ' : ' ∨ ')}
                <span className="mx-1 text-gray-400">→</span>
                {s.actions.map((a) =>
                  a.type === 'notify'
                    ? t('strategies.actionNotify')
                    : a.type === 'close_positions'
                      ? t('strategies.actionClose')
                      : `${t('strategies.actionOrder')} ${a.side === 'buy' ? t('common.long') : t('common.short')} ${a.size}`,
                ).join(' + ')}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-2xs text-gray-400">
                <span className="min-w-0">
                  {t('strategies.triggers')}: <b className="text-gray-700">{s.stats.triggerCount}</b>
                  {' · '}
                  {t('strategies.winRate')}: <b className="text-gray-700">{winRate != null ? `${(winRate * 100).toFixed(1)}%` : '—'}</b>
                  {' · '}
                  {t('strategies.realizedPnl')}:{' '}
                  <b className={s.stats.realizedPnl != null ? (s.stats.realizedPnl >= 0 ? 'text-up' : 'text-down') : 'text-gray-700'}>
                    {s.stats.realizedPnl != null ? `${s.stats.realizedPnl >= 0 ? '+' : ''}${fmtAmount(s.stats.realizedPnl, locale)}` : '—'}
                  </b>
                  {' · '}
                  {t('strategies.lastTrigger')}: {s.stats.lastTriggerTs ? fmtTime(s.stats.lastTriggerTs, locale) : t('common.never')}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/activity?channel=strategy&strategy=${encodeURIComponent(s.name)}`}
                    className="mr-1 text-brand-600 hover:underline"
                    title={t('strategies.logs')}
                  >
                    {t('strategies.logs')}
                  </Link>
                  <button onClick={() => clone(s)} className="rounded p-1 text-gray-400 hover:text-brand-600" title={t('strategies.clone')}>
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => { setEditing(fromStrategy(s)); setEditorOpen(true); }} className="rounded p-1 text-gray-400 hover:text-brand-600" title={t('common.edit')}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setDeleting(s)} className="rounded p-1 text-gray-400 hover:text-down" title={t('common.delete')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <StrategyEditor open={editorOpen} state={editing} onClose={() => setEditorOpen(false)} onSaved={reload} />
      <ConfirmDialog
        open={deleting != null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={t('common.deleteConfirmTitle')}
        text={`${t('strategies.deleteWarning')} (${deleting?.name ?? ''})`}
      />
      <ConfirmDialog
        open={promoting != null}
        onClose={() => setPromoting(null)}
        onConfirm={promote}
        danger
        title={t('strategies.promoteTitle')}
        text={t('strategies.promoteText', { name: promoting?.name ?? '' })}
        confirmLabel={t('strategies.promote')}
      />
    </div>
  );
}
