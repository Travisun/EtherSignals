import fs from 'fs';
import path from 'path';
import { candleService } from './candleService';
import { notify } from '@/server/events/notifier';
import { settingsRepo } from '@/server/store/repos';
import {
  SYMBOL, MARKET, SIGNAL_TFS, VOTES, BASE_WEIGHTS, computeSuite, scoreAt, outcomeAt,
  HORIZON_BARS, HIT_ATR, clamp,
} from './signalCore';
import type { OptimizerRunSummary, OptimizerSummary, Timeframe } from '@/core/types';

// ─── Persistence layout (data/signals-optimizer.json) ────────────────────────
// Everything the adaptive loop knows is saved here: current per-TF vote
// weights, the full history of optimization runs (ring buffer), the graded
// prediction ledger and rolling accuracy. Survives restarts.

export interface LedgerEntry {
  ts: number;
  tf: Timeframe;
  regime: string;
  dir: 1 | -1;
  price: number;
  thr: number;
  grade: 'win' | 'loss';
  /** realized move vs thr over the horizon: 1/-1 decisive, 0 within noise */
  outcome: 1 | -1 | 0;
  gradedAt: number;
  exitPrice: number;
}

export interface WeightVersion {
  id: number;
  ts: number;
  tf: Timeframe;
  trigger: 'online' | 'batch' | 'rollback' | 'seed';
  wins: number;
  n: number;
  weights: Record<string, number>;
}

interface OptState {
  version: 1;
  symbol: string;
  marketType: string;
  weights: Partial<Record<Timeframe, Record<string, number>>>;
  history: OptimizerRunSummary[];
  ledger: Partial<Record<Timeframe, LedgerEntry[]>>;
  accuracy: Partial<Record<Timeframe, { wins: number; n: number }>>;
  versions: Partial<Record<Timeframe, WeightVersion[]>>;
  versionSeq: number;
  rollbackAt: Partial<Record<Timeframe, number>>;
  totals: { runs: number; lastRunTs: number };
}

// ─── Hedge (multiplicative weights) parameters ───────────────────────────────
// Conservative by design: every run may shift a component weight by at most
// ±~55% (exp(±η)), and clamps bound it to [0.3, 2.2]× — the composite can
// never be dominated by a single indicator off one bad regime.
const HEDGE_ETA = 0.8;
/** single-sample Hedge step for real-time (per-graded-call) updates */
const ONLINE_ETA = 0.35;
/** shrinkage toward the base weights — a prior that prevents accumulated
 *  Hedge steps from drifting into an overfit corner of the weight simplex */
const BATCH_SHRINKAGE = 0.05;
const ONLINE_SHRINKAGE = 0.01;
const WEIGHT_MIN = 0.3;
const WEIGHT_MAX = 2.2;
/** decisive samples a component needs before its weight is touched */
const MIN_COMPONENT_SAMPLES = 120;
/** minimum closed bars in the live window before the optimizer runs at all */
const MIN_BARS = 300;
const OPTIMIZE_INTERVAL_MS = 15 * 60_000;
const LEDGER_CAP = 300; // per tf
const HISTORY_CAP = 60;

const dataDir = () => process.env.DATA_DIR || path.join(process.cwd(), 'data');
const stateFile = () => path.join(dataDir(), 'signals-optimizer.json');

let state: OptState = {
  version: 1,
  symbol: SYMBOL,
  marketType: MARKET,
  weights: {},
  history: [],
  ledger: {},
  accuracy: {},
  versions: {},
  versionSeq: 0,
  rollbackAt: {},
  totals: { runs: 0, lastRunTs: 0 },
};

let saveTimer: NodeJS.Timeout | undefined;
// lazy-load guard: hot reload / route-level re-imports must not reset the
// in-memory state to base weights while the file already holds learned ones
let loaded = false;
function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  loadState();
}

function loadState() {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8');
    const parsed = JSON.parse(raw) as OptState;
    if (parsed?.version === 1 && parsed.symbol === SYMBOL && parsed.marketType === MARKET) {
      state = {
        ...state,
        ...parsed,
        versions: parsed.versions ?? {},
        versionSeq: parsed.versionSeq ?? 0,
        rollbackAt: parsed.rollbackAt ?? {},
        history: Array.isArray(parsed.history) ? parsed.history.slice(-HISTORY_CAP) : [],
      };
      console.log(`[optimizer] state loaded — ${state.totals.runs} runs on record, weights for ${Object.keys(state.weights).length} tfs`);
    } else {
      console.log('[optimizer] no compatible state file — starting from base weights');
    }
  } catch {
    console.log('[optimizer] no state file yet — starting from base weights');
  }
}

function saveState(immediate = false) {
  if (saveTimer && !immediate) return; // coalesce grade-book writes
  if (saveTimer) clearTimeout(saveTimer);
  const write = () => {
    saveTimer = undefined;
    try {
      fs.mkdirSync(dataDir(), { recursive: true });
      const tmp = `${stateFile()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, stateFile());
    } catch (e) {
      console.error('[optimizer] save failed:', e);
    }
  };
  if (immediate) write();
  else saveTimer = setTimeout(write, 3_000);
}

// ─── Weight access (used by the engine's live scoring) ───────────────────────

export function getWeight(tf: Timeframe, name: string): number {
  ensureLoaded();
  const w = state.weights[tf]?.[name];
  if (typeof w === 'number' && Number.isFinite(w)) return w;
  return BASE_WEIGHTS[name] ?? 1;
}

export function getAccuracy(tf: Timeframe): { wins: number; n: number } {
  ensureLoaded();
  return state.accuracy[tf] ?? { wins: 0, n: 0 };
}

/** append-only detail log — one line per weight version, kept forever */
function appendVersionDetail(entry: WeightVersion & { metrics?: Record<string, unknown> }) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.appendFileSync(path.join(dataDir(), 'signals-weights-history.jsonl'), JSON.stringify(entry) + '\n');
  } catch {
    // best effort — the in-state copy is the source of truth for rollback
  }
}

function bumpVersion(tf: Timeframe, trigger: WeightVersion['trigger'], weights: Record<string, number>, metrics?: Record<string, unknown>): WeightVersion {
  state.versionSeq += 1;
  const v: WeightVersion = { id: state.versionSeq, ts: Date.now(), tf, trigger, wins: 0, n: 0, weights: { ...weights } };
  const list = state.versions[tf] ?? [];
  list.push(v);
  state.versions[tf] = list.slice(-200); // in-state summary; full detail in the JSONL
  appendVersionDetail({ ...v, metrics });
  return v;
}

export function recordAccuracy(tf: Timeframe, acc: { wins: number; n: number }) {
  ensureLoaded();
  state.accuracy[tf] = acc;
  saveState();
}

// rollback policy: act only on solid evidence, at most once per 2h per tf
const ROLLBACK_MIN_N = 12;
const ROLLBACK_MAX_CURRENT = 1 / 3;
const ROLLBACK_MIN_CANDIDATE = 0.5;
const ROLLBACK_COOLDOWN_MS = 2 * 3600_000;

/**
 * Real-time learning step, called on EVERY graded prediction: accumulates the
 * outcome into the rolling accuracy and the current weight version, then —
 * when the realized move was decisive — nudges the tf's weights by one small
 * Hedge step so the live model updates immediately (the 15-min batch pass
 * remains the deep, replay-based tuner). Finally checks whether history says
 * the current version is underperforming a previous one badly enough to
 * justify a rollback.
 */
export function recordGrade(tf: Timeframe, entry: LedgerEntry, votes: Record<string, number>, callVersionId?: number) {
  ensureLoaded();
  // rolling accuracy (global per tf)
  const acc = state.accuracy[tf] ?? { wins: 0, n: 0 };
  acc.n += 1;
  if (entry.grade === 'win') acc.wins += 1;
  state.accuracy[tf] = acc;

  // per-version accuracy accumulation — every historical weight model keeps
  // its own live track record, which is what future decisions learn from.
  // The grade is credited to the version that PRODUCED the call (stamped at
  // trackCall time), not whichever version happens to be current at grade
  // time — overlapping open calls would otherwise cross-contaminate records.
  // Samples count DECISIVE outcomes only: outcome-0 (noise) is not evidence
  // against a direction call, and counting it pins every version near the
  // decisive rate and makes the rollback thresholds meaningless.
  const list = state.versions[tf] ?? [];
  const credited = (callVersionId != null && list.find((v) => v.id === callVersionId)) || list.at(-1);
  if (credited && entry.outcome !== 0) {
    credited.n += 1;
    if (entry.grade === 'win') credited.wins += 1;
  }
  appendLedger(tf, [entry]);

  // ── online weight step (real-time tuning) ──
  if (entry.outcome !== 0) {
    const cur = { ...(state.weights[tf] ?? BASE_WEIGHTS) };
    let changed = false;
    for (const v of VOTES) {
      const vote = votes[v.name];
      if (vote == null) continue;
      const loss = (1 - entry.outcome * clamp(vote)) / 2;
      const base = cur[v.name] ?? BASE_WEIGHTS[v.name] ?? 1;
      let w = base * Math.exp(-ONLINE_ETA * (loss - 0.5));
      w = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w));
      if (Math.abs(w - base) > 1e-4) changed = true;
      cur[v.name] = Number(w.toFixed(4));
    }
    if (changed) {
      const names = VOTES.map((v) => v.name);
      const mean = names.reduce((a, k) => a + (cur[k] ?? 1), 0) / names.length;
      if (mean > 0) {
        for (const k of names) cur[k] = Number(Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, (cur[k] ?? 1) / mean)).toFixed(4));
      }
      state.weights[tf] = cur;
      bumpVersion(tf, 'online', cur, { grade: entry.grade, outcome: entry.outcome, price: entry.price, exitPrice: entry.exitPrice });
      saveState();
    }
  }

  // ── history-based rollback check ──
  maybeRollback(tf, list);
}

function versionAcc(v: WeightVersion): number | null {
  return v.n >= ROLLBACK_MIN_N ? v.wins / v.n : null;
}

function maybeRollback(tf: Timeframe, list: WeightVersion[]) {
  const lastRunAt = state.rollbackAt[tf] ?? 0;
  if (Date.now() - lastRunAt < ROLLBACK_COOLDOWN_MS) return;
  const current = list.at(-1);
  if (!current) return;
  const curAcc = versionAcc(current);
  if (curAcc == null || curAcc >= ROLLBACK_MAX_CURRENT) return;
  // best historical version by live accuracy (enough samples), excluding the current one
  let best: WeightVersion | null = null;
  for (const v of list.slice(0, -1)) {
    const a = versionAcc(v);
    if (a == null || a < ROLLBACK_MIN_CANDIDATE) continue;
    if (!best || v.wins / v.n > best.wins / best.n) best = v;
  }
  if (!best) return;
  state.weights[tf] = { ...best.weights };
  const restored = bumpVersion(tf, 'rollback', best.weights, { fromVersion: current.id, toVersion: best.id, currentAcc: curAcc, bestAcc: best.wins / best.n });
  state.rollbackAt[tf] = Date.now();
  saveState(true);
  console.warn(`[optimizer] ${tf} rolled back to version #${best.id} (acc ${(best.wins / best.n).toFixed(2)} vs current ${(curAcc).toFixed(2)}) — now v${restored.id}`);
  notify('signal.rollback', { symbol: SYMBOL, tf, version: restored.id }, { level: 'warning', channel: 'signal' });
}

export function appendLedger(tf: Timeframe, entries: LedgerEntry[]) {
  ensureLoaded();
  if (!entries.length) return;
  const list = state.ledger[tf] ?? [];
  list.push(...entries);
  state.ledger[tf] = list.slice(-LEDGER_CAP);
  saveState();
}

// ─── Core math: composite accuracy under an arbitrary weight vector ──────────

interface ReplayRow { votes: Record<string, number>; outcome: 1 | -1 | 0 }

function compositeAccuracy(rows: ReplayRow[], weights: Record<string, number>): { acc: number | null; n: number } {
  let wins = 0;
  let n = 0;
  for (const row of rows) {
    let vsum = 0;
    let wsum = 0;
    for (const [name, v] of Object.entries(row.votes)) {
      const w = weights[name] ?? BASE_WEIGHTS[name] ?? 1;
      wsum += w;
      vsum += v * w;
    }
    if (wsum === 0) continue;
    const score = vsum / wsum;
    if (Math.abs(score) < 0.1) continue; // no call made
    n += 1;
    if (row.outcome !== 0 && Math.sign(score) === row.outcome) wins += 1;
  }
  return { acc: n >= 30 ? wins / n : null, n };
}

/**
 * Multiplicative-weights (Hedge) update. Components are "experts"; their
 * per-bar loss is (1 - outcome·vote)/2 over decisive bars. Weights shrink
 * when the expert was wrong more often than a coin flip and grow otherwise,
 * then are re-normalized so the composite keeps its scale, and clamped.
 */
function hedgeUpdate(
  cur: Record<string, number>,
  rows: ReplayRow[],
): { weights: Record<string, number>; stats: Record<string, { name: string; wins: number; n: number; hitRate: number | null }>; updated: boolean } {
  const next: Record<string, number> = { ...cur };
  const stats: Record<string, { name: string; wins: number; n: number; hitRate: number | null }> = {};
  let updated = false;
  for (const v of VOTES) {
    // per-component directional hit rate (for the report)…
    let wins = 0;
    let n = 0;
    // …and mean loss for the weight update
    let lossSum = 0;
    let lossN = 0;
    for (const row of rows) {
      const val = row.votes[v.name];
      if (val == null) continue;
      if (row.outcome !== 0) {
        n += 1;
        if (Math.sign(val) === row.outcome) wins += 1;
        lossSum += (1 - row.outcome * clamp(val)) / 2;
        lossN += 1;
      }
    }
    const hitRate = n >= 30 ? wins / n : null;
    stats[v.name] = { name: v.name, wins, n, hitRate };
    if (lossN < MIN_COMPONENT_SAMPLES) continue; // not enough evidence — keep prior
    const meanLoss = lossSum / lossN;
    // centered: 0.5 = coin flip; better-than-coin → weight grows
    let w = (cur[v.name] ?? BASE_WEIGHTS[v.name] ?? 1) * Math.exp(-HEDGE_ETA * (meanLoss - 0.5));
    w = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w));
    if (Math.abs(w - (cur[v.name] ?? 0)) > 1e-6) updated = true;
    next[v.name] = Number(w.toFixed(4));
  }
  // shrinkage prior: pull every weight a little toward its base value so
  // accumulated updates cannot drift into an overfit corner
  for (const v of VOTES) {
    const base = BASE_WEIGHTS[v.name] ?? 1;
    next[v.name] = (next[v.name] ?? base) * (1 - BATCH_SHRINKAGE) + base * BATCH_SHRINKAGE;
  }
  // renormalize so the mean weight stays at the base mean (=1.0): keeps the
  // composite score scale comparable across runs
  const names = VOTES.map((v) => v.name);
  const mean = names.reduce((acc, k) => acc + (next[k] ?? 1), 0) / names.length;
  if (mean > 0) {
    for (const k of names) next[k] = Number(Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, (next[k] ?? 1) / mean)).toFixed(4));
  }
  return { weights: next, stats, updated };
}

// ─── Optimization pass ───────────────────────────────────────────────────────

export async function optimizeAll(trigger: OptimizerRunSummary['trigger']): Promise<OptimizerRunSummary> {
  ensureLoaded();
  const perTf: OptimizerRunSummary['perTf'] = [];
  const weightsSnapshot: Record<string, Record<string, number>> = {};

  for (const tf of SIGNAL_TFS) {
    const all = candleService.peek(MARKET, SYMBOL, tf);
    if (all.length < MIN_BARS + HORIZON_BARS + 1) {
      perTf.push({ tf, bars: all.length, decisive: 0, selfAccBefore: null, selfAccAfter: null, uniformAcc: null, updated: false, reason: 'not enough history' });
      weightsSnapshot[tf] = { ...(state.weights[tf] ?? BASE_WEIGHTS) };
      continue;
    }
    const candles = all.slice(0, -1); // closed bars only
    const suite = computeSuite(candles);
    const cur = { ...(state.weights[tf] ?? BASE_WEIGHTS) };
    const before = { ...cur };

    const rows: ReplayRow[] = [];
    const end = candles.length - HORIZON_BARS;
    for (let i = 200; i < end; i++) {
      const { votes } = scoreAt(suite, i, (name) => cur[name] ?? BASE_WEIGHTS[name] ?? 1);
      rows.push({ votes, outcome: outcomeAt(suite, i) });
    }

    const accBefore = compositeAccuracy(rows, before);
    const uniformAcc = compositeAccuracy(rows, BASE_WEIGHTS);
    const { weights: after, stats, updated } = hedgeUpdate(before, rows);
    const accAfter = compositeAccuracy(rows, after);

    if (updated) {
      state.weights[tf] = after;
      const hasVersion = (state.versions[tf] ?? []).length > 0;
      bumpVersion(tf, hasVersion ? 'batch' : 'seed', after, { selfAccBefore: accBefore.acc, selfAccAfter: accAfter.acc });
    }
    weightsSnapshot[tf] = { ...(state.weights[tf] ?? BASE_WEIGHTS) };

    const deltas = VOTES
      .map((v) => ({ name: v.name, from: Number((before[v.name] ?? BASE_WEIGHTS[v.name] ?? 1).toFixed(3)), to: Number((after[v.name] ?? 0).toFixed(3)) }))
      .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
    perTf.push({
      tf,
      bars: rows.length,
      decisive: accBefore.n,
      selfAccBefore: accBefore.acc,
      selfAccAfter: accAfter.acc,
      uniformAcc: uniformAcc.acc,
      updated,
      topDelta: deltas[0],
      components: stats,
    });
  }

  state.totals.runs += 1;
  state.totals.lastRunTs = Date.now();
  const run: OptimizerRunSummary = { ts: Date.now(), trigger, perTf };
  state.history = [...state.history, run].slice(-HISTORY_CAP);
  saveState(true);

  const parts = perTf
    .map((t) => `${t.tf} ${t.selfAccBefore == null ? '—' : `${Math.round(t.selfAccBefore * 100)}%`}→${t.selfAccAfter == null ? '—' : `${Math.round(t.selfAccAfter * 100)}%`}${t.updated ? '✓' : '·'}`)
    .join(' · ');
  console.log(`[optimizer] run #${state.totals.runs} (${trigger}): ${parts}`);
  return run;
}

// ─── Loop + summary ──────────────────────────────────────────────────────────

// The engine instance survives hot reload via globalThis, but module state
// does not — timers left module-scoped would leave an orphaned loop racing
// the new module's writes on the same state files.
const loopHost = globalThis as {
  __gtOptLoop?: { timer?: NodeJS.Timeout; startup?: NodeJS.Timeout; running?: boolean };
};
function loop() {
  return (loopHost.__gtOptLoop ??= {});
}

export function startOptimizerLoop() {
  const l = loop();
  if (l.timer) return;
  loadState();
  // first run shortly after boot (windows need a moment to fill)
  l.startup = setTimeout(() => {
    void runOptimization('startup');
  }, 90_000);
  l.startup.unref?.();
  l.timer = setInterval(() => void runOptimization('scheduled'), OPTIMIZE_INTERVAL_MS);
  l.timer.unref?.();
}

export function stopOptimizerLoop() {
  const l = loop();
  if (l.timer) clearInterval(l.timer);
  if (l.startup) clearTimeout(l.startup);
  l.timer = l.startup = undefined;
  saveState(true);
}

/** one guarded optimization pass + a notification when weights actually moved */
export async function runOptimization(trigger: OptimizerRunSummary['trigger']) {
  const l = loop();
  if (l.running) return null;
  l.running = true;
  try {
    const run = await optimizeAll(trigger);
    if (run.perTf.some((t) => t.updated)) {
      const locale = settingsRepo.get().general.locale;
      const detail = run.perTf
        .map((t) => `${t.tf} ${t.selfAccBefore == null ? '—' : Math.round(t.selfAccBefore * 100) + '%'}→${t.selfAccAfter == null ? '—' : Math.round(t.selfAccAfter * 100) + '%'}${t.updated ? '✓' : ''}`)
        .join(' · ');
      notify('signal.optimized', { symbol: SYMBOL, detail }, { level: 'info', channel: 'signal' });
    }
    return run;
  } catch (e) {
    console.error('[optimizer] run failed:', e);
    return null;
  } finally {
    l.running = false;
  }
}

export function getCurrentVersionId(tf: Timeframe): number | undefined {
  ensureLoaded();
  return state.versions[tf]?.at(-1)?.id;
}

export function optimizerSummary(): OptimizerSummary {
  ensureLoaded();
  return {
    enabled: true,
    intervalMin: OPTIMIZE_INTERVAL_MS / 60_000,
    lastRun: state.history.at(-1) ?? null,
    runs: state.totals.runs,
    stateFile: stateFile(),
    weights: Object.fromEntries(SIGNAL_TFS.map((tf) => [tf, { ...(state.weights[tf] ?? BASE_WEIGHTS) }])),
    online: SIGNAL_TFS.map((tf) => {
      const acc = state.accuracy[tf] ?? { wins: 0, n: 0 };
      return {
        tf,
        calls: acc.n,
        wins: acc.wins,
        accuracy: acc.n > 0 ? Number(((acc.wins + 1) / (acc.n + 2)).toFixed(3)) : null,
        horizonMin: Math.round((HORIZON_BARS * barSeconds(tf)) / 60_000),
      };
    }),
    versions: Object.fromEntries(
      SIGNAL_TFS.map((tf) => [
        tf,
        (state.versions[tf] ?? []).slice(-20).map((v) => ({
          id: v.id, ts: v.ts, trigger: v.trigger, wins: v.wins, n: v.n,
          accuracy: v.n > 0 ? Number((v.wins / v.n).toFixed(3)) : null,
        })),
      ]),
    ),
  };
}

function barSeconds(tf: Timeframe): number {
  const map: Record<string, number> = { '1m': 60_000, '2m': 120_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '1d': 86_400_000 };
  return map[tf] ?? 300_000;
}
