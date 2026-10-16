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
    const book = await rest.book(marketType, symbol);
    const toLevels = (rows: unknown) =>
      (Array.isArray(rows) ? rows : [])
        .slice(0, 15)
        .map((r) => ({ price: parseFloat(String((r as string[])[0])), size: parseFloat(String((r as string[])[1])) }))
        .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size));
    return ok({
      asks: toLevels(book.asks ?? book.a),
      bids: toLevels(book.bids ?? book.b),
      ts: Number(book.ts) || Date.now(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
