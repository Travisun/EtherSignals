import { getStore } from './jsonStore';
import {
  type AccountConfig, type AppSettings, type AppEvent, type Strategy, type GridBot,
  type BacktestRun, type PaperState, type EquitySnapshot,
} from '@/core/types';

// ─── Settings ────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    locale: 'zh-CN',
    upDownColor: 'auto',
    defaultSymbol: 'BTCUSDT',
    defaultMarketType: 'futures',
    defaultTimeframe: '15m',
    paperMode: false,
  },
  accounts: [],
  smtp: {
    enabled: false, host: '', port: 465, secure: true, username: '', password: '', from: '', to: '',
  },
  notifications: {
    desktop: true, mail: false, socket: true, minLevel: 'info',
    telegram: { enabled: false, botToken: '', chatId: '' },
    webhook: { enabled: false, url: '', token: '' },
    webpush: { enabled: false, publicKey: '', privateKey: '', subscriptions: [] },
  },
  llm: {
    providers: [],
    activeProviderId: undefined,
    chatSystemPrompt: '',
    adviceSystemPrompt: '',
    temperature: 0.4,
  },
  risk: {
    maxOrderUsd: 1000,
    confirmOrders: true,
    killSwitch: false,
    maxDailyLossUsd: undefined,
    maxTotalExposureUsd: undefined,
    maxConsecutiveLosses: undefined,
    maxDailyMovePct: undefined,
    halted: undefined,
  },
  mcp: { enabled: false, token: '' },
  security: {
    enabled: false,
    username: '',
    passwordHash: '',
    totpSecret: '',
    totpEnabled: false,
    pinHash: '',
    pinFailCount: 0,
    pinLocked: false,
    devices: [],
  },
  onboarding: { completed: false },
};

class SettingsRepo {
  private cache: AppSettings | null = null;
  private cacheMtime = -1;

  get(): AppSettings {
    // re-read when the FILE changed on disk — in dev the engine (globalThis
    // instance) and the API route hold SEPARATE copies of this class, and a
    // settings update through one graph must be visible to the other (e.g.
    // the engine's telegram targets), otherwise stale cached config is used
    const m = getStore().mtime('settings');
    if (!this.cache || m !== this.cacheMtime) {
      const stored = getStore().read<Partial<AppSettings>>('settings', {});
      this.cache = {
        ...DEFAULT_SETTINGS,
        ...stored,
        general: { ...DEFAULT_SETTINGS.general, ...stored.general },
        smtp: { ...DEFAULT_SETTINGS.smtp, ...stored.smtp },
        notifications: {
          ...DEFAULT_SETTINGS.notifications,
          ...stored.notifications,
          telegram: { ...DEFAULT_SETTINGS.notifications.telegram, ...stored.notifications?.telegram },
          webhook: { ...DEFAULT_SETTINGS.notifications.webhook, ...stored.notifications?.webhook },
          webpush: { ...DEFAULT_SETTINGS.notifications.webpush, ...stored.notifications?.webpush },
        },
        llm: { ...DEFAULT_SETTINGS.llm, ...stored.llm, providers: stored.llm?.providers ?? [] },
        risk: { ...DEFAULT_SETTINGS.risk, ...stored.risk },
        mcp: { ...DEFAULT_SETTINGS.mcp, ...stored.mcp },
        security: { ...DEFAULT_SETTINGS.security, ...stored.security, devices: stored.security?.devices ?? [] },
        onboarding: { ...DEFAULT_SETTINGS.onboarding, ...stored.onboarding },
      };
      this.cacheMtime = m;
    }
    return this.cache;
  }

  save(next: AppSettings) {
    this.cache = next;
    getStore().write('settings', next);
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const cur = this.get();
    const next: AppSettings = {
      ...cur,
      ...patch,
      general: { ...cur.general, ...(patch.general ?? {}) },
      smtp: { ...cur.smtp, ...(patch.smtp ?? {}) },
      notifications: {
        ...cur.notifications,
        ...(patch.notifications ?? {}),
        telegram: { ...cur.notifications.telegram, ...(patch.notifications?.telegram ?? {}) },
        webhook: { ...cur.notifications.webhook, ...(patch.notifications?.webhook ?? {}) },
        webpush: { ...cur.notifications.webpush, ...(patch.notifications?.webpush ?? {}) },
      },
      llm: patch.llm ? { ...cur.llm, ...patch.llm } : cur.llm,
      risk: { ...cur.risk, ...(patch.risk ?? {}) },
      mcp: { ...cur.mcp, ...(patch.mcp ?? {}) },
      security: { ...cur.security, ...(patch.security ?? {}) },
      accounts: patch.accounts ?? cur.accounts,
    };
    this.save(next);
    return next;
  }

  activeAccount(): AccountConfig | null {
    return this.get().accounts.find((a) => a.active) ?? null;
  }
}

export const settingsRepo = new SettingsRepo();

// ─── Strategies ──────────────────────────────────────────────────────────────

class StrategiesRepo {
  private listeners = new Set<() => void>();
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  list(): Strategy[] {
    return getStore().read<Strategy[]>('strategies', []);
  }

  get(id: string): Strategy | undefined {
    return this.list().find((s) => s.id === id);
  }

  save(strategy: Strategy) {
    const all = this.list();
    const idx = all.findIndex((s) => s.id === strategy.id);
    strategy.stats.updatedAt = Date.now();
    if (idx >= 0) all[idx] = strategy;
    else all.push(strategy);
    getStore().write('strategies', all);
    this.notify();
  }

  remove(id: string) {
    const all = this.list().filter((s) => s.id !== id);
    getStore().write('strategies', all);
    this.notify();
  }

  update(id: string, patch: Partial<Strategy>): Strategy | undefined {
    const all = this.list();
    const s = all.find((x) => x.id === id);
    if (!s) return undefined;
    Object.assign(s, patch);
    s.stats.updatedAt = Date.now();
    getStore().write('strategies', all);
    this.notify();
    return s;
  }
}

export const strategiesRepo = new StrategiesRepo();

// ─── Event log (ring buffer) ─────────────────────────────────────────────────

const EVENT_LIMIT = 500;

class EventsRepo {
  /** in-memory source of truth; flushed to disk with a single-timer debounce */
  private cache: AppEvent[] | null = null;

  list(): AppEvent[] {
    if (!this.cache) this.cache = getStore().read<AppEvent[]>('events', []);
    return this.cache;
  }

  append(ev: AppEvent) {
    const all = this.list();
    all.unshift(ev);
    if (all.length > EVENT_LIMIT) all.length = EVENT_LIMIT;
    getStore().writeDebounced('events', all);
  }

  clear() {
    this.cache = [];
    getStore().write('events', []);
  }
}

export const eventsRepo = new EventsRepo();

// ─── Backtest runs ───────────────────────────────────────────────────────────

const RUN_LIMIT = 30;

class BacktestRepo {
  list(): BacktestRun[] {
    return getStore().read<BacktestRun[]>('backtests', []);
  }

  get(id: string): BacktestRun | undefined {
    return this.list().find((r) => r.id === id);
  }

  upsert(run: BacktestRun) {
    const all = this.list();
    const idx = all.findIndex((r) => r.id === run.id);
    if (idx >= 0) all[idx] = run;
    else all.unshift(run);
    // drop stale equity payloads beyond the limit
    all.splice(RUN_LIMIT);
    getStore().write('backtests', all);
  }

  remove(id: string) {
    getStore().write('backtests', this.list().filter((r) => r.id !== id));
  }

  /** mark runs stuck in running/pending (process crash) as interrupted */
  reconcileInterrupted() {
    const all = this.list();
    let changed = false;
    for (const r of all) {
      if (r.status === 'running' || r.status === 'pending') {
        r.status = 'error';
        r.error = 'interrupted by restart';
        r.finishedAt = Date.now();
        changed = true;
      }
    }
    if (changed) getStore().write('backtests', all);
  }
}

export const backtestRepo = new BacktestRepo();

// ─── Equity snapshots (account value history) ────────────────────────────────

const EQUITY_LIMIT = 20_000;

class EquityRepo {
  private cache: EquitySnapshot[] | null = null;

  list(): EquitySnapshot[] {
    if (!this.cache) this.cache = getStore().read<EquitySnapshot[]>('equity', []);
    return this.cache;
  }

  append(snap: EquitySnapshot) {
    const all = this.list();
    const last = all[0];
    // account timer fires every 15s — drop bursts, cap the total series
    if (last && snap.ts - last.ts < 5_000) return;
    all.unshift(snap);
    if (all.length > EQUITY_LIMIT) all.length = EQUITY_LIMIT;
    getStore().writeDebounced('equity', all, 2_000);
  }

  /** wipe the series — must also reset the in-memory cache or appends resurrect old rows */
  clear() {
    this.cache = [];
    getStore().write('equity', []);
  }

  /** downsample for charting: at most `points` snapshots spread over the range */
  series(points = 200): EquitySnapshot[] {
    const all = this.list().slice().sort((a, b) => a.ts - b.ts);
    if (all.length <= points) return all;
    const step = all.length / points;
    const out: EquitySnapshot[] = [];
    for (let i = 0; i < points; i++) {
      out.push(all[Math.floor(i * step)]);
    }
    out.push(all[all.length - 1]);
    return out;
  }
}

export const equityRepo = new EquityRepo();

// ─── Paper account ───────────────────────────────────────────────────────────

export const PAPER_INITIAL = 10_000;

class PaperRepo {
  get(): PaperState {
    return getStore().read<PaperState>('paper', {
      balances: { USDT: PAPER_INITIAL },
      positions: [],
      orders: [],
      trades: [],
      initialCapital: PAPER_INITIAL,
      createdAt: Date.now(),
    });
  }

  save(state: PaperState) {
    state.orders = state.orders.slice(0, 200);
    state.trades = state.trades.slice(0, 500);
    state.positions = state.positions.filter((p) => p.size > 0);
    getStore().write('paper', state);
  }

  reset(initial = PAPER_INITIAL) {
    getStore().write('paper', {
      balances: { USDT: initial },
      positions: [],
      orders: [],
      trades: [],
      initialCapital: initial,
      createdAt: Date.now(),
    });
  }
}

export const paperRepo = new PaperRepo();

// ─── Grid bots ───────────────────────────────────────────────────────────────

class BotsRepo {
  private listeners = new Set<() => void>();
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  list(): GridBot[] {
    return getStore().read<GridBot[]>('gridbots', []);
  }

  get(id: string): GridBot | undefined {
    return this.list().find((b) => b.id === id);
  }

  save(bot: GridBot) {
    const all = this.list();
    const idx = all.findIndex((b) => b.id === bot.id);
    bot.stats.updatedAt = Date.now();
    if (idx >= 0) all[idx] = bot;
    else all.push(bot);
    getStore().write('gridbots', all);
    this.notify();
  }

  update(id: string, patch: Partial<GridBot>): GridBot | undefined {
    const all = this.list();
    const b = all.find((x) => x.id === id);
    if (!b) return undefined;
    Object.assign(b, patch);
    b.stats.updatedAt = Date.now();
    getStore().write('gridbots', all);
    this.notify();
    return b;
  }

  remove(id: string) {
    getStore().write('gridbots', this.list().filter((b) => b.id !== id));
    this.notify();
  }
}

export const botsRepo = new BotsRepo();
