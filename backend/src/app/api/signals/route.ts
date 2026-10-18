import { NextRequest } from 'next/server';
import { signalEngine } from '@/server/engine/signalEngine';
import { ok, withEngine, errorResponse } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';

export const dynamic = 'force-dynamic';

/**
 * Multi-timeframe prediction signals (default ETHUSDT 2m/5m/30m/2h/1d).
 *   GET  /api/signals                      → current snapshot (+ optimizer state)
 *   GET  /api/signals?view=calibration     → walk-forward hit-rate report (tuning aid)
 *   GET  /api/signals?view=config          → engine configuration
 *   POST /api/signals {action:'optimize'}  → run an adaptive-weight pass now
 */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  return withEngine(async () => {
    try {
      const sp = req.nextUrl.searchParams;
      if (sp.get('view') === 'calibration') {
        const limit = Math.min(1000, Math.max(240, Number(sp.get('limit') ?? 600) || 600));
        return ok({ calibration: await signalEngine.calibrate(limit) });
      }
      if (sp.get('view') === 'config') {
        return ok({ config: signalEngine.config });
      }
      if (sp.get('view') === 'history') {
        const limit = Math.min(Math.max(Number(sp.get('limit') ?? 120) || 120, 1), 300);
        const { signalPushRepo } = await import('@/server/store/repos');
        return ok({ pushes: signalPushRepo.list().slice(0, limit) });
      }
      return ok({ signals: signalEngine.snapshot() });
    } catch (e) {
      return errorResponse(e);
    }
  });
}

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  return withEngine(async () => {
    try {
      const body = await req.json().catch(() => ({}) as Record<string, unknown>);
      if (body.action === 'optimize') {
        const run = await signalEngine.optimizeNow();
        return ok({ run });
      }
      return errorResponse(new Error(`unknown action: ${String(body.action ?? '')}`));
    } catch (e) {
      return errorResponse(e);
    }
  });
}
