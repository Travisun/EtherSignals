// ─── Shared domain types for DownTrade ────────────────────────────────────────

export type MarketType = 'spot' | 'futures';
export type OrderSide = 'buy' | 'sell';
export type TradeSide = 'open' | 'close';
export type OrderType = 'limit' | 'market';
export type Timeframe = '1m' | '2m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '2d' | '3d' | '1w' | '1M';
export type EventLevel = 'info' | 'success' | 'warning' | 'error';

export const TIMEFRAMES: Timeframe[] = ['1m', '2m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '2d', '3d', '1w', '1M'];

export interface Ticker {
  symbol: string;
  last: number;
  ask?: number;
  bid?: number;
  high24h: number;
  low24h: number;
  change24h: number; // fraction, e.g. 0.0234 = +2.34%
  baseVolume: number;
  quoteVolume: number;
  indexPrice?: number;
  fundingRate?: number;
  ts: number;
}

export interface Candle {
  time: number; // seconds
  open: number;
  high: number;
  low: number;
  close: number;
  baseVol?: number;
  quoteVol?: number;
  confirmed?: boolean;
}

export interface BookLevel {
  price: number;
  size: number;
}
export interface Book {
  asks: BookLevel[];
  bids: BookLevel[];
  ts: number;
}

export interface PublicTrade {
  ts: number;
  price: number;
  size: number;
  side: OrderSide; // taker side
}

export interface Instrument {
  symbol: string;
  marketType: MarketType;
  base: string;
  quote: string;
  pricePrecision: number;
  quantityPrecision: number;
  minTradeAmount?: number;
  minTradeUSDT?: number;
  priceTick?: number;
}

export type OrderStatus = 'live' | 'partially_filled' | 'filled' | 'canceled' | 'failed';

export interface OrderRecord {
  orderId: string;
  clientOid?: string;
  symbol: string;
  marketType: MarketType;
  side: OrderSide;
  tradeSide?: TradeSide; // futures hedge mode
  orderType: OrderType;
  price?: number;
  size: number; // base quantity
  filledSize: number;
  avgPrice?: number;
  status: OrderStatus;
  fee?: number;
  feeCoin?: string;
  pnl?: number;
  leverage?: number;
  force?: string;
  ts: number;
  updateTime?: number;
  source?: 'manual' | 'strategy' | 'paper' | 'backtest';
  strategyId?: string;
}

export interface PositionRecord {
  symbol: string;
  marginCoin: string;
  marginMode: 'crossed' | 'isolated';
  holdMode: 'hedge_mode' | 'one_way_mode';
  side: 'long' | 'short';
  size: number;
  available: number;
  leverage: number;
  openPriceAvg: number;
  markPrice?: number;
  unrealizedPL: number;
  liquidationPrice?: number;
  marginSize?: number;
  marginRatio?: number;
  cTime: number;
  uTime: number;
  paper?: boolean;
  /** paper-only bookkeeping */
  marketType?: MarketType;
  slPct?: number;
  tpPct?: number;
  strategyId?: string;
}

export interface AssetBalance {
  coin: string;
  available: number;
  frozen: number;
  total: number;
}

export interface FuturesAccountBalance {
  marginCoin: string;
  equity: number;
  available: number;
  unrealizedPL: number;
  marginUsed: number;
  bbox?: boolean;
}

export interface AccountSummary {
  paper: boolean;
  spot: AssetBalance[];
  futures: FuturesAccountBalance[];
  totals: {
    equityUsd: number;
    availableUsd: number;
    unrealizedPnl: number;
  };
  ts: number;
}

// ─── Strategy hooks ──────────────────────────────────────────────────────────

export type ConditionType =
  | 'price_above'
  | 'price_below'
  | 'price_cross_up'
  | 'price_cross_down'
  | 'price_change_pct'
  | 'price_new_high'
  | 'price_new_low'
  | 'donchian_break_up'
  | 'donchian_break_down'
  | 'rsi_above'
  | 'rsi_below'
  | 'macd_golden'
  | 'macd_death'
  | 'ma_cross_up'
  | 'ma_cross_down'
  | 'volume_spike'
  | 'boll_break_up'
  | 'boll_break_down'
  | 'llm_bias';

export interface Condition {
  id: string;
  type: ConditionType;
  params: Record<string, number | string>;
  /** scope overrides: omit to inherit the strategy's market/symbol/timeframe */
  tf?: Timeframe;
  symbol?: string;
  marketType?: MarketType;
}

export type ConditionLogic = 'all' | 'any';

export interface ActionOrder {
  type: 'order';
  orderType: OrderType;
  side: OrderSide;
  tradeSide?: TradeSide | 'auto'; // futures only; 'auto' = open
  size: number; // base quantity
  price?: number; // limit price; omit for market
  leverage?: number; // futures only
  stopLossPct?: number;
  takeProfitPct?: number;
}

export interface ActionNotify {
  type: 'notify';
}

export interface ActionClosePositions {
  type: 'close_positions';
}

export type StrategyAction = ActionOrder | ActionNotify | ActionClosePositions;

export interface Strategy {
  id: string;
  name: string;
  symbol: string;
  marketType: MarketType;
  timeframe: Timeframe;
  status: 'running' | 'stopped';
  paper: boolean;
  /**
   * Live execution accounts (empty = the active account). When several are
   * bound, every trigger fans out to all of them in parallel. Paper
   * strategies ignore this and always route to the paper broker.
   */
  accountIds: string[];
  logic: ConditionLogic;
  conditions: Condition[];
  actions: StrategyAction[];
  cooldownSec: number; // minimum seconds between two triggers
  repeat: boolean; // allow repeated triggers
  note?: string;
  stats: {
    triggerCount: number;
    winCount?: number;
    lossCount?: number;
    /** cumulative realized PnL attributed to this strategy (paper + close fills) */
    realizedPnl?: number;
    lastTriggerTs?: number;
    createdAt: number;
    updatedAt: number;
  };
}

// ─── Grid trading bots ───────────────────────────────────────────────────────

export interface GridFill {
  ts: number;
  side: 'buy' | 'sell';
  levelPrice: number;
  price: number;
  qty: number;
  pnl?: number;
  accountId?: string;
  paper: boolean;
}

export interface GridBot {
  id: string;
  name: string;
  symbol: string;
  marketType: MarketType;
  status: 'running' | 'stopped';
  paper: boolean;
  accountIds: string[];
  leverage: number;
  lowerPrice: number;
  upperPrice: number;
  grids: number;
  quantityPerGrid: number;
  /** seed one inventory unit per level below the entry price on start */
  initialBuy: boolean;
  /** optional cross-chart entry gate: grid only trades while matched */
  entryLogic: ConditionLogic;
  entryConditions: Condition[];
  /** optional cross-chart stop gate: auto-stops the bot when matched */
  stopLogic: ConditionLogic;
  stopConditions: Condition[];
  /** runtime state (persisted): grid level inventories */
  levels: { price: number; hasInventory: boolean }[];
  /** FIFO open buys awaiting a higher-level sell */
  buyStack: { price: number; qty: number; ts: number }[];
  lastPrice?: number;
  fills: GridFill[];
  stats: {
    buyFills: number;
    sellFills: number;
    realizedPnl: number;
    fees: number;
    createdAt: number;
    updatedAt: number;
    startedAt?: number;
  };
}

// ─── LLM agents ──────────────────────────────────────────────────────────────

export interface LlmAgentTrigger {
  type: 'manual' | 'interval' | 'event';
  intervalSec?: number;
  event?: string;
}

export interface LlmAgent {
  id: string;
  name: string;
  enabled: boolean;
  systemPrompt: string;
  /** whitelist of tool names (from the MCP tool registry + send_notification) */
  tools: string[];
  /** allow real (non-paper) orders via the place_order tool */
  liveOrders: boolean;
  maxActionsPerRun: number;
  trigger: LlmAgentTrigger;
  /** standing instruction used for interval/event runs */
  task?: string;
  lastRunTs?: number;
  lastOutput?: string;
}

// ─── Event log / notifications ───────────────────────────────────────────────

export interface AppEvent {
  id: string;
  ts: number;
  level: EventLevel;
  code: string; // i18n notification code, e.g. 'order.filled'
  params?: Record<string, string | number>;
  channel: string; // 'engine' | 'strategy' | 'trade' | 'system'
  strategyId?: string;
}

export interface SocketNotification {
  id: string;
  ts: number;
  level: EventLevel;
  code: string;
  params?: Record<string, string | number>;
  channel: string;
  strategyId?: string;
}

// ─── Backtesting ─────────────────────────────────────────────────────────────

export interface BacktestConfig {
  symbol: string;
  marketType: MarketType;
  timeframe: Timeframe;
  start?: number; // ms
  end?: number; // ms
  maxCandles: number;
  initialCapital: number;
  feeBps: number; // per side, e.g. 6 = 0.06%
  slippageBps: number;
  direction: 'both' | 'long' | 'short';
  logic: ConditionLogic;
  conditions: Condition[];
  stopLossPct?: number;
  takeProfitPct?: number;
  allowLeverage: number; // 1 = spot-like
}

export interface BacktestTrade {
  entryTs: number;
  exitTs: number;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;
  pnlPct: number;
  reason: 'signal' | 'stop_loss' | 'take_profit' | 'liquidation' | 'end';
}

export interface BacktestStats {
  netProfit: number;
  totalReturnPct: number;
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpe: number;
  avgWin: number;
  avgLoss: number;
  buyHoldReturnPct: number;
  signalCount: number;
  /** cumulative funding paid (negative = received), futures with leverage */
  fundingPaid?: number;
  liquidations?: number;
  /** out-of-sample (last 30%) stats when the sample is large enough */
  oosReturnPct?: number;
  isReturnPct?: number;
}

export interface BacktestResult {
  stats: BacktestStats;
  equity: { ts: number; value: number }[];
  drawdown: { ts: number; value: number }[];
  trades: BacktestTrade[];
  candlesUsed: number;
}

export interface BacktestRun {
  id: string;
  config: BacktestConfig;
  status: 'pending' | 'running' | 'done' | 'error';
  progress: number; // 0..1
  result?: BacktestResult;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

// ─── LLM ─────────────────────────────────────────────────────────────────────

export type LlmProviderType = 'openai-compatible' | 'anthropic' | 'gemini';

export interface LlmProvider {
  id: string;
  type: LlmProviderType;
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmAdvice {
  bias: 'long' | 'short' | 'neutral';
  confidence: number; // 0-100
  entry: number | null;
  stopLoss: number | null;
  takeProfit: (number | null)[];
  timeHorizon: string;
  summary: string;
  risks: string[];
  indicatorsCited: string[];
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface AccountConfig {
  id: string;
  label: string;
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  demoMode: boolean;
  active: boolean;
  createdAt: number;
}

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
  to: string;
}

export interface NotificationConfig {
  desktop: boolean;
  mail: boolean;
  socket: boolean;
  minLevel: EventLevel;
  telegram: {
    enabled: boolean;
    botToken: string;
    chatId: string;
  };
  webhook: {
    enabled: boolean;
    url: string;
    /** bearer token — sent as `Authorization: Bearer <token>` */
    token: string;
  };
  webpush: {
    enabled: boolean;
    publicKey: string;
    privateKey: string;
    subscriptions: { endpoint: string; keys: { p256dh: string; auth: string } }[];
  };
}

export interface RiskConfig {
  maxOrderUsd: number;
  confirmOrders: boolean;
  /** GLOBAL KILL SWITCH: when set, every order path (manual/strategy/grid/agent) refuses to trade */
  killSwitch: boolean;
  /** daily realized+unrealized loss (USD) that trips the circuit breaker */
  maxDailyLossUsd?: number;
  /** aggregate open notional cap across all strategies/bots per account (USD) */
  maxTotalExposureUsd?: number;
  /** pause the triggering strategy after N consecutive losing closed trades (paper) */
  maxConsecutiveLosses?: number;
  /** max 24h price move (%) beyond which fresh entries are refused */
  maxDailyMovePct?: number;
  /** runtime state: breaker engagement (persisted so a restart doesn't clear it) */
  halted?: { reason: string; ts: number; kind: 'kill_switch' | 'daily_loss' | 'exposure' | 'manual' };
}

export interface EquitySnapshot {
  ts: number;
  equityUsd: number;
  availableUsd: number;
  unrealizedPnl: number;
  paper: boolean;
}

export interface McpConfig {
  enabled: boolean;
  token: string;
}

export interface HistoryConfig {
  enabled: boolean;
  /** server-side tiered market-history capture: symbols always tracked
   *  ("marketType:SYMBOL"), independent of UI activity */
  watchlist: string[];
}

export interface SecurityConfig {
  enabled: boolean;
  username: string;
  passwordHash: string;
  totpSecret: string;
  totpEnabled: boolean;
  pinHash: string;
  pinFailCount: number;
  pinLocked: boolean;
  devices: { id: string; label: string; addedAt: number }[];
}

export interface GeneralConfig {
  locale: 'zh-CN' | 'en';
  upDownColor: 'auto' | 'red-up' | 'green-up';
  defaultSymbol: string;
  defaultMarketType: MarketType;
  defaultTimeframe: Timeframe;
  /** Workspace-level paper trading mode: all orders route to the paper broker */
  paperMode: boolean;
}

export interface AppSettings {
  general: GeneralConfig;
  accounts: AccountConfig[];
  smtp: SmtpConfig;
  notifications: NotificationConfig;
  llm: {
    providers: LlmProvider[];
    activeProviderId?: string;
    chatSystemPrompt: string;
    adviceSystemPrompt: string;
    temperature: number;
  };
  risk: RiskConfig;
  mcp: McpConfig;
  security: SecurityConfig;
  /** server-side market history capture (tiered 1m/1h/1d store) */
  history: HistoryConfig;
  /** first-run guided setup (account → 2FA → PIN → exchange) */
  onboarding: { completed: boolean; completedAt?: number; wizardStarted?: boolean };
  /** LLM agents (event/interval-driven tool-calling assistants) */
  llmAgents?: LlmAgent[];
}

// ─── Paper trading ───────────────────────────────────────────────────────────

export interface PaperState {
  balances: Record<string, number>; // coin -> available (USDT only for simplicity)
  positions: PositionRecord[];
  orders: OrderRecord[];
  trades: OrderRecord[];
  initialCapital: number;
  createdAt: number;
}

// ─── Socket contract (server → client) ───────────────────────────────────────

export interface ServerToClientEvents {
  hello: (payload: { ts: number }) => void;
  notification: (payload: SocketNotification) => void;
  'account:update': (payload: AccountSummary) => void;
  'orders:update': (payload: { marketType: MarketType; orders: OrderRecord[] }) => void;
  'positions:update': (payload: { marketType: MarketType; positions: PositionRecord[] }) => void;
  'engine:status': (payload: EngineStatus) => void;
  'signals:update': (payload: SignalSnapshot) => void;
  // ─── market relay (marketRelay.ts: browsers never touch the exchange) ───
  'market:candle': (payload: { key: string; candles: Candle[] }) => void;
  'market:ticker': (payload: { marketType: MarketType; tickers: Ticker[] }) => void;
  'market:book': (payload: { key: string; book: Book }) => void;
  'market:trade': (payload: { key: string; trades: PublicTrade[] }) => void;
  'levels:update': (payload: NhnlSnapshot) => void;
}

export interface EngineStatus {
  startedAt: number;
  publicWs: 'connected' | 'disconnected' | 'disabled';
  privateWs: 'connected' | 'disconnected' | 'no-account';
  runningStrategies: number;
  totalStrategies: number;
  queueDepth: number;
  lastEventTs?: number;
  paper: boolean;
  accountLabel?: string;
  /** health metrics (institutional observability) */
  wsReconnects?: number;
  rateLimited429?: number;
  exchangeErrors?: number;
  clockOffsetMs?: number;
  staleWindows?: number;
  halted?: { reason: string; ts: number; kind: string } | null;
  leader?: boolean;
}

// ─── Multi-TF new-high/new-low ladder (levelsService → UI / strategies) ──────

/** One timeframe's row of the NHNL ladder. All booleans are evaluated at
 *  `price` against the still-forming bar, the previous closed bar and the
 *  Donchian channel of the N closed bars before it. */
export interface NhnlRow {
  tf: Timeframe;
  /** open time (unix seconds) of the current forming bar */
  barTime: number;
  /** current bar's running extremes (include the latest price) */
  barHigh: number;
  barLow: number;
  /** price is AT a new high / new low of the current forming bar */
  nh: boolean;
  nl: boolean;
  /** previous CLOSED bar extremes (null when history is too short) */
  prevHigh: number | null;
  prevLow: number | null;
  /** price broke the previous bar's high / low */
  brkUp: boolean;
  brkDown: boolean;
  /** Donchian extremes over the `donN` closed bars before the current one */
  donHigh: number | null;
  donLow: number | null;
  /** price broke the N-bar channel */
  donUp: boolean;
  donDown: boolean;
  /** signed % distance from price to the current bar's high / low */
  distHighPct: number | null;
  distLowPct: number | null;
}

export interface NhnlSnapshot {
  marketType: MarketType;
  symbol: string;
  price: number;
  donN: number;
  rows: NhnlRow[];
  at: number;
}

// ─── Multi-timeframe prediction signals (signalEngine → UI) ──────────────────

export type TrendRegime = 'strong_up' | 'up' | 'neutral' | 'down' | 'strong_down';

export interface PatternState {
  key: string;
  /** 1 bullish, -1 bearish, 0 direction-neutral (e.g. volatility squeeze) */
  dir: 1 | -1 | 0;
  /** historical hit rate of this pattern (Laplace-smoothed), null when n too small */
  prob: number | null;
  samples: number;
}

export interface TFSignal {
  tf: Timeframe;
  regime: TrendRegime;
  /** composite weighted score, -1..1 */
  score: number;
  adx: number | null;
  rsi: number | null;
  /** regime continuation probability (walk-forward), null when n too small */
  prob: number | null;
  probSamples: number;
  patterns: PatternState[];
  /** one-line guidance in the server locale and in English */
  line: string;
  lineEn: string;
  price: number;
  /** last CLOSED bar used for this call (unix seconds) */
  barTime: number;
  /** live directional accuracy of the engine's committed calls (rolling) */
  accuracy: number | null;
}

export interface SignalSnapshot {
  symbol: string;
  marketType: MarketType;
  /** compact all-TF glance, e.g. "2m↑ 5m→ 30m↑ 2h↓ 1d↑" */
  summary: string;
  summaryEn: string;
  signals: TFSignal[];
  at: number;
  /** adaptive-weight optimizer state (walk-forward weight learning) */
  optimizer?: OptimizerSummary;
  /** multi-TF new-high/new-low ladder — null until the windows are live */
  nhnl?: { price: number; donN: number; rows: NhnlRow[] } | null;
}

// ─── Signal optimizer (adaptive weights, persisted) ──────────────────────────

export interface OptimizerComponentStat {
  name: string;
  wins: number;
  n: number;
  hitRate: number | null;
}

export interface OptimizerRunSummary {
  ts: number;
  trigger: 'startup' | 'scheduled' | 'manual';
  perTf: {
    tf: Timeframe;
    bars: number;
    decisive: number;
    selfAccBefore: number | null;
    selfAccAfter: number | null;
    uniformAcc: number | null;
    updated: boolean;
    reason?: string;
    topDelta?: { name: string; from: number; to: number };
    components?: Record<string, OptimizerComponentStat>;
  }[];
}

export interface OptimizerSummary {
  enabled: boolean;
  intervalMin: number;
  runs: number;
  stateFile: string;
  lastRun: OptimizerRunSummary | null;
  weights: Record<string, Record<string, number>>;
  online: { tf: Timeframe; calls: number; wins: number; accuracy: number | null; horizonMin: number }[];
  /** per-tf weight-version history (last 20) — every historical parameter
   *  model keeps its own live win/loss record for future learning */
  versions: Record<string, { id: number; ts: number; trigger: string; wins: number; n: number; accuracy: number | null }[]>;
}
