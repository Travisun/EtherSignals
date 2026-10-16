import { NextRequest } from 'next/server';
import { candleService } from '@/server/engine/candleService';
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
    const candles = await candleService.snapshot(marketType, symbol, tf, limit);
    const ticker = candleService.ticker(marketType, symbol) ?? null;
    return ok({ candles, ticker });
  } catch (e) {
    return errorResponse(e);
  }
}
