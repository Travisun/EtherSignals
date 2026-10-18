import { candleService } from './candleService';
import { levelsService } from './levelsService';
import { bus, Events } from '@/server/events/bus';
import { notify } from '@/server/events/notifier';
import { fmtPrice, tfSeconds } from '@/lib/format';
import { DEFAULT_DON_N, NHNL_TFS, computeNhnlSnapshot } from '@/core/nhnl';
import {
  settingsRepo, signalPushRepo,
} from '@/server/store/repos';
import {
  SIGNAL_TFS, ACQUIRE_LIMIT, CONFIRM_BARS, SYMBOL, MARKET, ENABLED,
  HIT_ATR, HORIZON_BARS, TG_MIN_INTERVAL_MS, computeSuite, scoreAt, regimeWithHysteresis, regimeDir,
  patternsAt, replayStats, laplace, EMPTY_STAT,
  type DetectedPattern, type Suite,
} from './signalCore';
import {
  getWeight, getAccuracy, recordGrade, getCurrentVersionId,
  startOptimizerLoop, stopOptimizerLoop, optimizerSummary, runOptimization,
} from './signalOptimizer';
import type { Candle, NhnlRow, PatternState, SignalSnapshot, TFSignal, Timeframe, TrendRegime } from '@/core/types';

// ─── Presentation ────────────────────────────────────────────────────────────

const REGIME_ZH: Record<TrendRegime, string> = { strong_up: '强势上涨', up: '上涨趋势', neutral: '震荡', down: '下跌趋势', strong_down: '强势下跌' };
const REGIME_EN: Record<TrendRegime, string> = { strong_up: 'Strong Up', up: 'Uptrend', neutral: 'Range', down: 'Downtrend', strong_down: 'Strong Down' };
const REGIME_ICON: Record<TrendRegime, string> = { strong_up: '↑↑', up: '↑', neutral: '→', down: '↓', strong_down: '↓↓' };
const PATTERN_ZH: Record<string, string> = {
  ema_align_bull: 'EMA多头排列', ema_align_bear: 'EMA空头排列',
  macd_golden: 'MACD金叉', macd_dead: 'MACD死叉',
  st_flip_bull: '超级趋势转多', st_flip_bear: '超级趋势转空',
  rsi_recovery: 'RSI超卖回升', rsi_fade: 'RSI超买回落',
  donchian_break_up: '唐奇安向上突破', donchian_break_down: '唐奇安向下突破',
  bb_squeeze: '布林收口待变盘',
};
const PATTERN_EN: Record<string, string> = {
  ema_align_bull: 'EMA bull stack', ema_align_bear: 'EMA bear stack',
  macd_golden: 'MACD golden cross', macd_dead: 'MACD death cross',
  st_flip_bull: 'SuperTrend flipped long', st_flip_bear: 'SuperTrend flipped short',
  rsi_recovery: 'RSI left oversold', rsi_fade: 'RSI left overbought',
  donchian_break_up: 'Donchian breakout up', donchian_break_down: 'Donchian breakdown',
  bb_squeeze: 'Bollinger squeeze',
};
function fmtPct(p: number | null): string {
  return p == null ? '—' : `${Math.round(p * 100)}%`;
}

function buildLine(sig: Omit<TFSignal, 'line' | 'lineEn'>): { line: string; lineEn: string } {
  const patterns = sig.patterns.length
    ? sig.patterns.map((p) => `${PATTERN_ZH[p.key] ?? p.key} ${fmtPct(p.prob)}`).join('·')
    : '';
  const patternsEn = sig.patterns.length
    ? sig.patterns.map((p) => `${PATTERN_EN[p.key] ?? p.key} ${fmtPct(p.prob)}`).join(' · ')
    : '';
  const scoreStr = `${sig.score >= 0 ? '+' : ''}${sig.score.toFixed(2)}`;
  const parts = [
    `${REGIME_ICON[sig.regime]} ${REGIME_ZH[sig.regime]}`,
    `延续概率 ${fmtPct(sig.prob)}(n=${sig.probSamples})`,
    patterns ? `形态: ${patterns}` : '',
    `评分 ${scoreStr} · ADX ${sig.adx?.toFixed(1) ?? '—'}`,
  ].filter(Boolean);
  const partsEn = [
    `${REGIME_ICON[sig.regime]} ${REGIME_EN[sig.regime]}`,
    `continuation ${fmtPct(sig.prob)} (n=${sig.probSamples})`,
    patternsEn ? `patterns: ${patternsEn}` : '',
    `score ${scoreStr} · ADX ${sig.adx?.toFixed(1) ?? '—'}`,
  ].filter(Boolean);
  return { line: parts.join(' | '), lineEn: partsEn.join(' | ') };
}

// ─── Engine ──────────────────────────────────────────────────────────────────

interface TfState {
  signal: TFSignal;
  /** fingerprint of the state whose change warrants a push */
  fingerprint: string;
}

interface OpenCall {
  ts: number;
  dir: 1 | -1;
  price: number;
  thr: number;
  deadline: number;
  /** component votes at call time — the online learning step's input */
  votes: Record<string, number>;
  /** weight version that produced this call — grades are credited to it */
  versionId?: number;
}

function getIo(): import('socket.io').Server | undefined {
  return (globalThis as { __gtIo?: import('socket.io').Server }).__gtIo;
}

export class SignalEngine {
  private states = new Map<Timeframe, TfState>();
  private lastEvalBar = new Map<Timeframe, number>();
  private pending = new Map<Timeframe, { regime: TrendRegime; count: number }>();
  private dirty = new Set<Timeframe>();
  private drainTimer?: NodeJS.Timeout;
  private safetyTimer?: NodeJS.Timeout;
  private gradeTimer?: NodeJS.Timeout;
  private openCalls = new Map<Timeframe, OpenCall[]>();
  private busOffs: (() => void)[] = [];
  /** telegram channel rate limit: at most one trend push per minute */
  private lastTgPush = 0;
  private tgTimer?: NodeJS.Timeout;
  private tgQueuedTf?: Timeframe;
  /** tfs whose window THIS engine actually holds — stop() must not release
   *  refcounts for a tf whose acquire failed (they belong to other consumers) */
  private acquired = new Set<Timeframe>();
  started = false;

  get config() {
    return { symbol: SYMBOL, marketType: MARKET, timeframes: SIGNAL_TFS, enabled: ENABLED };
  }

  async start() {
    if (this.started || !ENABLED) return;
    this.started = true;
    console.log(`[signals] monitoring ${MARKET} ${SYMBOL} on ${SIGNAL_TFS.join('/')}`);
    for (const tf of SIGNAL_TFS) {
      await candleService
        .acquire(MARKET, SYMBOL, tf, ACQUIRE_LIMIT[tf])
        .then(() => this.acquired.add(tf))
        .catch((e) => {
          console.error(`[signals] acquire ${tf} failed:`, e instanceof Error ? e.message : e);
        });
    }
    // hold the full NHNL ladder for this symbol so every webhook push embeds
    // the multi-timeframe new-high/new-low block (failure is non-fatal — the
    // payload simply carries fewer rows until the windows are live)
    await levelsService.holdLadder(MARKET, SYMBOL).catch((e) => {
      console.error('[signals] hold NHNL ladder failed:', e instanceof Error ? e.message : e);
    });
    this.busOffs.push(
      bus.on(Events.CANDLE_CLOSED, (p) => this.onCandleClosed(p as { key: string } | undefined)),
    );
    // safety net: idempotent re-eval catches any missed close events
    this.safetyTimer = setInterval(() => this.evaluateAll(), 60_000);
    this.safetyTimer.unref?.();
    this.gradeTimer = setInterval(() => this.gradeOpenCalls(), 60_000);
    this.gradeTimer.unref?.();
    // adaptive weights + persisted prediction ledger
    startOptimizerLoop();
    await this.evaluateAll();
  }

  stop() {
    if (!this.started) return; // never started → we hold no windows; releasing
    // them would corrupt OTHER consumers' refcounts (rule engine, charts)
    for (const off of this.busOffs) off();
    this.busOffs = [];
    if (this.safetyTimer) clearInterval(this.safetyTimer);
    if (this.gradeTimer) clearInterval(this.gradeTimer);
    if (this.drainTimer) clearTimeout(this.drainTimer);
    if (this.tgTimer) clearTimeout(this.tgTimer);
    this.safetyTimer = this.gradeTimer = this.drainTimer = this.tgTimer = undefined;
    stopOptimizerLoop();
    for (const tf of this.acquired) candleService.release(MARKET, SYMBOL, tf);
    this.acquired.clear();
    this.states.clear();
    this.pending.clear();
    this.lastEvalBar.clear();
    this.openCalls.clear();
    this.started = false;
  }

  /**
   * Manual optimization pass, delegated through this globalThis-preserved
   * instance so dev hot-reload (which can re-instantiate route graphs with an
   * empty candleService) still reads the live windows the engine owns.
   */
  optimizeNow() {
    return runOptimization('manual');
  }

  /** Current snapshot for the API / socket clients. */
  snapshot(): SignalSnapshot {
    const signals = SIGNAL_TFS
      .map((tf) => this.states.get(tf)?.signal)
      .filter((s): s is TFSignal => Boolean(s));
    const missing = SIGNAL_TFS.filter((tf) => !this.states.has(tf));
    const ladderPrice = candleService.lastPrice(MARKET, SYMBOL);
    const ladderWindows: Partial<Record<Timeframe, Candle[]>> = {};
    for (const tf of NHNL_TFS) ladderWindows[tf] = candleService.peek(MARKET, SYMBOL, tf);
    const nhnlRows = computeNhnlSnapshot(ladderWindows, ladderPrice, DEFAULT_DON_N);
    return {
      symbol: SYMBOL,
      marketType: MARKET,
      summary: signals.map((s) => `${s.tf}${REGIME_ICON[s.regime]}`).join(' ')
        + missing.map((tf) => ` ${tf}…`).join(''),
      summaryEn: signals.map((s) => `${s.tf} ${REGIME_EN[s.regime]}`).join(' · '),
      signals,
      at: Date.now(),
      optimizer: optimizerSummary(),
      nhnl: nhnlRows.length ? { price: ladderPrice, donN: DEFAULT_DON_N, rows: nhnlRows } : null,
    };
  }

  /**
   * Deep replay on freshly fetched history — the tuning aid behind
   * /api/signals?view=calibration. Reports per-regime continuation rates,
   * per-pattern hit rates, state-flip frequency (stability) and the replay's
   * own directional accuracy.
   */
  async calibrate(maxBars = 600) {
    const out = [];
    for (const tf of SIGNAL_TFS) {
      const weightOf = (name: string) => getWeight(tf, name);
      const candles = await candleService.fetchHistory(MARKET, SYMBOL, tf, maxBars);
      if (candles.length < 240) {
        out.push({ tf, bars: candles.length, error: 'not enough history' });
        continue;
      }
      const suite = computeSuite(candles);
      const r = replayStats(suite, CONFIRM_BARS[tf], weightOf);
      const regimeStats: Record<string, unknown> = {};
      for (const [regime, st] of r.regimeStats) {
        regimeStats[regime] = { ...st, prob: laplace(st) };
      }
      const patternStats: Record<string, unknown> = {};
      for (const [key, st] of r.patternStats) {
        patternStats[key] = { ...st, prob: laplace(st) };
      }
      out.push({
        tf,
        bars: r.bars,
        flips: r.flips,
        flipsPer100Bars: Number(((r.flips / Math.max(1, r.bars)) * 100).toFixed(2)),
        selfAccuracy: r.dirStats.n >= 15 ? Number(((r.dirStats.wins + 1) / (r.dirStats.n + 2)).toFixed(3)) : null,
        selfSamples: r.dirStats.n,
        regimeShare: Object.fromEntries(
          Object.entries(r.regimeBars).map(([k, v]) => [k, Number((v / Math.max(1, r.bars)).toFixed(3))]),
        ),
        regimeStats,
        patternStats,
      });
    }
    return {
      symbol: SYMBOL,
      marketType: MARKET,
      generatedAt: Date.now(),
      params: {
        enterTrend: 0.16, enterStrong: 0.42, exitTrend: 0.08,
        strongAdxGate: 20, horizonBars: 3, hitAtr: HIT_ATR,
        confirmBars: Object.fromEntries(SIGNAL_TFS.map((tf) => [tf, CONFIRM_BARS[tf]])),
      },
      perTf: out,
    };
  }

  // ── internals ──

  private onCandleClosed(p?: { key: string }) {
    if (!p) return;
    const parts = p.key.split(':');
    if (parts[0] !== MARKET || parts[1] !== SYMBOL) return;
    const tf = parts[2] as Timeframe;
    if (!SIGNAL_TFS.includes(tf)) return;
    this.queueEvaluate(tf);
  }

  /** coalesce bursts of closes (reconnect catch-up) into one evaluation */
  private queueEvaluate(tf: Timeframe) {
    this.dirty.add(tf);
    if (this.drainTimer) return;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = undefined;
      const tfs = [...this.dirty];
      this.dirty.clear();
      for (const t of tfs) this.safeEvaluate(t);
    }, 200);
    this.drainTimer.unref?.();
  }

  private safeEvaluate(tf: Timeframe) {
    try {
      this.evaluateTf(tf);
    } catch (e) {
      console.error(`[signals] eval ${tf}:`, e);
    }
  }

  private evaluateAll() {
    for (const tf of SIGNAL_TFS) this.safeEvaluate(tf);
  }

  private evaluateTf(tf: Timeframe) {
    const all = candleService.peek(MARKET, SYMBOL, tf);
    // analyze closed bars only — the trailing forming bar wiggles with every
    // tick and would make the regime flicker. (The confirmed flag is only
    // reliably maintained on WS-updated bars, so slice instead of filter.)
    if (all.length < 221) return; // EMA200 warmup + minimal walk-forward tail
    const candles = all.slice(0, -1);
    const last = candles[candles.length - 1];
    if (last.time <= (this.lastEvalBar.get(tf) ?? 0)) return; // idempotent
    const prevBar = this.lastEvalBar.get(tf) ?? 0;
    this.lastEvalBar.set(tf, last.time);

    try {
    const weightOf = (name: string) => getWeight(tf, name);
    const suite = computeSuite(candles);
    const i = candles.length - 1;
    const { score, votes } = scoreAt(suite, i, weightOf);
    const adxVal = suite.adx14.adx[i];
    const prev = this.states.get(tf);
    const prevRegime = prev?.signal.regime ?? 'neutral';
    const hyst = regimeWithHysteresis(prevRegime, score, adxVal == null ? null : adxVal);

    // confirmation state machine: fast TFs must hold the new regime for
    // CONFIRM_BARS closed bars before it commits. On the very first
    // evaluation (boot baseline) adopt the current regime directly — there
    // is no previous state to protect against flip-flopping.
    let committed: TrendRegime = prevRegime;
    if (!prev) {
      committed = hyst;
      this.pending.delete(tf);
    } else if (hyst === prevRegime) {
      this.pending.delete(tf);
    } else {
      const p = this.pending.get(tf);
      if (p?.regime === hyst) p.count += 1;
      else this.pending.set(tf, { regime: hyst, count: 1 });
      if ((this.pending.get(tf)?.count ?? 0) >= CONFIRM_BARS[tf]) {
        committed = hyst;
        this.pending.delete(tf);
      }
    }

    const sig = this.buildSignal(tf, committed, suite, i, score, prev?.signal);
    const coreFp = this.coreFingerprintOf(sig);

    if (!prev) {
      // first evaluation after boot — establish the baseline silently
      this.states.set(tf, { signal: sig, fingerprint: coreFp });
      this.emitUpdate(tf, sig, false);
      return;
    }

    // Push gate: regime/probability drift or a NEW pattern appearing counts as
    // a change; a pattern merely expiring (e.g. a cross one bar old) does not.
    const coreChanged = coreFp !== prev.fingerprint;
    const prevKeys = new Set(prev.signal.patterns.map((p) => p.key));
    const appeared = sig.patterns.some((p) => !prevKeys.has(p.key));
    this.states.set(tf, { signal: sig, fingerprint: coreFp });
    if (committed !== prevRegime) this.trackCall(tf, committed, suite, i, votes);
    this.emitUpdate(tf, sig, coreChanged || appeared);
    } catch (e) {
      // un-claim the bar so the 60s safety timer retries this evaluation
      this.lastEvalBar.set(tf, prevBar);
      throw e;
    }
  }

  /** fingerprint of the state whose change warrants a push */
  private coreFingerprintOf(sig: TFSignal): string {
    const probBucket = sig.prob == null ? 'x' : Math.round(sig.prob * 20); // 5% buckets
    return `${sig.regime}|${probBucket}`;
  }

  private buildSignal(
    tf: Timeframe,
    regime: TrendRegime,
    suite: Suite,
    i: number,
    score: number,
    prev?: TFSignal,
  ): TFSignal {
    const weightOf = (name: string) => getWeight(tf, name);
    const replay = replayStats(suite, CONFIRM_BARS[tf], weightOf);
    const regimeStat = replay.regimeStats.get(regime) ?? EMPTY_STAT();
    const patterns: PatternState[] = patternsAt(suite, i).map((p: DetectedPattern) => {
      const st = replay.patternStats.get(p.key) ?? EMPTY_STAT();
      return { ...p, prob: laplace(st), samples: st.n };
    });
    const acc = getAccuracy(tf);
    const partial: Omit<TFSignal, 'line' | 'lineEn'> = {
      tf,
      regime,
      score: Number(score.toFixed(3)),
      adx: suite.adx14.adx[i] == null ? null : Number((suite.adx14.adx[i] as number).toFixed(1)),
      rsi: suite.rsi14[i] == null ? null : Number((suite.rsi14[i] as number).toFixed(1)),
      prob: laplace(regimeStat),
      probSamples: regimeStat.n,
      patterns,
      price: suite.candles[i].close,
      barTime: suite.candles[i].time,
      accuracy: acc.n > 0 ? Number(((acc.wins + 1) / (acc.n + 2)).toFixed(3)) : prev?.accuracy ?? null,
    };
    const { line, lineEn } = buildLine(partial);
    return { ...partial, line, lineEn };
  }

  /** production accuracy loop: grade committed calls HORIZON_BARS later */
  private trackCall(tf: Timeframe, regime: TrendRegime, suite: Suite, i: number, votes: Record<string, number>) {
    const dir = regimeDir(regime);
    if (dir === 0) return;
    const a = suite.atr14[i];
    if (a == null) return;
    const list = this.openCalls.get(tf) ?? [];
    list.push({
      ts: Date.now(),
      dir,
      price: suite.candles[i].close,
      thr: HIT_ATR * a,
      deadline: Date.now() + HORIZON_BARS * tfSeconds(tf) * 1000,
      votes: { ...votes },
      versionId: getCurrentVersionId(tf),
    });
    this.openCalls.set(tf, list.slice(-8));
  }

  private gradeOpenCalls() {
    const now = Date.now();
    for (const [tf, calls] of this.openCalls) {
      const stillOpen: OpenCall[] = [];
      for (const call of calls) {
        if (now < call.deadline) {
          stillOpen.push(call);
          continue;
        }
        // grade at the horizon bar's close (never "whatever the price is
        // right now") — immune to downtime drift between deadline and check
        const window = candleService.peek(MARKET, SYMBOL, tf);
        const horizonSec = call.deadline / 1000;
        const exitBar = [...window].reverse().find((b) => b.time + tfSeconds(tf) <= horizonSec);
        const exitPrice = exitBar?.close ?? 0;
        if (!exitPrice) {
          stillOpen.push(call); // horizon bar not available yet — retry next pass
          continue;
        }
        // realized move over the horizon vs the noise threshold
        const move = exitPrice - call.price;
        const outcome: 1 | -1 | 0 = move > call.thr ? 1 : move < -call.thr ? -1 : 0;
        const win = outcome !== 0 && outcome === call.dir;
        const acc = getAccuracy(tf);
        recordGrade(tf, {
          ts: call.ts,
          tf,
          regime: call.dir === 1 ? 'long' : 'short',
          dir: call.dir,
          price: call.price,
          thr: Number(call.thr.toFixed(4)),
          grade: win ? 'win' : 'loss',
          outcome,
          gradedAt: now,
          exitPrice,
        }, call.votes, call.versionId);
        console.log(`[signals] graded ${tf}: ${win ? 'HIT' : 'MISS'} (move ${move >= 0 ? '+' : ''}${move.toFixed(2)} vs thr ±${call.thr.toFixed(2)}) rolling ${acc.wins}/${acc.n}`);
      }
      this.openCalls.set(tf, stillOpen.slice(-8));
    }
  }

  private emitUpdate(tf: Timeframe, sig: TFSignal, changed: boolean, urgent = false) {
    const snap = this.snapshot();
    getIo()?.emit('signals:update', snap);
    if (!changed) return;
    this.queueTrendPush(tf, urgent);
  }

  /** Telegram channel rate limit: at most one trend push per minute. Any
   *  change fires a push, but bursts are coalesced — the trailing push always
   *  renders the LATEST board, so an elided intermediate state is never lost. */
  /**
   * Two-tier push decision: URGENT events (Strong regime entering/leaving,
   * objective-level crossings) bypass the rate window and go out immediately —
   * cancelling any pending normal push whose board content they already
   * include. NORMAL events (adjacent regime flips, new patterns, probability
   * drift) coalesce on the TG_MIN_INTERVAL_MS window into the freshest board,
   * so bursts never spam the channel and no intermediate state is lost.
   */
  private queueTrendPush(tf: Timeframe, urgent: boolean) {
    if (urgent) {
      if (this.tgTimer) {
        clearTimeout(this.tgTimer);
        this.tgTimer = undefined;
        this.tgQueuedTf = undefined;
      }
      this.lastTgPush = Date.now();
      this.notifyTrend(tf);
      return;
    }
    const wait = this.lastTgPush + TG_MIN_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      this.lastTgPush = Date.now();
      this.notifyTrend(tf);
      return;
    }
    this.tgQueuedTf = tf;
    if (this.tgTimer) return; // already scheduled — it picks up the latest state
    this.tgTimer = setTimeout(() => {
      this.tgTimer = undefined;
      const t = this.tgQueuedTf;
      this.tgQueuedTf = undefined;
      if (!t) return;
      this.lastTgPush = Date.now();
      this.notifyTrend(t);
    }, wait);
    this.tgTimer.unref?.();
  }

  /** Classic floor-trader pivot set from the last COMPLETED daily session,
   *  plus the Donchian-20 extremes (20 closed daily bars) — the union forms
   *  the objective support/resistance level set. */
  private dailyLevels(): { levels: number[]; donHigh: number; donLow: number; pp: number } | null {
    const daily = candleService.peek(MARKET, SYMBOL, '1d');
    if (daily.length < 22) return null;
    const closed = daily.slice(0, -1);        // forming session excluded
    const prev = closed[closed.length - 1];   // last completed session
    const win = closed.slice(-21, -1);        // the 20 closed sessions before it
    if (win.length < 20 || !prev.high || !prev.low) return null;
    const pp = (prev.high + prev.low + prev.close) / 3;
    const { high: h, low: l } = prev;
    const levels = [
      pp,
      2 * pp - l, 2 * pp - h,                 // R1, S1
      pp + (h - l), pp - (h - l),             // R2, S2
      h + 2 * (pp - l), l - 2 * (h - pp),     // R3, S3
    ];
    // prior-20-bar channel (excludes the most recent closed bar — the classic
    // Donchian breakout reference: yesterday's close vs the channel before it)
    const donHigh = Math.max(...win.map((c) => c.high));
    const donLow = Math.min(...win.map((c) => c.low));
    levels.push(donHigh, donLow);
    return {
      levels: levels.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b),
      donHigh,
      donLow,
      pp,
    };
  }

  /** nearest objective levels around the live price + Donchian state */
  private marketLevels() {
    const price = candleService.lastPrice(MARKET, SYMBOL);
    const lv = this.dailyLevels();
    if (!lv || !price) return null;
    const res = lv.levels.find((v) => v > price);
    const sup = [...lv.levels].reverse().find((v) => v < price);
    const breakout = price >= lv.donHigh ? 'up' : price <= lv.donLow ? 'down' : 'inside';
    return { res, sup, pp: lv.pp, donHigh: lv.donHigh, donLow: lv.donLow, breakout: breakout as 'up' | 'down' | 'inside' };
  }

  /** did the triggering timeframe's last closed bar cross an objective level? */
  private breakoutCross(suite: Suite, i: number): boolean {
    const lv = this.dailyLevels();
    if (!lv || i < 1) return false;
    const prevC = suite.closes[i - 1];
    const curC = suite.closes[i];
    return lv.levels.some((L) => (prevC < L && curC >= L) || (prevC > L && curC <= L));
  }

  /** SELF-CONTAINED status report: `[SYMBOL] price` head, a fixed-width
   *  aligned table (monospace-rendered on Telegram) of every timeframe's
   *  regime + continuation win rate, and any pattern live on the triggering
   *  TF. Nothing references earlier messages — reading the latest push alone
   *  fully describes the present. */
  private notifyTrend(tf: Timeframe) {
    const sig = this.states.get(tf)?.signal;
    if (!sig) return;
    const snap = this.snapshot();
    const livePrice = candleService.lastPrice(MARKET, SYMBOL);
    const priceStr = fmtPrice(livePrice || sig.price, 'en');
    const rows = snap.signals.map((s) => ({
      tf: s.tf,
      sig: `${REGIME_ICON[s.regime]} ${REGIME_EN[s.regime]}`,
      pct: s.prob == null ? '—' : `${Math.round(s.prob * 100)}%`,
    }));
    const sigW = Math.max('Signal'.length, ...rows.map((r) => r.sig.length));
    const board = [
      `TF  Signal${' '.repeat(sigW - 'Signal'.length + 2)}Win%`,
      ...rows.map((r) => `${r.tf.padEnd(3)}  ${r.sig.padEnd(sigW + 2)}${r.pct.padStart(5)}`),
    ].join('\n');
    const level = sig.regime === 'strong_up' ? 'success' : sig.regime === 'strong_down' ? 'warning' : 'info';
    const patterns = sig.patterns.length
      ? `\n\nPatterns: ${sig.patterns
          .map((p) => (p.prob == null ? PATTERN_EN[p.key] : `${PATTERN_EN[p.key]} ${fmtPct(p.prob)}`))
          .join(', ')}`
      : '';
    let levels = '';
    const ml = this.marketLevels();
    if (ml) {
      const f = (v?: number) => (v == null ? '—' : fmtPrice(v, 'en'));
      const d = (v?: number) => (v == null || !livePrice ? '—' : `${v >= livePrice ? '+' : ''}${(((v - livePrice) / livePrice) * 100).toFixed(2)}%`);
      const bo = ml.breakout === 'up' ? 'BREAKOUT' : ml.breakout === 'down' ? 'BREAKDOWN' : 'inside';
      levels = [
        '',
        'Levels',
        `  Resistance  ${f(ml.res).padStart(10)}  ${d(ml.res).padStart(8)}`,
        `  Pivot       ${f(ml.pp).padStart(10)}  ${d(ml.pp).padStart(8)}`,
        `  Support     ${f(ml.sup).padStart(10)}  ${d(ml.sup).padStart(8)}`,
        `  Donchian-20 ${bo} · H ${f(ml.donHigh)} / L ${f(ml.donLow)}`,
      ].join('\n');
    }
    // structured payload for remote webhook consumers (same facts, machine-readable)
    const ladderPrice = livePrice || sig.price;
    const ladderWindows: Partial<Record<Timeframe, Candle[]>> = {};
    for (const tf of NHNL_TFS) ladderWindows[tf] = candleService.peek(MARKET, SYMBOL, tf);
    const nhnlRows = computeNhnlSnapshot(ladderWindows, ladderPrice, DEFAULT_DON_N);
    const nhnl = nhnlRows.length ? { price: ladderPrice, donN: DEFAULT_DON_N, rows: nhnlRows } : null;
    // human-readable ladder for the channel/in-app board: only the timeframes
    // with an active break — the full 16-dimension grid lives in the payload
    const nhnlText = (() => {
      if (!nhnlRows.length) return '';
      // every timeframe gets its strongest glyph — the full ladder is always
      // visible in the human-readable push, not just the breaks
      const glyph = (r: NhnlRow): string => {
        if (r.nh && r.nl) return `${r.tf} NH+NL`;
        if (r.nh) return `${r.tf} NH`;
        if (r.nl) return `${r.tf} NL`;
        if (r.brkUp) return `${r.tf} prev↑`;
        if (r.brkDown) return `${r.tf} prev↓`;
        if (r.donUp) return `${r.tf} D${DEFAULT_DON_N}↑`;
        if (r.donDown) return `${r.tf} D${DEFAULT_DON_N}↓`;
        return `${r.tf} ·`;
      };
      return `\n\nNHNL ladder: ${nhnlRows.map(glyph).join('  ')}`;
    })();
    const webhookData = {
      symbol: SYMBOL,
      marketType: MARKET,
      price: ladderPrice,
      timeframe: tf,
      regime: sig.regime,
      score: sig.score,
      signals: snap.signals.map((x) => ({
        tf: x.tf, regime: x.regime, score: x.score, prob: x.prob,
        patterns: x.patterns.map((p) => ({ key: p.key, prob: p.prob })),
      })),
      levels: ml ? { resistance: ml.res, pivot: ml.pp, support: ml.sup, donchianHigh: ml.donHigh, donchianLow: ml.donLow, breakout: ml.breakout } : null,
      // multi-timeframe new-high/new-low ladder (start() holds the windows;
      // rows only cover timeframes whose windows are live)
      nhnl,
    };
    notify('signal.trend', {
      detail: `[${SYMBOL}] ${priceStr}\n\n${board}${levels}${patterns}${nhnlText}`,
    }, { level, channel: 'signal', data: webhookData });
    // structured record of every push (nhnl ladder included) for
    // /api/signals?view=history — capped ring, debounced flush
    signalPushRepo.append({
      ts: Date.now(),
      tf,
      regime: sig.regime,
      score: sig.score,
      price: webhookData.price,
      symbol: SYMBOL,
      marketType: MARKET,
      board: webhookData.signals,
      levels: webhookData.levels,
      nhnl: webhookData.nhnl,
    });
    console.log(`[signals] ${SYMBOL} ${tf} -> ${sig.regime} (prob=${sig.prob ?? 'n/a'}) score=${sig.score}`);
  }
}

const globalStore = globalThis as { __gtSignalEngine?: SignalEngine };

export const signalEngine: SignalEngine = globalStore.__gtSignalEngine ?? new SignalEngine();
globalStore.__gtSignalEngine = signalEngine;
