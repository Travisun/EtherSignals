'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createChart, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Card, Stat, EmptyState, Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Segmented } from '@/components/ui/tabs';
import { ConditionRow } from '@/components/strategy/StrategyEditor';
import { ConfirmDialog } from '@/components/ui/confirm';
import { uid } from '@/lib/utils';
import { fmtAmount, fmtPct, fmtTime } from '@/lib/format';
import { TIMEFRAMES } from '@/core/types';
import { Download, FlaskConical, Play } from 'lucide-react';
import type { BacktestConfig, BacktestRun, ConditionLogic, MarketType, Timeframe } from '@/core/types';

export default function BacktestPage() {
  const { t, locale } = useI18n();
  const toast = useToast();

  const [strategies, setStrategies] = useState<{ id: string; name: string }[]>([]);
  const [config, setConfig] = useState<BacktestConfig>({
    symbol: 'BTCUSDT',
    marketType: 'futures',
    timeframe: '1h',
    maxCandles: 3000,
    initialCapital: 10_000,
    feeBps: 6,
    slippageBps: 2,
    direction: 'both',
    logic: 'all',
    conditions: [{ id: uid('c_'), type: 'ma_cross_up', params: { fast: 5, slow: 20 } }],
    allowLeverage: 1,
  });
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [activeRun, setActiveRun] = useState<BacktestRun | null>(null);
  const [deletingRun, setDeletingRun] = useState<BacktestRun | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const patch = (p: Partial<BacktestConfig>) => setConfig((c) => ({ ...c, ...p }));

  const reloadRuns = useCallback(() => {
    fetch('/api/backtest')
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) return;
        setRuns(j.data.runs);
        setActiveRun((cur) => (cur ? j.data.runs.find((r: BacktestRun) => r.id === cur.id) ?? cur : null));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch('/api/strategies').then((r) => r.json()).then((j) => {
      if (j?.ok) setStrategies(j.data.strategies.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
    }).catch(() => undefined);
    reloadRuns();
  }, [reloadRuns]);

  const anyRunning = runs.some((r) => r.status === 'pending' || r.status === 'running');

  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(reloadRuns, 1200);
    return () => clearInterval(timer);
  }, [anyRunning, reloadRuns]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const j = await res.json();
      if (j?.ok) {
        toast.success(t('backtest.running'));
        setActiveRun(j.data.run);
        reloadRuns();
      } else {
        toast.error(t('common.requestFailed'), j?.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const importStrategy = (id: string) => {
    fetch('/api/strategies')
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) return;
        const s = j.data.strategies.find((x: { id: string }) => x.id === id);
        if (s) patch({ symbol: s.symbol, marketType: s.marketType, timeframe: s.timeframe, logic: s.logic, conditions: s.conditions });
      })
      .catch(() => undefined);
  };

  const removeRun = async () => {
    if (!deletingRun) return;
    const id = deletingRun.id;
    setDeletingRun(null);
    await fetch(`/api/backtest?id=${id}`, { method: 'DELETE' });
    reloadRuns();
  };

  const exportCsv = () => {
    if (!activeRun?.result) return;
    const header = 'entryTs,exitTs,side,entryPrice,exitPrice,size,pnl,pnlPct,reason';
    const lines = activeRun.result.trades.map((tr) =>
      [tr.entryTs, tr.exitTs, tr.side, tr.entryPrice, tr.exitPrice, tr.size, tr.pnl, tr.pnlPct, tr.reason].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest-${activeRun.config.symbol}-${activeRun.config.timeframe}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = activeRun?.result?.stats;

  return (
    <div className="w-full space-y-3 p-3 md:p-5">
      <div>
        <h2 className="text-lg font-bold">{t('backtest.title')}</h2>
        <p className="text-xs text-gray-400">{t('backtest.subtitle')}</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[380px_1fr]">
        {/* config */}
        <Card className="space-y-3 p-4">
          <Field label={t('backtest.selectStrategy')}>
            <Select
              value=""
              onChange={(v) => v && importStrategy(v)}
              placeholder={t('backtest.selectStrategyPlaceholder')}
              options={strategies.map((s) => ({ value: s.id, label: s.name }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('strategies.symbol')}>
              <Input value={config.symbol} onChange={(e) => patch({ symbol: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t('strategies.timeframe')}>
              <Select value={config.timeframe} onChange={(v) => patch({ timeframe: v as Timeframe })} options={TIMEFRAMES.map((tf) => ({ value: tf, label: tf.toUpperCase() }))} />
            </Field>
            <Field label={t('common.type')}>
              <Select
                value={config.marketType}
                onChange={(v) => patch({ marketType: v as MarketType })}
                options={[
                  { value: 'futures', label: t('markets.futures') },
                  { value: 'spot', label: t('markets.spot') },
                ]}
              />
            </Field>
            <Field label={t('backtest.direction')}>
              <Select
                value={config.direction}
                onChange={(v) => patch({ direction: v as 'both' | 'long' | 'short' })}
                options={[
                  { value: 'both', label: t('backtest.both') },
                  { value: 'long', label: t('backtest.longOnly') },
                  { value: 'short', label: t('backtest.shortOnly') },
                ]}
              />
            </Field>
          </div>

          <p className="text-2xs leading-relaxed text-gray-400">{t('backtest.directionHint')}</p>

          <Segmented
            block
            size="xs"
            value={config.logic}
            onChange={(v) => patch({ logic: v as ConditionLogic })}
            options={[
              { value: 'all', label: t('strategies.logicAll') },
              { value: 'any', label: t('strategies.logicAny') },
            ]}
          />

          {config.conditions.map((cond, idx) => (
            <ConditionRow
              key={cond.id}
              cond={cond}
              index={idx}
              onChange={(c) => patch({ conditions: config.conditions.map((x) => (x.id === cond.id ? c : x)) })}
              onRemove={() => patch({ conditions: config.conditions.filter((x) => x.id !== cond.id) })}
            />
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => patch({ conditions: [...config.conditions, { id: uid('c_'), type: 'rsi_below', params: { period: 14, value: 30 } }] })}
          >
            + {t('strategies.addCondition')}
          </Button>

          <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
            <Field label={t('backtest.initialCapital')}>
              <Input inputMode="numeric" value={String(config.initialCapital)} onChange={(e) => patch({ initialCapital: Number(e.target.value) || 1000 })} />
            </Field>
            <Field label={t('backtest.maxCandles')}>
              <Input inputMode="numeric" value={String(config.maxCandles)} onChange={(e) => patch({ maxCandles: Number(e.target.value) || 1000 })} />
            </Field>
            <Field label={t('backtest.feeBps')}>
              <Input inputMode="numeric" value={String(config.feeBps)} onChange={(e) => patch({ feeBps: Number(e.target.value) || 0 })} />
            </Field>
            <Field label={t('backtest.slippageBps')}>
              <Input inputMode="numeric" value={String(config.slippageBps)} onChange={(e) => patch({ slippageBps: Number(e.target.value) || 0 })} />
            </Field>
            <Field label={t('strategies.stopLoss')}>
              <Input inputMode="decimal" value={String(config.stopLossPct ?? '')} onChange={(e) => patch({ stopLossPct: Number(e.target.value) || undefined })} placeholder="2" />
            </Field>
            <Field label={t('strategies.takeProfit')}>
              <Input inputMode="decimal" value={String(config.takeProfitPct ?? '')} onChange={(e) => patch({ takeProfitPct: Number(e.target.value) || undefined })} placeholder="4" />
            </Field>
          </div>

          <Button block loading={submitting || anyRunning} onClick={submit}>
            <Play className="h-4 w-4" /> {anyRunning ? t('backtest.running') : t('backtest.run')}
          </Button>
          {activeRun && (activeRun.status === 'running' || activeRun.status === 'pending') && (
            <div>
              <div className="mb-1 flex justify-between text-2xs text-gray-400">
                <span>{t('backtest.progress')}</span>
                <span>{Math.round((activeRun.progress ?? 0) * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(activeRun.progress ?? 0) * 100}%` }} />
              </div>
            </div>
          )}
        </Card>

        {/* results */}
        <div className="space-y-3">
          {activeRun?.status === 'error' && (
            <Card className="border-down/30 bg-down/5 p-4 text-sm text-down">{activeRun.error}</Card>
          )}
          {!activeRun || (!activeRun.result && activeRun.status !== 'error') ? (
            <Card><EmptyState icon={<FlaskConical className="h-8 w-8" />} title={t('backtest.results')} description={t('backtest.subtitle')} /></Card>
          ) : (
            activeRun.result && (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat
                    label={t('backtest.totalReturn')}
                    value={fmtPct(activeRun.result.stats.totalReturnPct / 100, locale)}
                    tone={activeRun.result.stats.totalReturnPct >= 0 ? 'up' : 'down'}
                  />
                  <Stat label={t('backtest.netProfit')} value={fmtAmount(activeRun.result.stats.netProfit, locale)} tone={activeRun.result.stats.netProfit >= 0 ? 'up' : 'down'} />
                  <Stat label={t('backtest.winRate')} value={fmtPct(activeRun.result.stats.winRate / 100, locale, 1)} />
                  <Stat label={t('backtest.maxDrawdown')} value={fmtPct(-activeRun.result.stats.maxDrawdownPct / 100, locale, 1)} tone="down" />
                  <Stat label={t('backtest.profitFactor')} value={Number(activeRun.result.stats.profitFactor.toFixed(2)).toString()} />
                  <Stat label={t('backtest.sharpe')} value={activeRun.result.stats.sharpe.toFixed(2)} />
                  <Stat label={t('backtest.trades')} value={`${activeRun.result.stats.tradeCount}`} sub={`${t('backtest.signals')}: ${activeRun.result.stats.signalCount}`} />
                  <Stat
                    label={t('backtest.buyHold')}
                    value={fmtPct(activeRun.result.stats.buyHoldReturnPct / 100, locale)}
                    tone={activeRun.result.stats.totalReturnPct >= activeRun.result.stats.buyHoldReturnPct ? 'up' : 'down'}
                    sub={activeRun.result.stats.totalReturnPct >= activeRun.result.stats.buyHoldReturnPct ? t('backtest.outperform') : t('backtest.underperform')}
                  />
                  {stats?.fundingPaid != null && (
                    <Stat
                      label={t('backtest.fundingPaid')}
                      value={`${stats.fundingPaid >= 0 ? '+' : ''}${fmtAmount(stats.fundingPaid, locale)}`}
                      tone={stats.fundingPaid >= 0 ? 'up' : 'down'}
                    />
                  )}
                  {stats?.liquidations != null && (
                    <Stat label={t('backtest.liquidations')} value={`${stats.liquidations}`} tone={stats.liquidations > 0 ? 'down' : 'default'} />
                  )}
                  {stats?.isReturnPct != null && (
                    <div title={t('backtest.isReturn')}>
                      <Stat
                        label={t('backtest.isReturn')}
                        value={fmtPct(stats.isReturnPct / 100, locale)}
                        tone={stats.isReturnPct >= 0 ? 'up' : 'down'}
                      />
                    </div>
                  )}
                  {stats?.oosReturnPct != null && (
                    <div title={t('backtest.oosReturn')}>
                      <Stat
                        label={t('backtest.oosReturn')}
                        value={fmtPct(stats.oosReturnPct / 100, locale)}
                        tone={stats.oosReturnPct >= 0 ? 'up' : 'down'}
                      />
                    </div>
                  )}
                </div>

                <Card className="p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{t('backtest.equityCurve')}</h3>
                    <span className="text-2xs text-gray-400">
                      {activeRun.config.symbol} · {activeRun.config.timeframe.toUpperCase()} · {t('backtest.candlesUsed')} {activeRun.result.candlesUsed}
                    </span>
                  </div>
                  <EquityChart data={activeRun.result.equity} drawdown={activeRun.result.drawdown} initial={activeRun.config.initialCapital} />
                </Card>

                <Card className="overflow-hidden">
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
                    <span className="text-sm font-semibold">{t('backtest.trades')}</span>
                    <Button size="xs" variant="outline" disabled={!activeRun.result.trades.length} onClick={exportCsv}>
                      <Download className="h-3 w-3" /> {t('backtest.exportCsv')}
                    </Button>
                  </div>
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full min-w-max text-left text-xs">
                      <thead className="border-b border-gray-100 text-gray-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">{t('backtest.entryTime')}</th>
                          <th className="px-3 py-2 font-medium">{t('trade.side')}</th>
                          <th className="px-3 py-2 text-right font-medium">{t('backtest.entry')}</th>
                          <th className="px-3 py-2 text-right font-medium">{t('backtest.exit')}</th>
                          <th className="px-3 py-2 text-right font-medium">{t('backtest.pnl')}</th>
                          <th className="px-3 py-2 text-right font-medium">{t('backtest.pnlPct')}</th>
                          <th className="px-3 py-2 font-medium">{t('backtest.reason')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeRun.result.trades.slice().reverse().map((tr, i) => (
                          <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70">
                            <td className="px-3 py-1.5 text-gray-500">{fmtTime(tr.entryTs, locale)}</td>
                            <td className="px-3 py-1.5">
                              <Badge tone={tr.side === 'long' ? 'up' : 'down'}>{t(`backtest.side_${tr.side}`)}</Badge>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{tr.entryPrice.toPrecision(6)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{tr.exitPrice.toPrecision(6)}</td>
                            <td className={cn('px-3 py-1.5 text-right font-medium tabular-nums', tr.pnl >= 0 ? 'text-up' : 'text-down')}>
                              {tr.pnl >= 0 ? '+' : ''}{fmtAmount(tr.pnl, locale)}
                            </td>
                            <td className={cn('px-3 py-1.5 text-right tabular-nums', tr.pnl >= 0 ? 'text-up' : 'text-down')}>
                              {tr.pnlPct >= 0 ? '+' : ''}{tr.pnlPct.toFixed(2)}%
                            </td>
                            <td className="px-3 py-1.5 text-gray-500">
                              {tr.reason === 'liquidation'
                                ? <Badge tone="down">{t(`backtest.reason_${tr.reason}`)}</Badge>
                                : t(`backtest.reason_${tr.reason}`)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!activeRun.result.trades.length && <EmptyState title={t('common.empty')} />}
                  </div>
                </Card>
              </>
            )
          )}

          {/* past runs */}
          <Card className="overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-2.5 text-sm font-semibold">{t('backtest.runs')}</div>
            <div className="divide-y divide-gray-50">
              {runs.length === 0 && <EmptyState title={t('backtest.noRuns')} />}
              {runs.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-2 text-xs">
                  <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => setActiveRun(r)}>
                    <span className="font-medium text-gray-800">{r.config.symbol}</span>
                    <span className="text-gray-400">{r.config.timeframe.toUpperCase()}</span>
                    {r.result && (
                      <span className={cn('font-medium tabular-nums', r.result.stats.totalReturnPct >= 0 ? 'text-up' : 'text-down')}>
                        {r.result.stats.totalReturnPct >= 0 ? '+' : ''}{r.result.stats.totalReturnPct.toFixed(2)}%
                      </span>
                    )}
                  </button>
                  <div className="flex items-center gap-2 text-2xs text-gray-400">
                    <StatusBadge run={r} />
                    {fmtTime(r.createdAt, locale)}
                    <button
                      onClick={() => setDeletingRun(r)}
                      className="text-gray-300 hover:text-down"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={deletingRun != null}
        onClose={() => setDeletingRun(null)}
        onConfirm={removeRun}
        text={`${t('common.deleteConfirmText')} (${deletingRun ? `${deletingRun.config.symbol} ${deletingRun.config.timeframe.toUpperCase()}` : ''})`}
      />
    </div>
  );
}

function StatusBadge({ run }: { run: BacktestRun }) {
  const { t } = useI18n();
  if (run.status === 'done') return <Badge tone="up">{t('common.success')}</Badge>;
  if (run.status === 'error') return <Badge tone="down">{t('common.failed')}</Badge>;
  return <Badge tone="brand">{t('backtest.running')}</Badge>;
}

function EquityChart({ data, drawdown, initial }: { data: { ts: number; value: number }[]; drawdown: { ts: number; value: number }[]; initial: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'>>();
  const ddRef = useRef<ISeriesApi<'Area'>>();
  const initLineRef = useRef<ReturnType<ISeriesApi<'Area'>['createPriceLine']>>();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#6b7280', fontSize: 11 },
      grid: { vertLines: { color: '#f3f4f6' }, horzLines: { color: '#f3f4f6' } },
      rightPriceScale: { borderColor: '#e5e7eb' },
      timeScale: { borderColor: '#e5e7eb', timeVisible: true },
      autoSize: true,
    });
    chartRef.current = chart;
    seriesRef.current = chart.addAreaSeries({ lineColor: '#254de6', topColor: '#254de622', bottomColor: '#254de660', lineWidth: 2, priceLineVisible: false });
    ddRef.current = chart.addAreaSeries({ lineColor: '#dc2626', topColor: '#dc262600', bottomColor: '#dc262622', lineWidth: 1, priceScaleId: 'dd', priceLineVisible: false, lastValueVisible: false });
    chart.priceScale('dd').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    return () => {
      chart.remove();
      chartRef.current = null;
      initLineRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(data.map((d) => ({ time: (d.ts / 1000) as UTCTimestamp, value: d.value })));
    // re-create the initial-capital baseline exactly once per run
    if (initLineRef.current) series.removePriceLine(initLineRef.current);
    initLineRef.current = series.createPriceLine({ price: initial, color: '#9ca3af', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'init' });
    ddRef.current?.setData(drawdown.map((d) => ({ time: (d.ts / 1000) as UTCTimestamp, value: d.value })));
  }, [data, drawdown, initial]);

  return <div ref={ref} className="h-64 w-full" />;
}
