import { NextRequest } from 'next/server';
import { equityRepo } from '@/server/store/repos';
import { ok, errorResponse } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';

export const dynamic = 'force-dynamic';

/** GET /api/account/equity-history?points=200 — downsampled account equity curve. */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    const points = Math.min(Math.max(Number(req.nextUrl.searchParams.get('points') ?? 200), 20), 1000);
    const series = equityRepo.series(points);
    return ok({ series });
  } catch (e) {
    return errorResponse(e);
  }
}
