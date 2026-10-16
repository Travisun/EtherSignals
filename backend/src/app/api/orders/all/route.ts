import { NextRequest } from 'next/server';
import { pendingOrders, historyOrders, fillHistory } from '@/server/services/ordersService';
import { ok, errorResponse, withEngine } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';
import type { MarketType } from '@/core/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  {
    const denied = await guard(req);
    if (denied) return denied;
  }
  return withEngine(async () => {
    try {
      const sp = req.nextUrl.searchParams;
      const marketType = (sp.get('marketType') ?? 'futures') as MarketType;
      const symbol = sp.get('symbol') ? sp.get('symbol')!.toUpperCase() : undefined;
      const accountId = sp.get('accountId') ?? undefined;
      const limit = Math.min(parseInt(sp.get('limit') ?? '100', 10) || 100, 200);
      const [pending, history, fills] = await Promise.all([
        pendingOrders(marketType, { symbol, accountId }).catch(() => []),
        historyOrders(marketType, { symbol, limit, accountId }).catch(() => []),
        fillHistory(marketType, { symbol, limit, accountId }).catch(() => []),
      ]);
      return ok({ pending, history, fills });
    } catch (e) {
      return errorResponse(e);
    }
  });
}
