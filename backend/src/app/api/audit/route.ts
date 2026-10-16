import { NextRequest } from 'next/server';
import { queryAudit } from '@/server/store/pg';
import { ok } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';

export const dynamic = 'force-dynamic';

/**
 * Detailed operation / trade audit trail (PostgreSQL-backed).
 * Categories: manual | strategy | system | mcp | llm | backtest
 */
export async function GET(req: NextRequest) {
  {
    const denied = await guard(req);
    if (denied) return denied;
  }
  try {
    const sp = req.nextUrl.searchParams;
    const logs = await queryAudit({
      limit: Math.min(parseInt(sp.get('limit') ?? '200', 10) || 200, 1000),
      category: sp.get('category') ?? undefined,
      symbol: sp.get('symbol') ?? undefined,
    });
    return ok({ logs, pg: logs.length > 0 || Boolean(process.env.DATABASE_URL) });
  } catch {
    return ok({ logs: [], pg: false });
  }
}
