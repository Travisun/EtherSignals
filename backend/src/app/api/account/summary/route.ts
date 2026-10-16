import { NextRequest } from 'next/server';
import { getAccountSummary, getPositions } from '@/server/engine/accountService';
import { ok, errorResponse, withEngine } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  {
    const denied = await guard(req);
    if (denied) return denied;
  }
  return withEngine(async () => {
    const [summary, positions] = await Promise.all([getAccountSummary(), getPositions()]);
    return ok({ summary, positions });
  });
}
