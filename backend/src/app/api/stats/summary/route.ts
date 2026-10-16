import { NextRequest } from 'next/server';
import { paperRepo, strategiesRepo, botsRepo } from '@/server/store/repos';
import { ok, errorResponse } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stats/summary — cross-module performance rollup for the dashboard:
 * today's realized PnL, win/loss stats, per-strategy and per-bot attribution.
 */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayStartTs = dayStart.getTime();

    const paper = paperRepo.get();
    const closed = paper.trades.filter((t) => t.tradeSide === 'close' && t.pnl != null);
    const todayClosed = closed.filter((t) => t.ts >= dayStartTs);
    const sumPnl = (arr: typeof closed) => arr.reduce((s, t) => s + (t.pnl ?? 0), 0);

    const strategies = strategiesRepo.list().map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      paper: s.paper,
      triggerCount: s.stats.triggerCount,
      winCount: s.stats.winCount ?? 0,
      lossCount: s.stats.lossCount ?? 0,
      realizedPnl: s.stats.realizedPnl ?? 0,
      lastTriggerTs: s.stats.lastTriggerTs,
    }));

    const bots = botsRepo.list().map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      paper: b.paper,
      realizedPnl: b.stats.realizedPnl,
      buyFills: b.stats.buyFills,
      sellFills: b.stats.sellFills,
    }));

    const totalTrades = closed.length;
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
    return ok({
      today: {
        realizedPnl: sumPnl(todayClosed),
        trades: todayClosed.length,
        wins: todayClosed.filter((t) => (t.pnl ?? 0) > 0).length,
      },
      paper: {
        realizedPnl: sumPnl(closed),
        trades: totalTrades,
        winRate: totalTrades ? (wins / totalTrades) * 100 : 0,
        openPositions: paper.positions.length,
      },
      strategies,
      bots,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
