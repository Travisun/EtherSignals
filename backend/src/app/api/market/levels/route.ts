import { NextRequest } from 'next/server';
import { levelsService } from '@/server/engine/levelsService';
import { ok, withEngine, errorResponse } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';
import { DEFAULT_DON_N } from '@/core/nhnl';
import type { MarketType } from '@/core/types';

export const dynamic = 'force-dynamic';

/**
 * Multi-timeframe new-high/new-low ladder (1m→1M, forming-bar NH/NL +
 * previous-bar break + Donchian-N). Live updates arrive via `levels:update`
 * socket pushes after `levels:sub`; this route is the initial fill.
 */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  return withEngine(async () => {
    try {
      const sp = req.nextUrl.searchParams;
      const marketType = (sp.get('marketType') ?? 'futures') as MarketType;
      const symbol = (sp.get('symbol') ?? 'BTCUSDT').toUpperCase();
      const donN = Math.min(Math.max(parseInt(sp.get('donN') ?? String(DEFAULT_DON_N), 10) || DEFAULT_DON_N, 1), 200);
      const snapshot = await levelsService.snapshot(marketType, symbol, donN);
      return ok({ levels: snapshot });
    } catch (e) {
      return errorResponse(e);
    }
  });
}
