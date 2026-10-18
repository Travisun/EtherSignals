import { getAccountSummary } from './accountService';
import { candleService, isPaperMode } from './candleService';
import { ruleEngine } from './ruleEngine';
import { gridEngine } from './grid';
import { PrivateStream } from './private';
import { signalEngine } from './signalEngine';
import { marketHistory } from './marketHistory';
import { strategiesRepo, settingsRepo, backtestRepo, botsRepo, equityRepo } from '@/server/store/repos';
import { notify } from '@/server/events/notifier';
import { logAudit } from '@/server/store/pg';
import { queue } from '@/server/events/queue';
import { acquireLeadership } from '@/server/store/redis';
import { feedEquity } from './risk';
import { exchangeMetrics } from '@/server/bitget/rest';
import { runBacktest } from '@/server/backtest/runner';
import type { BacktestRun, EngineStatus } from '@/core/types';

function getIo(): import('socket.io').Server | undefined {
  return (globalThis as { __gtIo?: import('socket.io').Server }).__gtIo;
}

/**
 * Process-wide trading runtime. Created once per Node process (survives
 * dev hot-reload via globalThis), lazily started from the first API route.
 */
export class Runtime {
  startedAt = Date.now();
  privateStream = new PrivateStream();
  private started = false;
  private running = false;
  private accountTimer?: NodeJS.Timeout;
  private restartTimer?: NodeJS.Timeout;
  private gridTimer?: NodeJS.Timeout;
  private agentTimer?: NodeJS.Timeout;
  private leader: { isLeader: boolean; stop: () => void } | null = null;
  private standbyRetryTimer?: NodeJS.Timeout;
  isLeader = true;

  async start() {
    if (this.started && this.running) return;
    if (this.started && !this.running && !this.leader) {
      // single-instance mode after a stop() — allow restart
      this.started = false;
    }
    if (this.started) return;
    // multi-replica deployments: only the Redis lock holder runs the engine
    this.leader = await acquireLeadership((isLeader) => this.onLeadershipChange(isLeader));
    if (this.leader && !this.leader.isLeader) {
      console.log('[runtime] another replica leads the engine; standing by');
      this.started = true;
      this.running = false;
      this.scheduleStandbyRetry();
      return;
    }
    this.started = true;
    this.isLeader = true;
    try {
      // a crash must not leave backtests eternally "running"
      backtestRepo.reconcileInterrupted();

      await candleService.start();
      ruleEngine.bind();
      await ruleEngine.restart();
      gridEngine.bind();
      await gridEngine.restart();

      strategiesRepo.onChange(() => {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          ruleEngine.restart().catch((e) => console.error('[runtime] strategy restart:', e));
        }, 300);
      });
      botsRepo.onChange(() => {
        if (this.gridTimer) clearTimeout(this.gridTimer);
        this.gridTimer = setTimeout(() => {
          gridEngine.restart().catch((e) => console.error('[runtime] grid restart:', e));
        }, 300);
      });

      await this.privateStream.start();

      // multi-timeframe prediction signals (default: ETHUSDT 2m/5m/30m/2h/1d)
      await signalEngine.start().catch((e) => console.error('[runtime] signal engine:', e));

      // tiered market-history capture (1m/1h/1d JSONL store) + browser relay
      await marketHistory.start();
      const { marketRelay } = await import('./marketRelay');
      marketRelay.attach();

      this.accountTimer = setInterval(async () => {
        try {
          const summary = await getAccountSummary();
          // persist the equity curve + feed the daily-loss circuit breaker
          if (summary.totals.equityUsd > 0) {
            equityRepo.append({
              ts: Date.now(),
              equityUsd: summary.totals.equityUsd,
              availableUsd: summary.totals.availableUsd,
              unrealizedPnl: summary.totals.unrealizedPnl,
              paper: summary.paper,
            });
            feedEquity(summary.totals.equityUsd);
          }
          getIo()?.emit('account:update', summary);
          getIo()?.emit('engine:status', this.status());
        } catch {
          // ignore transient errors
        }
      }, 15_000);

      // LLM agent triggers (interval/event) — synced periodically
      const { syncTriggers } = await import('@/server/llm/agents');
      this.agentTimer = setInterval(() => {
        try {
          syncTriggers();
        } catch {
          // ignore
        }
      }, 60_000);
      syncTriggers();

      this.running = true;
      notify('engine.started', undefined, { level: 'success', channel: 'system' });
      logAudit({ category: 'system', action: 'engine.started', level: 'success', payload: { paper: isPaperMode() } });
      console.log('[runtime] trading engine started');
    } catch (e) {
      this.started = false;
      console.error('[runtime] start failed:', e);
      throw e;
    }
  }

  /** Graceful stop: timers → strategies → grids → streams → flush (SIGTERM path). */
  async stop() {
    if (this.accountTimer) clearInterval(this.accountTimer);
    if (this.agentTimer) clearInterval(this.agentTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.gridTimer) clearTimeout(this.gridTimer);
    if (this.standbyRetryTimer) clearTimeout(this.standbyRetryTimer);
    this.accountTimer = this.agentTimer = undefined;
    for (const id of ruleEngine.runningIds) ruleEngine.stopStrategy(id);
    for (const id of gridEngine.runningIds) gridEngine.stopBot(id);
    this.privateStream.stop();
    signalEngine.stop();
    marketHistory.stop();
    const { marketRelay } = await import('./marketRelay');
    marketRelay.stop();
    const { levelsService } = await import('./levelsService');
    levelsService.stop();
    candleService.stop();
    this.leader?.stop();
    this.leader = null;
    this.running = false;
    this.started = false;
    const { getStore } = await import('@/server/store/jsonStore');
    getStore().flushAll();
    console.log('[runtime] engine stopped cleanly');
  }

  private onLeadershipChange(isLeader: boolean) {
    if (!isLeader && this.running) {
      // fail-closed: trading with two live leaders double-fires real orders —
      // losing the lock must park the engine immediately
      console.warn('[runtime] leadership lost — stopping engine (fail-closed)');
      notify('engine.error', { reason: 'leadership lost — engine parked' }, { level: 'error' });
      void this.stopEnginesKeepStandby();
    } else if (isLeader && !this.running && this.started) {
      console.log('[runtime] leadership acquired — resuming engine');
      this.started = false;
      this.start().catch((e) => console.error('[runtime] resume failed:', e));
    }
  }

  /** stop trading loops but keep the standby retry alive */
  private async stopEnginesKeepStandby() {
    if (this.accountTimer) clearInterval(this.accountTimer);
    if (this.agentTimer) clearInterval(this.agentTimer);
    this.accountTimer = this.agentTimer = undefined;
    for (const id of ruleEngine.runningIds) ruleEngine.stopStrategy(id);
    for (const id of gridEngine.runningIds) gridEngine.stopBot(id);
    this.privateStream.stop();
    this.running = false;
    this.isLeader = false;
    this.scheduleStandbyRetry();
  }

  private scheduleStandbyRetry() {
    if (this.standbyRetryTimer) return;
    this.standbyRetryTimer = setTimeout(async () => {
      this.standbyRetryTimer = undefined;
      if (this.running || !this.leader) return;
      // the redis handle keeps refreshing its own isLeader flag
      if (this.leader.isLeader) {
        this.started = false;
        await this.start().catch(() => undefined);
      } else {
        this.scheduleStandbyRetry();
      }
    }, 20_000);
  }

  /** Reconnect private stream + refresh engine after account settings change. */
  async onAccountChanged() {
    this.privateStream.stop();
    await this.privateStream.start().catch(() => undefined);
    await ruleEngine.restart().catch(() => undefined);
    const summary = await getAccountSummary();
    getIo()?.emit('account:update', summary);
    getIo()?.emit('engine:status', this.status());
  }

  status(): EngineStatus {
    const settings = settingsRepo.get();
    const account = settings.accounts.find((a) => a.active);
    return {
      startedAt: this.startedAt,
      publicWs: candleService.started ? (candleService.wsConnected ? 'connected' : 'disconnected') : 'disabled',
      privateWs: this.privateStream.state,
      runningStrategies: ruleEngine.runningCount,
      totalStrategies: strategiesRepo.list().length,
      queueDepth: queue.depth,
      paper: isPaperMode(),
      accountLabel: account?.label,
      wsReconnects: candleService.wsReconnectCount,
      rateLimited429: exchangeMetrics.rateLimited429,
      exchangeErrors: exchangeMetrics.errors,
      clockOffsetMs: Math.round(exchangeMetrics.clockOffsetMs),
      staleWindows: candleService.windowHealth().filter((w) => w.stale).length,
      halted: settings.risk.halted ?? null,
      leader: this.isLeader,
    };
  }

  /** Queue a backtest run and process it in the background job queue. */
  queueBacktest(run: BacktestRun) {
    backtestRepo.upsert(run);
    queue.push(
      'backtest',
      run,
      async (r) => {
        backtestRepo.upsert({ ...r, status: 'running', progress: 0.1 });
        const result = await runBacktest(r.config, (p) => {
          backtestRepo.upsert({ ...r, status: 'running', progress: p });
        });
        const done: BacktestRun = {
          ...r,
          status: 'done',
          progress: 1,
          result,
          finishedAt: Date.now(),
        };
        backtestRepo.upsert(done);
        notify('backtest.done', {
          symbol: r.config.symbol,
          tf: r.config.timeframe,
          returnPct: Number(result.stats.totalReturnPct.toFixed(2)),
        }, { level: 'success', channel: 'backtest' });
      },
      {
        retries: 0,
        onError: (e) => {
          backtestRepo.upsert({ ...run, status: 'error', error: e.message, finishedAt: Date.now() });
          notify('backtest.error', { reason: e.message }, { level: 'error', channel: 'backtest' });
        },
      },
    );
  }
}

const globalStore = globalThis as { __gtRuntime?: Runtime };

export function getRuntime(): Runtime {
  if (!globalStore.__gtRuntime) {
    globalStore.__gtRuntime = new Runtime();
  }
  return globalStore.__gtRuntime;
}

/** Ensure the engine is running; safe to call from any API route. */
export async function ensureRuntime(): Promise<Runtime> {
  const rt = getRuntime();
  await rt.start();
  return rt;
}
