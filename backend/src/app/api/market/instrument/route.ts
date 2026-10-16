import { NextRequest } from 'next/server';
import { candleService } from '@/server/engine/candleService';
import { ok, errorResponse } from '@/server/api/helpers';
import type { MarketType } from '@/core/types';

export const dynamic = 'force-dynamic';

/** Instrument precision & min trade info for the order form. */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const marketType = (sp.get('marketType') ?? 'futures') as MarketType;
    const symbol = (sp.get('symbol') ?? 'BTCUSDT').toUpperCase();
    const instrument = await candleService.instrument(marketType, symbol);
    return ok({ instrument: instrument ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}
