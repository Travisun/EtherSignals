'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Card, Badge, EmptyState } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm';
import { EventRow } from '@/components/layout/AppShell';
import { fmtTime } from '@/lib/format';
import { Download, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AppEvent, EventLevel } from '@/core/types';

export default function ActivityPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [level, setLevel] = useState<'all' | EventLevel>('all');
  const [channel, setChannel] = useState<'all' | string>('all');
  const [strategyFilter, setStrategyFilter] = useState('');
  const [clearOpen, setClearOpen] = useState(false);

  const reload = useCallback(() => {
    fetch('/api/events?limit=500')
      .then((r) => r.json())
      .then((j) => j?.ok && setEvents(j.data.events))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    reload();
    const timer = setInterval(() => {
      if (document.hidden) return;
      reload();
    }, 5000);
    return () => clearInterval(timer);
  }, [reload]);

  // deep links: /activity?channel=strategy&strategy=MyBot
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const ch = sp.get('channel');
    if (ch) setChannel(ch);
    const st = sp.get('strategy');
    if (st) setStrategyFilter(st);
  }, []);

  const strategyQuery = strategyFilter.trim().toLowerCase();
  const filtered = events.filter((e) => {
    if (level !== 'all' && e.level !== level) return false;
    if (channel !== 'all' && e.channel !== channel) return false;
    if (strategyQuery) {
      const key = `notif.${e.code}`;
      const text = t(key, e.params);
      const rendered = text === key ? `${e.code} ${e.params ? JSON.stringify(e.params) : ''}` : text;
      const haystack = `${rendered} ${e.params?.name ?? ''} ${e.strategyId ?? ''}`.toLowerCase();
      if (!haystack.includes(strategyQuery)) return false;
    }
    return true;
  });

  const exportEvents = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearLogs = async () => {
    setClearOpen(false);
    await fetch('/api/engine?events=1', { method: 'DELETE' });
    toast.success(t('activity.cleared'));
    reload();
  };

  return (
    <div className="w-full space-y-3 p-3 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{t('activity.title')}</h2>
          <p className="text-xs text-gray-400">{t('activity.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={events.length === 0} onClick={exportEvents}>
            <Download className="h-3 w-3" /> {t('activity.export')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setClearOpen(true)}>
            {t('activity.clear')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          size="xs"
          value={level}
          onChange={(v) => setLevel(v as typeof level)}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'info', label: t('level.info') },
            { value: 'success', label: t('level.success') },
            { value: 'warning', label: t('level.warning') },
            { value: 'error', label: t('level.error') },
          ]}
        />
        <Segmented
          size="xs"
          value={channel}
          onChange={(v) => setChannel(v)}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'strategy', label: t('activity.channel_strategy') },
            { value: 'trade', label: t('activity.channel_trade') },
            { value: 'system', label: t('activity.channel_system') },
            { value: 'llm', label: t('activity.channel_llm') },
            { value: 'grid', label: t('activity.channel_grid') },
            { value: 'backtest', label: t('activity.channel_backtest') },
          ]}
        />
        <Input
          value={strategyFilter}
          onChange={(e) => setStrategyFilter(e.target.value)}
          placeholder={t('activity.strategyFilter')}
          className="h-7 w-44 text-xs"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="max-h-[calc(100dvh-280px)] divide-y divide-gray-50 overflow-y-auto">
          {filtered.length === 0 && <EmptyState icon={<ScrollText className="h-8 w-8" />} title={t('activity.empty')} />}
          {filtered.map((ev) => (
            <div key={ev.id} className="flex items-start gap-3 px-4 py-2.5">
              <Badge
                tone={ev.level === 'error' ? 'down' : ev.level === 'warning' ? 'amber' : ev.level === 'success' ? 'up' : 'brand'}
                className="mt-0.5 shrink-0"
              >
                {t(`level.${ev.level}`)}
              </Badge>
              <div className="min-w-0 flex-1">
                <EventText event={ev} />
                <div className="mt-0.5 flex items-center gap-2 text-2xs text-gray-400">
                  <span>{fmtTime(ev.ts, locale, true)}</span>
                  <span className={cn('rounded bg-gray-100 px-1', 'text-gray-500')}>{t(`activity.channel_${ev.channel}`)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={clearLogs}
        title={t('activity.clear')}
        text={t('activity.clearConfirm')}
      />
    </div>
  );
}

function EventText({ event }: { event: AppEvent }) {
  const { t } = useI18n();
  const key = `notif.${event.code}`;
  const text = t(key, event.params);
  return (
    <div className={cn('break-words text-xs leading-relaxed', event.level === 'error' ? 'text-down' : 'text-gray-800')}>
      {text === key ? `${event.code} ${event.params ? JSON.stringify(event.params) : ''}` : text}
    </div>
  );
}
