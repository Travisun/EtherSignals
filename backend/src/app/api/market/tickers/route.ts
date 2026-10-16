import { NextRequest } from 'next/server';
import { candleService } from '@/server/engine/candleService';
import { ok, fail, errorResponse } from '@/server/api/helpers';
import type { MarketType } from '@/core/types';

export const dynamic = 'force-dynamic';

let lastServe = 0;

export async function GET(req: NextRequest) {
  try {
    const marketType = (req.nextUrl.searchParams.get('marketType') ?? 'futures') as MarketType;
    // the candle service already refreshes every 15s — at most one forced
    // refresh per 5s so multiple polling pages can't stampede the exchange
    if (Date.now() - lastServe > 5_000) {
      lastServe = Date.now();
      await candleService.refreshTickers();
    }
    const tickers = candleService
      .allTickers(marketType)
      .sort((a, b) => b.quoteVolume - a.quoteVolume);
    return ok({ tickers, ts: Date.now() });
  } catch (e) {
    return errorResponse(e);
  }
}
