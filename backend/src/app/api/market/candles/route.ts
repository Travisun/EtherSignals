import { NextRequest } from 'next/server';
import { candleService } from '@/server/engine/candleService';
import { marketHistory } from '@/server/engine/marketHistory';
import { ok, errorResponse } from '@/server/api/helpers';
import type { MarketType, Timeframe } from '@/core/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const marketType = (sp.get('marketType') ?? 'futures') as MarketType;
    const symbol = (sp.get('symbol') ?? 'BTCUSDT').toUpperCase();
    const tf = (sp.get('tf') ?? '15m') as Timeframe;
    const limit = Math.min(parseInt(sp.get('limit') ?? '300', 10) || 300, 1000);
    // server-side tiered store first: browsers never hit the exchange REST
    // quota, and deep windows come back instantly. A short store answer is
    // topped up in the background (serve() queues the backfill).
    const stored = marketHistory.serve(marketType, symbol, tf, limit);
    if (stored && stored.candles.length >= Math.min(limit, 60)) {
      void marketHistory.track(marketType, symbol).catch(() => undefined);
      return ok({ candles: stored.candles, ticker: candleService.ticker(marketType, symbol) ?? null });
    }
    // store miss (never tracked / not enough depth yet): exchange snapshot,
    // and start capturing the symbol so the next request is served locally
    const candles = await candleService.snapshot(marketType, symbol, tf, limit);
    void marketHistory.track(marketType, symbol).catch(() => undefined);
    return ok({ candles, ticker: candleService.ticker(marketType, symbol) ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}
