import { NextRequest } from 'next/server';
import { eventsRepo } from '@/server/store/repos';
import { ok, errorResponse } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  {
    const denied = await guard(req);
    if (denied) return denied;
  }
  try {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '100', 10) || 100, 500);
    return ok({ events: eventsRepo.list().slice(0, limit) });
  } catch (e) {
    return errorResponse(e);
  }
}
