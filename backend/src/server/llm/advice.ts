import { complete, DEFAULT_ADVICE_PROMPT, hasProvider } from './providers';
import { settingsRepo } from '@/server/store/repos';
import { candleService } from '@/server/engine/candleService';
import { getPositions } from '@/server/engine/accountService';
import { computeIndicators, type IndicatorSeries } from '@/core/indicators';
import type { Candle, LlmAdvice, MarketType, Timeframe } from '@/core/types';
export interface MarketContext {
  symbol: string;
  marketType: MarketType;
  timeframe: Timeframe;
  price: number;
  candles: Candle[];
  indicators?: IndicatorSeries;
  positions?: { symbol: string; side: string; size: number; unrealizedPL: number }[];
}

/** Build a compact market context for prompts (and the UI context panel). */
export async function buildMarketContext(
  symbol: string,
  marketType: MarketType,
  timeframe: Timeframe,
): Promise<MarketContext> {
  // snapshot(): no WS subscription leak — live windows are the rule
  // engine's business
  const candles = candleService.snapshot(marketType, symbol, timeframe, 200)
    .catch(() => [] as Candle[]);
  const [candleArr] = await Promise.all([candles]);
  const price = candleService.lastPrice(marketType, symbol) || candleArr.at(-1)?.close || 0;
  const indicators = candleArr.length >= 40 ? computeIndicators(candleArr, { rsi: true, macd: true, boll: true, maPeriods: [5, 20, 60], atr: true }) : undefined;
  const positions = (await getPositions().catch(() => []))
    .filter((p) => p.symbol === symbol)
    .map((p) => ({ symbol: p.symbol, side: p.side, size: p.size, unrealizedPL: p.unrealizedPL }));
  return { symbol, marketType, timeframe, price, candles: candleArr, indicators, positions };
}

function last<T>(arr: (T | null)[] | undefined): T | null {
  const v = arr?.at(-1);
  return v == null ? null : v;
}

export function contextToPrompt(ctx: MarketContext): string {
  const lines: string[] = [];
  lines.push(`Symbol: ${ctx.symbol} (${ctx.marketType})`);
  lines.push(`Timeframe: ${ctx.timeframe}`);
  lines.push(`Current price: ${ctx.price}`);
  if (ctx.candles.length >= 10) {
    const recent = ctx.candles.slice(-10);
    lines.push(`Last 10 candles (time, o, h, l, c, vol):`);
    for (const c of recent) {
      lines.push(`  ${new Date(c.time * 1000).toISOString()} ${c.open} ${c.high} ${c.low} ${c.close} ${c.baseVol ?? ''}`);
    }
  }
  const ind = ctx.indicators;
  if (ind) {
    const rsiV = last(ind.rsi);
    const macdV = ind.macd ? last(ind.macd.macd) : null;
    const macdSig = ind.macd ? last(ind.macd.signal) : null;
    const bollU = ind.boll ? last(ind.boll.upper) : null;
    const bollL = ind.boll ? last(ind.boll.lower) : null;
    const ma5 = ind.ma?.[0] ? last(ind.ma[0]) : null;
    const ma20 = ind.ma?.[1] ? last(ind.ma[1]) : null;
    const ma60 = ind.ma?.[2] ? last(ind.ma[2]) : null;
    const atrV = ind.atr ? last(ind.atr) : null;
    lines.push('Indicators (latest):');
    lines.push(`  RSI(14): ${fmt(rsiV)}  MACD: ${fmt(macdV)} signal: ${fmt(macdSig)}`);
    lines.push(`  MA5: ${fmt(ma5)}  MA20: ${fmt(ma20)}  MA60: ${fmt(ma60)}`);
    lines.push(`  BOLL upper: ${fmt(bollU)} lower: ${fmt(bollL)}  ATR(14): ${fmt(atrV)}`);
    const closes = ctx.candles.slice(-24).map((c) => c.close);
    if (closes.length >= 24) {
      const change = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
      lines.push(`  24-bar change: ${change.toFixed(2)}%`);
    }
  }
  if (ctx.positions?.length) {
    lines.push('Open positions for this symbol:');
    for (const p of ctx.positions) lines.push(`  ${p.side} size=${p.size} uPnL=${p.unrealizedPL}`);
  } else {
    lines.push('No open position for this symbol.');
  }
  return lines.join('\n');
}

function fmt(v: unknown): string {
  return v == null ? 'n/a' : String(typeof v === 'number' ? Number(v.toFixed(6)) : v);
}

/** Ask the LLM for a structured trade decision; throws on no provider. */
export async function getTradeAdvice(ctx: MarketContext): Promise<LlmAdvice> {
  if (!hasProvider()) throw new Error('NO_PROVIDER');
  const { llm } = settingsRepo.get();
  const system = llm.adviceSystemPrompt?.trim() || DEFAULT_ADVICE_PROMPT;
  const user = `Market context:\n${contextToPrompt(ctx)}\n\nRespond with the JSON decision only.`;
  const raw = await complete(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: llm.temperature ?? 0.4 },
  );
  return parseAdvice(raw);
}

export function parseAdvice(raw: string): LlmAdvice {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  const j = JSON.parse(text) as Partial<LlmAdvice>;
  const bias = j.bias === 'long' || j.bias === 'short' ? j.bias : 'neutral';
  const confidence = Math.min(100, Math.max(0, Number(j.confidence ?? 0)));
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    bias,
    confidence,
    entry: num(j.entry),
    stopLoss: num(j.stopLoss),
    takeProfit: Array.isArray(j.takeProfit) ? j.takeProfit.map(num) : [],
    timeHorizon: String(j.timeHorizon ?? 'hours'),
    summary: String(j.summary ?? ''),
    risks: Array.isArray(j.risks) ? j.risks.map(String) : [],
    indicatorsCited: Array.isArray(j.indicatorsCited) ? j.indicatorsCited.map(String) : [],
  };
}
