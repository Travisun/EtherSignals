import { strategiesRepo, settingsRepo } from '@/server/store/repos';
import { candleService, isPaperMode, windowKey } from './candleService';
import { evaluateConditions, requiredWindows } from './evaluator';
import { executeOrderAction, closeSymbolPositions, precisionFields } from './executor';
import { paperBroker } from './paper';
import { notify } from '@/server/events/notifier';
import { logAudit } from '@/server/store/pg';
import { bus, Events } from '@/server/events/bus';
import { describeCondition } from '@/core/conditionTexts';
import { buildMarketContext, getTradeAdvice } from '@/server/llm/advice';
import { hasProvider } from '@/server/llm/providers';
import type { ConditionType, Strategy } from '@/core/types';

const EVAL_THROTTLE_MS = 1_000;
const LLM_TTL_MS = 10 * 60_000;
const LLM_ERROR_TTL_MS = 60_000;

interface LlmCacheEntry {
  ts: number;
  bias: 'long' | 'short' | 'neutral';
  confidence: number;
  error?: boolean;
}

interface RunningEntry {
  s: Strategy;
  keys: string[]; // all candle windows acquired for this strategy (base + external)
}

function strategyKeys(s: Strategy): string[] {
  const keys = [windowKey(s.marketType, s.symbol, s.timeframe)];
  for (const w of requiredWindows(s.conditions, s)) {
    keys.push(windowKey(w.marketType, w.symbol, w.tf));
  }
  return [...new Set(keys)];
}

/** Live execution targets: one entry per bound account (undefined = active). */
function targetAccounts(s: Strategy): (string | undefined)[] {
  if (s.paper || isPaperMode()) return [undefined];
  if (s.accountIds?.length) return s.accountIds;
  return [undefined];
}

/**
 * The trading-hook runtime: evaluates running strategies against live
 * candle windows (tick + bar-close) with cross-timeframe / cross-symbol
 * factor conditions, enforces cooldowns, fans out order actions to every
 * bound account in parallel (paper or live), and wires paper SL/TP.
 */
export class RuleEngine {
  private running = new Map<string, RunningEntry>();
  private lastEval = new Map<string, number>();
  private cooldownUntil = new Map<string, number>();
  private lastSkipNotified = new Map<string, number>();
  private llmCache = new Map<string, LlmCacheEntry>();
  private noProviderNotified = new Set<string>();
  private triggering = new Set<string>();

  get runningIds() {
    return [...this.running.keys()];
  }

  get runningCount() {
    return this.running.size;
  }

  isRunning(id: string) {
    return this.running.has(id);
  }

  async startStrategy(s: Strategy) {
    const keys = strategyKeys(s);
    for (const key of keys) {
      const [marketType, symbol, tf] = key.split(':') as [typeof s.marketType, string, typeof s.timeframe];
      await candleService.acquire(marketType, symbol, tf, 200).catch((e) => {
        notify('engine.error', { reason: `strategy ${s.name} (${symbol}): ${(e as Error).message}` }, { level: 'error', strategyId: s.id });
      });
    }
    this.running.set(s.id, { s, keys });
  }

  stopStrategy(id: string) {
    const entry = this.running.get(id);
    if (!entry) return;
    this.running.delete(id);
    // release each window; shared windows keep their refcount for other users
    for (const key of entry.keys) {
      const [marketType, symbol, tf] = key.split(':') as [typeof entry.s.marketType, string, typeof entry.s.timeframe];
      const stillUsed = [...this.running.values()].some((other) => other.keys.includes(key));
      if (!stillUsed) candleService.release(marketType, symbol, tf);
    }
    this.cooldownUntil.delete(id);
  }

  /**
   * Refresh a running strategy after an edit: re-acquire only when the
   * window set (symbol/marketType/timeframe, incl. cross-factor refs)
   * changed, otherwise just update the in-memory snapshot.
   */
  async refreshStrategy(s: Strategy) {
    const existing = this.running.get(s.id);
    if (!existing) {
      await this.startStrategy(s);
      return;
    }
    const sameWindows =
      JSON.stringify(strategyKeys(s).sort()) === JSON.stringify([...existing.keys].sort());
    if (sameWindows) {
      this.running.set(s.id, { s, keys: existing.keys });
    } else {
      this.stopStrategy(s.id);
      await this.startStrategy(s);
    }
  }

  /** Reload running strategies from the repo (after CRUD or on boot). */
  async restart() {
    const all = strategiesRepo.list();
    const toRun = all.filter((s) => s.status === 'running');
    for (const id of [...this.running.keys()]) {
      if (!toRun.some((s) => s.id === id)) this.stopStrategy(id);
    }
    for (const s of toRun) {
      await this.refreshStrategy(s);
    }
    const alive = new Set(all.map((s) => s.id));
    for (const id of [...this.llmCache.keys()]) {
      if (!alive.has(id)) this.llmCache.delete(id);
    }
    for (const id of [...this.noProviderNotified]) {
      if (!alive.has(id)) this.noProviderNotified.delete(id);
    }
  }

  /** Wire bus listeners; called once by the runtime. */
  bind() {
    bus.on('market.candle.updated', (payload) => {
      const key = (payload as { key?: string })?.key;
      if (!key) return;
      void this.onCandles(key);
    });
    bus.on(Events.CANDLE_CLOSED, (payload) => {
      const key = (payload as { key?: string })?.key;
      if (!key) return;
      void this.onCandles(key);
    });
  }

  async onCandles(key: string) {
    await this.checkPaperStops(key);
    for (const entry of this.running.values()) {
      const baseKey = windowKey(entry.s.marketType, entry.s.symbol, entry.s.timeframe);
      if (baseKey !== key) continue;
      const now = Date.now();
      if (now - (this.lastEval.get(entry.s.id) ?? 0) < EVAL_THROTTLE_MS) continue;
      this.lastEval.set(entry.s.id, now);
      try {
        await this.evaluateStrategy(entry.s);
      } catch (e) {
        console.error(`[rules] evaluate ${entry.s.name}:`, e);
      }
    }
  }

  /** Enforce stop-loss / take-profit levels on open paper positions. */
  private async checkPaperStops(key: string) {
    const parts = key.split(':');
    if (parts.length !== 3) return;
    const symbol = parts[1];
    const position = paperBroker.state().positions.find((p) => p.symbol === symbol);
    if (!position) return;
    // trigger on the market the position actually lives in
    const price =
      candleService.lastPrice(position.marketType ?? 'futures', symbol) ||
      candleService.lastPrice(position.marketType === 'spot' ? 'futures' : 'spot', symbol);
    if (!price) return;
    const stop = paperBroker.checkStops(symbol, price);
    if (!stop) return;
    try {
      const res = await executeOrderAction({
        symbol,
        marketType: position.marketType ?? 'futures',
        order: { type: 'order', orderType: 'market', side: stop.side, tradeSide: 'close', size: stop.size },
        paper: true,
        strategyId: position.strategyId,
      });
      if (res.ok) {
        notify('order.placed.paper', { symbol, side: stop.side, size: stop.size, price }, {
          level: stop.reason === 'stop_loss' ? 'error' : 'success',
          channel: 'trade',
        });
      }
    } finally {
      // release the in-flight guard whether the close filled or failed
      paperBroker.releaseClose(symbol);
    }
  }

  private async evaluateStrategy(s: Strategy) {
    const candles = candleService.peek(s.marketType, s.symbol, s.timeframe);
    if (candles.length < 25) return;
    const price = candleService.lastPrice(s.marketType, s.symbol) || candles.at(-1)!.close;

    const getWindow = (sel: { tf?: typeof s.timeframe; symbol?: string; marketType?: typeof s.marketType }) => {
      const mk = sel.marketType ?? s.marketType;
      const sym = (sel.symbol ?? s.symbol).toUpperCase();
      const tf = sel.tf ?? s.timeframe;
      const win = candleService.peek(mk, sym, tf);
      return win.length >= 2 ? win : undefined;
    };

    let llmBias: { bias: 'long' | 'short' | 'neutral'; confidence: number } | undefined;
    if (s.conditions.some((c) => c.type === 'llm_bias')) {
      const cached = this.llmCache.get(s.id);
      const ttl = cached?.error ? LLM_ERROR_TTL_MS : LLM_TTL_MS;
      if (!cached || Date.now() - cached.ts > ttl) {
        if (!hasProvider()) {
          if (!this.noProviderNotified.has(s.id)) {
            this.noProviderNotified.add(s.id);
            notify('llm.no_provider', undefined, { level: 'error', strategyId: s.id });
          }
          this.llmCache.set(s.id, { ts: Date.now(), bias: 'neutral', confidence: 0, error: true });
        } else {
          try {
            const ctx = await buildMarketContext(s.symbol, s.marketType, s.timeframe);
            const advice = await getTradeAdvice(ctx);
            this.llmCache.set(s.id, { ts: Date.now(), bias: advice.bias, confidence: advice.confidence });
            llmBias = { bias: advice.bias, confidence: advice.confidence };
          } catch (e) {
            console.error(`[rules] llm eval ${s.name}:`, e);
            this.llmCache.set(s.id, { ts: Date.now(), bias: 'neutral', confidence: 0, error: true });
          }
        }
      } else if (!cached.error) {
        llmBias = { bias: cached.bias, confidence: cached.confidence };
      }
    }

    const result = evaluateConditions(s.conditions, s.logic, { candles, price, llmBias, getWindow });
    if (result.matched) {
      await this.trigger(s, result.matchedDetails, price);
    }
  }

  private async trigger(
    s: Strategy,
    matched: { code: string; params: Record<string, string | number> }[],
    price: number,
  ) {
    if (this.triggering.has(s.id)) return;
    this.triggering.add(s.id);
    try {
      const now = Date.now();
      const until = this.cooldownUntil.get(s.id) ?? 0;
      if (now < until) {
        // one skip event per cooldown window — don't spam the event ring
        if (now - (this.lastSkipNotified.get(s.id) ?? 0) > Math.max(10_000, (until - now) * 500)) {
          this.lastSkipNotified.set(s.id, now);
          notify('strategy.skipped_cooldown', { name: s.name }, { level: 'info', strategyId: s.id, silentSocket: true });
        }
        return;
      }
      this.cooldownUntil.set(s.id, now + Math.max(0, s.cooldownSec) * 1000);
      // idempotency tag shared by every order this trigger fans out
      const triggerTag = `${s.id.replace(/[^a-zA-Z0-9]/g, '').slice(-10)}${now.toString(36)}`;

      const locale = settingsRepo.get().general.locale;
      const joiner = s.logic === 'all' ? (locale === 'zh-CN' ? ' 且 ' : ' AND ') : locale === 'zh-CN' ? ' 或 ' : ' OR ';
      const condText = matched
        .map((d) => describeCondition({ id: '', type: d.code as ConditionType, params: d.params }, locale))
        .join(joiner);

      notify('signal.triggered', { name: s.name, symbol: s.symbol, tf: s.timeframe }, {
        level: 'warning', channel: 'strategy', strategyId: s.id,
      });
      notify('signal.condition', { conditions: condText }, {
        level: 'info', channel: 'strategy', strategyId: s.id,
      });
      bus.emit(Events.STRATEGY_TRIGGERED, { strategyId: s.id, conditions: matched, price });

      const instrument = await candleService.instrument(s.marketType, s.symbol).catch(() => undefined);
      const paper = s.paper || isPaperMode();
      const accounts = targetAccounts(s);
      let actionIndex = 0;
      const failedResults: { ok: boolean }[] = [];

      for (const action of s.actions) {
        if (action.type === 'order') {
          // fan out to every bound account in parallel
          const results = await Promise.all(
            accounts.map((accountId) =>
              executeOrderAction({
                symbol: s.symbol,
                marketType: s.marketType,
                order: { ...action },
                paper,
                accountId,
                strategyId: s.id,
                clientTag: `${triggerTag}a${actionIndex}`,
                ...precisionFields(instrument),
              }),
            ),
          );
          failedResults.push(...results);
          actionIndex += 1;
        } else if (action.type === 'close_positions') {
          const results = await Promise.all(
            accounts.map((accountId) =>
              closeSymbolPositions(s.symbol, s.marketType, paper, price, s.id, accountId),
            ),
          );
          for (const rs of results) failedResults.push(...rs);
          actionIndex += 1;
        }
      }

      // every order failed (transient exchange/limit/network error) → refund
      // the cooldown so the signal isn't silently swallowed by the outage
      if (failedResults.length > 0 && failedResults.every((r) => !r.ok)) {
        this.cooldownUntil.delete(s.id);
      }

      logAudit({
        category: 'strategy', action: 'strategy.triggered', strategyId: s.id, symbol: s.symbol,
        payload: { conditions: matched, logic: s.logic, actions: s.actions, accounts: paper ? ['paper'] : accounts, price },
        result: 'ok',
      });

      strategiesRepo.update(s.id, {
        stats: { ...s.stats, triggerCount: s.stats.triggerCount + 1, lastTriggerTs: now },
      });
      if (!s.repeat) {
        strategiesRepo.update(s.id, { status: 'stopped' });
        this.stopStrategy(s.id);
        bus.emit(Events.STRATEGY_STOPPED, { strategyId: s.id });
      }
    } finally {
      this.triggering.delete(s.id);
    }
  }
}

export const ruleEngine = new RuleEngine();
