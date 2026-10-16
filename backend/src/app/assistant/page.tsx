'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Card, Badge, EmptyState, Switch } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Segmented } from '@/components/ui/tabs';
import { useTradeIntent } from '@/stores/tradeIntent';
import { useRouter } from 'next/navigation';
import { fmtPrice } from '@/lib/format';
import { ArrowUp, Eraser, Sparkles, TrendingDown, TrendingUp, Scale, Lightbulb, Bot, Plus, Play, Trash2, Pencil } from 'lucide-react';
import type { LlmAdvice, MarketType, Timeframe } from '@/core/types';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const MESSAGES_KEY = 'gt.assistant.messages';
const MAX_PERSISTED_MESSAGES = 100;

function loadPersistedMessages(): Msg[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const msgs: Msg[] = [];
    for (const m of parsed) {
      if (m && typeof m === 'object') {
        const { role, content } = m as Partial<Msg>;
        if ((role === 'user' || role === 'assistant') && typeof content === 'string') msgs.push({ role, content });
      }
    }
    return msgs.slice(-MAX_PERSISTED_MESSAGES);
  } catch {
    return [];
  }
}

export default function AssistantPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [advice, setAdvice] = useState<LlmAdvice | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [hasProvider, setHasProvider] = useState(true);
  const [includeContext, setIncludeContext] = useState(true);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [marketType] = useState<MarketType>('futures');
  const [tf] = useState<Timeframe>('1h');
  const [contextSummary, setContextSummary] = useState<{ price: number; positions: { symbol: string; side: string; size: number; unrealizedPL: number }[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'chat' | 'agents'>('chat');

  useEffect(() => {
    fetch('/api/llm').then((r) => r.json()).then((j) => setHasProvider(Boolean(j?.data?.hasProvider))).catch(() => undefined);
  }, []);

  // conversation persistence — only chat messages, never suggestions/advice
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setMessages(loadPersistedMessages());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (messages.length === 0) localStorage.removeItem(MESSAGES_KEY);
      else localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-MAX_PERSISTED_MESSAGES)));
    } catch {
      // storage disabled
    }
  }, [messages, hydrated]);

  // market context panel — debounced so typing in the symbol box doesn't
  // fire a request per keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch(`/api/engine?view=context&symbol=${symbol}&marketType=${marketType}&tf=${tf}`)
        .then((r) => r.json())
        .then((j) => {
          if (j?.ok) setContextSummary({ price: j.data.context.price, positions: j.data.context.positions });
        })
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [symbol, marketType, tf]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const sendChat = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || streaming) return;
    if (!override) setInput('');
    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setStreaming(true);

    let contextInjected = false;
    if (includeContext) {
      try {
        const j = await fetch(`/api/engine?view=context&symbol=${symbol}&marketType=${marketType}&tf=${tf}`).then((r) => r.json());
        if (j?.ok) {
          history.splice(0, 0, {
            role: 'user' as const,
            content: `[Market context for ${symbol} ${tf}]\n${j.data.prompt}\n[End of market context]`,
          });
          history.splice(1, 0, { role: 'assistant', content: t('assistant.marketContextInjected', { symbol }) });
          contextInjected = true;
        }
      } catch {
        // context is optional
      }
    }
    void contextInjected;

    try {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'chat', messages: history }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith('data:')) continue;
          const data = s.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            if (j.error) {
              toast.error(t('assistant.errorPrefix'), String(j.error));
              continue;
            }
            if (j.token) {
              setMessages((msgs) => {
                const next = [...msgs];
                next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + j.token };
                return next;
              });
            }
          } catch {
            // skip malformed frame
          }
        }
      }
    } catch (e) {
      toast.error(t('assistant.errorPrefix'), String(e));
    } finally {
      setStreaming(false);
    }
  };

  const genAdvice = async () => {
    setAdviceLoading(true);
    try {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'advice', symbol, marketType, timeframe: tf }),
      });
      const j = await res.json();
      if (j?.ok) {
        setAdvice(j.data.advice);
        toast.success(t('assistant.generateAdvice'), `${symbol}: ${j.data.advice.bias} (${j.data.advice.confidence})`);
      } else {
        toast.error(t('assistant.errorPrefix'), j?.error);
      }
    } catch (e) {
      toast.error(t('assistant.errorPrefix'), String(e));
    } finally {
      setAdviceLoading(false);
    }
  };

  const applyAdvice = () => {
    if (!advice) return;
    const side: 'buy' | 'sell' = advice.bias === 'short' ? 'sell' : 'buy';
    const base = advice.entry ?? contextSummary?.price ?? 0;
    const prefill: { side: 'buy' | 'sell'; price?: number; slPct?: number; tpPct?: number } = {
      side,
      price: advice.entry ?? undefined,
    };
    if (base > 0) {
      if (advice.stopLoss != null) {
        prefill.slPct = Math.round((Math.abs(base - advice.stopLoss) / base) * 100 * 100) / 100;
      }
      const tp = advice.takeProfit.find((x) => x != null);
      if (tp != null) {
        prefill.tpPct = Math.round((Math.abs(tp - base) / base) * 100 * 100) / 100;
      }
    }
    useTradeIntent.getState().set({ symbol, marketType, prefill });
    router.push('/trade');
  };

  if (!hasProvider) {
    return (
      <div className="mx-auto w-full max-w-4xl p-3 md:p-5">
        <Card>
          <EmptyState
            icon={<Sparkles className="h-8 w-8" />}
            title={t('assistant.title')}
            description={t('assistant.noProvider')}
            action={<Link href="/settings"><Button>{t('assistant.goToSettings')}</Button></Link>}
          />
        </Card>
      </div>
    );
  }

  const BiasIcon = advice?.bias === 'long' ? TrendingUp : advice?.bias === 'short' ? TrendingDown : Scale;

  if (view === 'agents') {
    return <AgentsPanel onBack={() => setView('chat')} />;
  }

  return (
    <div className="mx-auto grid h-full max-w-7xl gap-3 p-3 md:p-5 lg:grid-cols-[1fr_340px]">
      {/* chat */}
      <Card className="flex min-h-[60dvh] flex-col overflow-hidden lg:h-[calc(100dvh-140px)]">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand-500" />
            <h2 className="text-sm font-semibold">{t('assistant.title')}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="ghost" onClick={() => setMessages([])}>
              <Eraser className="h-3 w-3" /> {t('assistant.clearChat')}
            </Button>
            <Button size="xs" variant="outline" onClick={() => setView('agents')}>
              <Bot className="h-3 w-3" /> {t('agents.title')}
            </Button>
          </div>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Sparkles className="h-10 w-10 text-brand-200" />
              <p className="max-w-sm text-sm leading-relaxed text-gray-400">{t('assistant.subtitle')}</p>
              <div className="flex max-w-md flex-wrap justify-center gap-2">
                {([1, 2, 3, 4] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => void sendChat(t(`assistant.prompt${n}`))}
                    disabled={streaming}
                    className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:border-brand-400 hover:text-brand-600 disabled:opacity-50"
                  >
                    {t(`assistant.prompt${n}`)}
                  </button>
                ))}
              </div>
              <p className="max-w-md text-2xs leading-relaxed text-gray-300">{t('assistant.disclaimer')}</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                  m.role === 'user' ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-gray-50 text-gray-800',
                )}
              >
                {m.content || (streaming && i === messages.length - 1 ? '…' : '')}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 p-3">
          <div className="mb-2 flex items-center gap-2 text-2xs text-gray-400">
            <Switch checked={includeContext} onChange={setIncludeContext} />
            {t('assistant.includeContext')} · {symbol}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void sendChat();
                }
              }}
              placeholder={t('assistant.placeholder')}
              rows={2}
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <Button size="lg" loading={streaming} onClick={() => void sendChat()} disabled={!input.trim()} className="h-11 w-11 !px-0">
              {!streaming && <ArrowUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </Card>

      {/* context + advice */}
      <div className="space-y-3">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">{t('assistant.context')}</h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className="h-8 flex-1 text-xs" />
              <Badge tone="brand">{tf.toUpperCase()}</Badge>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>{t('assistant.contextPrice')}</span>
              <span className="font-medium tabular-nums text-gray-800">{fmtPrice(contextSummary?.price, locale)}</span>
            </div>
            {(contextSummary?.positions?.length ?? 0) > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>{t('assistant.contextPositions')}</span>
                <span className={cn('font-medium', (contextSummary?.positions?.[0]?.unrealizedPL ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                  {contextSummary?.positions?.[0]?.side} {contextSummary?.positions?.[0]?.size}
                </span>
              </div>
            )}
            <Button block size="sm" loading={adviceLoading} onClick={genAdvice}>
              <Lightbulb className="h-3.5 w-3.5" /> {adviceLoading ? t('assistant.generating') : t('assistant.generateAdvice')}
            </Button>
          </div>
        </Card>

        {advice && (
          <Card className="overflow-hidden">
            <div className={cn('flex items-center justify-between px-4 py-3', advice.bias === 'long' ? 'bg-up/5' : advice.bias === 'short' ? 'bg-down/5' : 'bg-gray-50')}>
              <div className="flex items-center gap-2">
                <BiasIcon className={cn('h-5 w-5', advice.bias === 'long' ? 'text-up' : advice.bias === 'short' ? 'text-down' : 'text-gray-400')} />
                <div>
                  <div className="text-sm font-bold">{t(`assistant.bias_${advice.bias}`)}</div>
                  <div className="text-2xs text-gray-400">{t('assistant.confidence')} {advice.confidence}%</div>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={applyAdvice}>{t('assistant.applyToOrder')}</Button>
            </div>
            <div className="space-y-2 px-4 py-3 text-xs">
              <AdviceRow label={t('assistant.entry')} value={advice.entry != null ? fmtPrice(advice.entry, locale) : '—'} />
              <AdviceRow label={t('assistant.stopLoss')} value={advice.stopLoss != null ? fmtPrice(advice.stopLoss, locale) : '—'} />
              <AdviceRow label={t('assistant.takeProfit')} value={advice.takeProfit.filter((x) => x != null).map((x) => fmtPrice(x, locale)).join(' / ') || '—'} />
              <AdviceRow label={t('assistant.horizon')} value={advice.timeHorizon} />
              <div className="pt-1">
                <div className="mb-1 text-2xs text-gray-400">{t('assistant.summary')}</div>
                <p className="leading-relaxed text-gray-700">{advice.summary}</p>
              </div>
              {advice.risks.length > 0 && (
                <div className="rounded-lg bg-amber-50 p-2.5">
                  <div className="mb-1 text-2xs font-medium text-amber-600">{t('assistant.risks')}</div>
                  <ul className="list-inside list-disc space-y-0.5 text-2xs leading-relaxed text-amber-700">
                    {advice.risks.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {advice.indicatorsCited.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {advice.indicatorsCited.map((x, i) => <Badge key={i} tone="brand">{x}</Badge>)}
                </div>
              )}
              <p className="pt-1 text-2xs leading-relaxed text-gray-300">{t('assistant.disclaimer')}</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function AdviceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium tabular-nums text-gray-800">{value}</span>
    </div>
  );
}

// ─── LLM Agents management ───────────────────────────────────────────────────

const AGENT_TOOLS = [
  'send_notification', 'get_ticker', 'list_tickers', 'get_candles', 'get_market_context',
  'get_balance', 'get_positions', 'get_open_orders', 'get_order_history',
  'list_strategies', 'get_signals', 'get_audit_logs',
];

interface AgentRow {
  id: string;
  name: string;
  enabled: boolean;
  systemPrompt: string;
  tools: string[];
  liveOrders: boolean;
  maxActionsPerRun: number;
  trigger: { type: 'manual' | 'interval' | 'event'; intervalSec?: number; event?: string };
  task?: string;
  lastRunTs?: number;
  lastOutput?: string;
}

function AgentsPanel({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [editing, setEditing] = useState<Partial<AgentRow> | null>(null);
  const [deleting, setDeleting] = useState<AgentRow | null>(null);
  const [runInput, setRunInput] = useState('');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<Record<string, string>>({});

  const reload = React.useCallback(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) {
          setAgents(j.data.agents);
          setOutputs(Object.fromEntries((j.data.agents as AgentRow[]).map((a) => [a.id, a.lastOutput ?? ''])));
        }
      })
      .catch(() => undefined);
  }, []);

  React.useEffect(() => reload(), [reload]);

  const run = async (id: string, input: string) => {
    setRunningId(id);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', id, input }),
      });
      const j = await res.json();
      if (j?.ok) {
        setOutputs((o) => ({ ...o, [id]: j.data.output }));
        toast.success(t('agents.run'));
        reload();
      } else {
        toast.error(t('assistant.errorPrefix'), j?.error ?? j?.data?.output);
      }
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-3 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{t('agents.title')}</h2>
          <p className="text-xs text-gray-400">{t('agents.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onBack}>{t('common.back')}</Button>
          <Button size="sm" onClick={() => setEditing({ name: '', enabled: true, tools: ['send_notification', 'get_ticker', 'get_balance'], liveOrders: false, maxActionsPerRun: 4, trigger: { type: 'manual' }, systemPrompt: '' })}>
            <Plus className="h-4 w-4" /> {t('agents.create')}
          </Button>
        </div>
      </div>

      {agents.length === 0 && (
        <Card><EmptyState icon={<Bot className="h-8 w-8" />} title={t('agents.empty')} /></Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {agents.map((a) => (
          <Card key={a.id} className="space-y-2.5 p-4">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 shrink-0 text-brand-500" />
                  <span className="truncate text-sm font-semibold">{a.name}</span>
                  <Badge tone={a.enabled ? 'up' : 'gray'}>{a.enabled ? t('common.enabled') : t('common.disabled')}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone="brand">{a.trigger.type === 'manual' ? t('agents.triggerManual') : a.trigger.type === 'interval' ? `${t('agents.triggerInterval')} ${a.trigger.intervalSec}s` : `${t('agents.triggerEvent')} ${a.trigger.event}`}</Badge>
                  <Badge tone={a.liveOrders ? 'down' : 'amber'}>{a.liveOrders ? t('agents.liveOrders') : t('strategies.paperExec')}</Badge>
                  <Badge>{t('agents.toolsCount', { n: a.tools.length })}</Badge>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => setEditing(a)} className="rounded p-1 text-gray-400 hover:text-brand-600"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => setDeleting(a)} className="rounded p-1 text-gray-400 hover:text-down"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            {a.lastOutput && (
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-2xs leading-relaxed text-gray-600">
                <div className="mb-0.5 text-gray-400">{t('agents.lastOutput')}</div>
                {outputs[a.id] || a.lastOutput}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input value={runInput} onChange={(e) => setRunInput(e.target.value)} placeholder={t('agents.input')} className="h-8 flex-1 text-xs" />
              <Button size="sm" loading={runningId === a.id} onClick={() => run(a.id, runInput)} disabled={runningId === a.id}>
                <Play className="h-3 w-3" /> {runningId === a.id ? t('agents.running') : t('agents.run')}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <AgentEditor agent={editing} open={editing != null} onClose={() => setEditing(null)} onSaved={reload} />
      <ConfirmDialog
        open={deleting != null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await fetch(`/api/agents?id=${deleting.id}`, { method: 'DELETE' });
          setDeleting(null);
          reload();
        }}
        text={t('agents.deleteWarning')}
      />
      <div className="h-2" />
    </div>
  );
}

function AgentEditor({
  agent, open, onClose, onSaved,
}: {
  agent: Partial<AgentRow> | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState<Partial<AgentRow> | null>(agent);
  const [saving, setSaving] = useState(false);
  React.useEffect(() => setForm(agent), [agent]);
  if (!form) return null;
  const patch = (p: Partial<AgentRow>) => setForm((f) => (f ? { ...f, ...p } : f));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, action: 'save' }),
      });
      const j = await res.json();
      if (j?.ok) {
        toast.success(t('settings.saved'));
        onSaved();
        onClose();
      } else toast.error(t('common.requestFailed'), j?.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={form.id ? `${t('common.edit')} · ${form.name}` : t('agents.create')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={saving} onClick={save}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('strategies.name')}>
            <Input value={form.name ?? ''} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label={t('agents.trigger')}>
            <div className="flex gap-2">
              <Select
                className="flex-1"
                value={form.trigger?.type ?? 'manual'}
                onChange={(v: string) => patch({ trigger: { type: v as 'manual' | 'interval' | 'event', intervalSec: v === 'interval' ? 300 : undefined, event: v === 'event' ? 'strategy.triggered' : undefined } })}
                options={[
                  { value: 'manual', label: t('agents.triggerManual') },
                  { value: 'interval', label: t('agents.triggerInterval') },
                  { value: 'event', label: t('agents.triggerEvent') },
                ]}
              />
              {form.trigger?.type === 'interval' && (
                <Input className="w-28" inputMode="numeric" value={String(form.trigger.intervalSec ?? 300)} onChange={(e) => patch({ trigger: { type: 'interval', intervalSec: Number(e.target.value) || 300 } })} />
              )}
              {form.trigger?.type === 'event' && (
                <Input className="w-44" value={form.trigger.event ?? ''} onChange={(e) => patch({ trigger: { type: 'event', event: e.target.value } })} placeholder={t('agents.eventName')} />
              )}
            </div>
          </Field>
        </div>
        <Field label={t('agents.prompt')}>
          <Textarea rows={4} value={form.systemPrompt ?? ''} onChange={(e) => patch({ systemPrompt: e.target.value })} />
        </Field>
        <Field label={t('agents.task')}>
          <Textarea rows={2} value={form.task ?? ''} onChange={(e) => patch({ task: e.target.value })} />
        </Field>
        <Field label={t('agents.tools')}>
          <div className="flex flex-wrap gap-1.5">
            {AGENT_TOOLS.map((tool) => {
              const active = (form.tools ?? []).includes(tool);
              return (
                <button key={tool} onClick={() => patch({ tools: active ? (form.tools ?? []).filter((x) => x !== tool) : [...(form.tools ?? []), tool] })}
                  className={cn('rounded-md px-2 py-1 text-2xs font-medium transition-colors', active ? 'bg-brand-50 text-brand-700' : 'bg-gray-50 text-gray-500 hover:text-gray-700')}>
                  {tool}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid items-end gap-3 sm:grid-cols-2">
          <Field label={t('agents.liveOrders')} hint={t('agents.liveOrdersHint')}>
            <Segmented block value={form.liveOrders ? '1' : '0'} onChange={(v) => patch({ liveOrders: v === '1' })} options={[{ value: '0', label: t('strategies.paperExec') }, { value: '1', label: t('strategies.liveExec') }]} />
          </Field>
          <Field label={t('agents.maxActions')}>
            <Input inputMode="numeric" value={String(form.maxActionsPerRun ?? 4)} onChange={(e) => patch({ maxActionsPerRun: Number(e.target.value) || 4 })} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}