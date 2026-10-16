import { candleService } from '@/server/engine/candleService';
import { getAccountSummary, getPositions } from '@/server/engine/accountService';
import { pendingOrders, historyOrders, placeOrder, cancelOrder } from '@/server/services/ordersService';
import { strategiesRepo, settingsRepo, eventsRepo } from '@/server/store/repos';
import { ruleEngine } from '@/server/engine/ruleEngine';
import { getRuntime } from '@/server/engine/runtime';
import { complete } from '@/server/llm/providers';
import { runBacktest } from '@/server/backtest/runner';
import { evaluateConditions, requiredWindows } from '@/server/engine/evaluator';
import { queryAudit } from '@/server/store/pg';
import { computeIndicators } from '@/core/indicators';
import { uid } from '@/lib/utils';
import type { BacktestConfig, Condition, ConditionLogic, MarketType, Strategy, Timeframe } from '@/core/types';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const mt = {
  type: 'string', enum: ['spot', 'futures'], description: 'Market type: spot or futures (usdt-futures)',
};
const num = (description: string) => ({ type: 'number', description });
const str = (description: string) => ({ type: 'string', description });

const condSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['price_above', 'price_below', 'price_cross_up', 'price_cross_down', 'price_change_pct', 'rsi_above', 'rsi_below', 'macd_golden', 'macd_death', 'ma_cross_up', 'ma_cross_down', 'volume_spike', 'boll_break_up', 'boll_break_down', 'llm_bias'] },
    params: { type: 'object', description: 'condition params, e.g. {value: 65000} or {period: 14, value: 30}' },
    tf: { type: 'string', enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'], description: 'optional: apply this condition on another timeframe (multi-TF factor)' },
    symbol: { type: 'string', description: 'optional: apply on another symbol, e.g. BTCUSDT (cross-symbol factor)' },
    marketType: { type: 'string', enum: ['spot', 'futures'], description: 'optional market of the referenced symbol' },
  },
  required: ['type'],
};

function makeStrategyFromArgs(a: Record<string, unknown>): Strategy {
  const now = Date.now();
  return {
    id: uid('st_'),
    name: String(a.name ?? 'MCP Strategy'),
    symbol: String(a.symbol ?? 'BTCUSDT').toUpperCase(),
    marketType: (a.marketType as MarketType) ?? 'futures',
    timeframe: (a.timeframe as Timeframe) ?? '15m',
    status: 'stopped',
    paper: a.paper !== false,
    accountIds: Array.isArray(a.accountIds) ? a.accountIds.map(String) : [],
    logic: (a.logic as ConditionLogic) ?? 'all',
    conditions: (a.conditions as Condition[]) ?? [],
    actions: (a.actions as Strategy['actions']) ?? [{ type: 'notify' }],
    cooldownSec: Number(a.cooldownSec ?? 300),
    repeat: a.repeat !== false,
    note: a.note ? String(a.note) : undefined,
    stats: { triggerCount: 0, createdAt: now, updatedAt: now },
  };
}

/** Tool registry exposed over the MCP protocol (all local features). */
export function mcpTools(): McpTool[] {
  return [
    {
      name: 'get_ticker',
      description: 'Get the latest 24h ticker for one symbol',
      inputSchema: { type: 'object', properties: { symbol: str('e.g. BTCUSDT'), marketType: mt }, required: ['symbol', 'marketType'] },
      handler: async (a) => {
        await candleService.refreshTickers();
        return candleService.ticker(a.marketType as MarketType, String(a.symbol).toUpperCase()) ?? {};
      },
    },
    {
      name: 'list_tickers',
      description: 'List tickers for spot or USDT-futures markets, sorted by quote volume',
      inputSchema: { type: 'object', properties: { marketType: mt, limit: num('max rows (default 30)') }, required: ['marketType'] },
      handler: async (a) => {
        await candleService.refreshTickers();
        return candleService
          .allTickers(a.marketType as MarketType)
          .sort((x, y) => y.quoteVolume - x.quoteVolume)
          .slice(0, Number(a.limit ?? 30));
      },
    },
    {
      name: 'get_candles',
      description: 'Get recent candles for a symbol',
      inputSchema: { type: 'object', properties: { symbol: str(''), marketType: mt, timeframe: { type: 'string', enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] }, limit: num('default 100') }, required: ['symbol', 'marketType', 'timeframe'] },
      handler: async (a) => {
        const candles = await candleService.snapshot(
          a.marketType as MarketType, String(a.symbol).toUpperCase(), a.timeframe as Timeframe, Math.min(Number(a.limit ?? 100), 1000),
        );
        return candles.slice(-Number(a.limit ?? 100));
      },
    },
    {
      name: 'get_market_context',
      description: 'Get a technical-analysis snapshot (RSI/MACD/MA/BOLL/ATR + recent candles) for a symbol',
      inputSchema: { type: 'object', properties: { symbol: str(''), marketType: mt, timeframe: { type: 'string', enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] } }, required: ['symbol', 'marketType', 'timeframe'] },
      handler: async (a) => {
        const symbol = String(a.symbol).toUpperCase();
        const mk = a.marketType as MarketType;
        const tf = a.timeframe as Timeframe;
        const candles = await candleService.snapshot(mk, symbol, tf, 200);
        const ind = computeIndicators(candles, { rsi: true, macd: true, boll: true, maPeriods: [5, 20, 60], atr: true });
        const last = <T,>(arr?: (T | null)[]) => arr?.at(-1) ?? null;
        return {
          symbol, marketType: mk, timeframe: tf,
          price: candleService.lastPrice(mk, symbol),
          rsi14: last(ind.rsi),
          macd: ind.macd ? last(ind.macd.macd) : null,
          macdSignal: ind.macd ? last(ind.macd.signal) : null,
          ma5: last(ind.ma?.[0]), ma20: last(ind.ma?.[1]), ma60: last(ind.ma?.[2]),
          bollUpper: ind.boll ? last(ind.boll.upper) : null,
          bollLower: ind.boll ? last(ind.boll.lower) : null,
          atr14: last(ind.atr),
        };
      },
    },
    {
      name: 'get_accounts',
      description: 'List configured exchange accounts (id, label, active) — use the id as accountId on order tools',
      inputSchema: { type: 'object', properties: {} },
      handler: async () =>
        settingsRepo.get().accounts.map((a) => ({
          id: a.id, label: a.label, active: a.active, demo: a.demoMode,
        })),
    },
    {
      name: 'get_balance',
      description: 'Get account equity summary (spot + futures, or paper account in paper mode)',
      inputSchema: { type: 'object', properties: { accountId: str('optional — defaults to the active account') } },
      handler: async (a) => getAccountSummary(a.accountId ? String(a.accountId) : undefined),
    },
    {
      name: 'get_positions',
      description: 'Get open positions',
      inputSchema: { type: 'object', properties: { accountId: str('optional') } },
      handler: async (a) => getPositions(a.accountId ? String(a.accountId) : undefined),
    },
    {
      name: 'get_open_orders',
      description: 'Get currently open orders',
      inputSchema: { type: 'object', properties: { marketType: mt, symbol: str('optional filter'), accountId: str('optional') } },
      handler: async (a) =>
        pendingOrders((a.marketType as MarketType) ?? 'futures', {
          symbol: a.symbol ? String(a.symbol).toUpperCase() : undefined,
          accountId: a.accountId ? String(a.accountId) : undefined,
        }),
    },
    {
      name: 'get_order_history',
      description: 'Get historical orders',
      inputSchema: { type: 'object', properties: { marketType: mt, symbol: str('optional'), limit: num('default 50'), accountId: str('optional') } },
      handler: async (a) =>
        historyOrders((a.marketType as MarketType) ?? 'futures', {
          symbol: a.symbol ? String(a.symbol).toUpperCase() : undefined,
          limit: Number(a.limit ?? 50),
          accountId: a.accountId ? String(a.accountId) : undefined,
        }),
    },
    {
      name: 'place_order',
      description: 'Place an order. For live (non-paper) orders you MUST pass confirm=true after user confirmation.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: str('e.g. BTCUSDT'), marketType: mt,
          side: { type: 'string', enum: ['buy', 'sell'] },
          orderType: { type: 'string', enum: ['limit', 'market'] },
          size: num('base quantity'), price: num('required for limit orders'),
          leverage: num('futures leverage'), tradeSide: { type: 'string', enum: ['open', 'close'] },
          stopLossPct: num('optional futures preset stop-loss, percent of entry price'),
          takeProfitPct: num('optional futures preset take-profit, percent of entry price'),
          paper: { type: 'boolean', description: 'route to paper account (default: workspace paper mode)' },
          accountId: str('optional — execute on a specific configured account'),
          confirm: { type: 'boolean', description: 'must be true for live orders' },
        },
        required: ['symbol', 'marketType', 'side', 'orderType', 'size'],
      },
      handler: async (a) => {
        const paper = a.paper !== undefined ? Boolean(a.paper) : undefined;
        if (!paper && a.confirm !== true) {
          return { error: 'refused: live order requires confirm=true' };
        }
        return placeOrder({
          symbol: String(a.symbol).toUpperCase(),
          marketType: a.marketType as MarketType,
          side: a.side as 'buy' | 'sell',
          orderType: (a.orderType as 'limit' | 'market') ?? 'market',
          size: Number(a.size),
          price: a.price != null ? Number(a.price) : undefined,
          leverage: a.leverage != null ? Number(a.leverage) : undefined,
          tradeSide: a.tradeSide as 'open' | 'close' | undefined,
          stopLossPct: a.stopLossPct != null ? Number(a.stopLossPct) : undefined,
          takeProfitPct: a.takeProfitPct != null ? Number(a.takeProfitPct) : undefined,
          paper,
          accountId: a.accountId ? String(a.accountId) : undefined,
        });
      },
    },
    {
      name: 'cancel_order',
      description: 'Cancel an open order',
      inputSchema: { type: 'object', properties: { orderId: str(''), symbol: str(''), marketType: mt, accountId: str('optional') }, required: ['orderId', 'symbol', 'marketType'] },
      handler: async (a) =>
        cancelOrder(String(a.orderId), String(a.symbol).toUpperCase(), a.marketType as MarketType, a.accountId ? String(a.accountId) : undefined),
    },
    {
      name: 'evaluate_conditions',
      description: 'Evaluate a condition set right now against live windows (supports multi-TF / cross-symbol conditions) without creating a strategy',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: str('base symbol'), marketType: mt, timeframe: { type: 'string', enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] },
          logic: { type: 'string', enum: ['all', 'any'] },
          conditions: { type: 'array', items: condSchema },
        },
        required: ['symbol', 'marketType', 'timeframe', 'conditions'],
      },
      handler: async (a) => {
        const symbol = String(a.symbol).toUpperCase();
        const mk = a.marketType as MarketType;
        const tf = a.timeframe as Timeframe;
        const conditions = a.conditions as Condition[];
        const base = await candleService.snapshot(mk, symbol, tf, 200);
        if (base.length < 25) return { error: `not enough candles for ${symbol}` };
        const getWindow = (sel: { tf?: Timeframe; symbol?: string; marketType?: MarketType }) => {
          const arr = candleService.peek(sel.marketType ?? mk, (sel.symbol ?? symbol).toUpperCase(), sel.tf ?? tf);
          return arr.length >= 2 ? arr : undefined;
        };
        const result = evaluateConditions(conditions, (a.logic as ConditionLogic) ?? 'all', {
          candles: base,
          price: candleService.lastPrice(mk, symbol) || base.at(-1)!.close,
          getWindow,
        });
        void requiredWindows;
        return { matched: result.matched, matchedConditions: result.matchedDetails, price: candleService.lastPrice(mk, symbol) };
      },
    },
    {
      name: 'get_audit_logs',
      description: 'Query the PostgreSQL audit trail (categories: manual, strategy, system, mcp, llm, backtest)',
      inputSchema: { type: 'object', properties: { category: { type: 'string', enum: ['manual', 'strategy', 'system', 'mcp', 'llm', 'backtest'] }, symbol: str('optional filter'), limit: num('default 50') } },
      handler: async (a) =>
        queryAudit({
          category: a.category ? String(a.category) : undefined,
          symbol: a.symbol ? String(a.symbol) : undefined,
          limit: Number(a.limit ?? 50),
        }),
    },
    {
      name: 'list_strategies',
      description: 'List strategy hooks (trading rules) with status and trigger stats',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => strategiesRepo.list(),
    },
    {
      name: 'create_strategy',
      description: 'Create a strategy hook from conditions/actions. Actions default to a notification.',
      inputSchema: {
        type: 'object',
        properties: {
          name: str(''), symbol: str(''), marketType: mt,
          timeframe: { type: 'string', enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] },
          logic: { type: 'string', enum: ['all', 'any'] },
          conditions: { type: 'array', items: condSchema },
          actions: { type: 'array', description: 'e.g. [{type:"order", side:"buy", orderType:"market", size:0.01, tradeSide:"open"}] or [{type:"notify"}]' },
          cooldownSec: num('default 300'), repeat: { type: 'boolean' }, paper: { type: 'boolean' },
          accountIds: { type: 'array', items: { type: 'string' }, description: 'bind live accounts (see get_accounts); empty = active account' },
        },
        required: ['name', 'symbol', 'conditions'],
      },
      handler: async (a) => {
        const s = makeStrategyFromArgs(a);
        strategiesRepo.save(s);
        return s;
      },
    },
    {
      name: 'toggle_strategy',
      description: 'Start or stop a strategy hook',
      inputSchema: { type: 'object', properties: { id: str(''), action: { type: 'string', enum: ['start', 'stop'] } }, required: ['id', 'action'] },
      handler: async (a) => {
        const s = strategiesRepo.get(String(a.id));
        if (!s) return { error: 'strategy not found' };
        strategiesRepo.update(s.id, { status: a.action === 'start' ? 'running' : 'stopped' });
        if (a.action === 'start') await ruleEngine.startStrategy({ ...s, status: 'running' });
        else ruleEngine.stopStrategy(s.id);
        return { ok: true, id: s.id, status: a.action };
      },
    },
    {
      name: 'run_backtest',
      description: 'Queue a backtest run for a set of conditions; returns runId, poll get_backtest for results',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: str(''), marketType: mt,
          timeframe: { type: 'string', enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] },
          logic: { type: 'string', enum: ['all', 'any'] },
          conditions: { type: 'array', items: condSchema },
          initialCapital: num('default 10000'), feeBps: num('default 6'), slippageBps: num('default 2'),
          direction: { type: 'string', enum: ['both', 'long', 'short'] },
          stopLossPct: num(''), takeProfitPct: num(''), maxCandles: num('default 5000'),
        },
        required: ['symbol', 'marketType', 'timeframe', 'conditions'],
      },
      handler: async (a) => {
        const config: BacktestConfig = {
          symbol: String(a.symbol).toUpperCase(),
          marketType: a.marketType as MarketType,
          timeframe: a.timeframe as Timeframe,
          maxCandles: Number(a.maxCandles ?? 5000),
          initialCapital: Number(a.initialCapital ?? 10_000),
          feeBps: Number(a.feeBps ?? 6),
          slippageBps: Number(a.slippageBps ?? 2),
          direction: (a.direction as 'both' | 'long' | 'short') ?? 'both',
          logic: (a.logic as ConditionLogic) ?? 'all',
          conditions: a.conditions as Condition[],
          stopLossPct: a.stopLossPct != null ? Number(a.stopLossPct) : undefined,
          takeProfitPct: a.takeProfitPct != null ? Number(a.takeProfitPct) : undefined,
          allowLeverage: 1,
        };
        const run = {
          id: uid('bt_'), config, status: 'pending' as const, progress: 0, createdAt: Date.now(),
        };
        getRuntime().queueBacktest(run);
        return { runId: run.id, status: 'queued' };
      },
    },
    {
      name: 'ask_llm',
      description: 'Ask the configured LLM provider a question (trading assistant persona)',
      inputSchema: { type: 'object', properties: { question: str('') }, required: ['question'] },
      handler: async (a) => {
        const answer = await complete([{ role: 'user', content: String(a.question) }]);
        return { answer };
      },
    },
    {
      name: 'get_signals',
      description: 'Get recent engine event log (signals, orders, notifications)',
      inputSchema: { type: 'object', properties: { limit: num('default 30') } },
      handler: async (a) => eventsRepo.list().slice(0, Number(a.limit ?? 30)),
    },
  ];
}
