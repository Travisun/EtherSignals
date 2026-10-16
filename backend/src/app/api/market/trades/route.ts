import { NextRequest } from 'next/server';
import { BitgetRest } from '@/server/bitget/rest';
import { ok, errorResponse } from '@/server/api/helpers';
import type { MarketType } from '@/core/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const marketType = (sp.get('marketType') ?? 'futures') as MarketType;
    const symbol = (sp.get('symbol') ?? 'BTCUSDT').toUpperCase();
    const rest = new BitgetRest();
    const rows = await rest.publicTrades(marketType, symbol, 50);
    // v2 REST fills rows: [tradeId, price, size, side, ts]
    const trades = rows
      .map((r) => {
        const price = parseFloat(r[1]);
        const ts = Number(r[4]);
        return {
          ts: Number.isFinite(ts) && ts > 1e12 ? ts : Date.now(),
          price,
          size: parseFloat(r[2]) || 0,
          side: (r[3] as 'buy' | 'sell') ?? 'buy',
        };
      })
      .filter((t) => Number.isFinite(t.price));
    return ok({ trades });
  } catch (e) {
    return errorResponse(e);
  }
}
