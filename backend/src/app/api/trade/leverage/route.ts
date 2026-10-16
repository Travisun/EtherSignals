import { NextRequest } from 'next/server';
import { BitgetRest } from '@/server/bitget/rest';
import { settingsRepo } from '@/server/store/repos';
import { ok, fail, errorResponse, withEngine } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';
import { logAudit } from '@/server/store/pg';

export const dynamic = 'force-dynamic';

/** Set futures leverage for a symbol on the active account (PIN protected). */
export async function POST(req: NextRequest) {
  const denied = await guard(req, { pin: true });
  if (denied) return denied;
  return withEngine(async () => {
    try {
      const body = await req.json();
      const symbol = String(body.symbol ?? '').toUpperCase();
      const leverage = Number(body.leverage);
      if (!/^[A-Z0-9]{4,20}$/.test(symbol)) return fail('invalid symbol', 400);
      if (!Number.isInteger(leverage) || leverage < 1 || leverage > 125) {
        return fail('leverage must be an integer between 1 and 125', 400);
      }
      const account = settingsRepo.get().accounts.find((a) => a.active);
      if (!account) return fail('no active exchange account', 400);
      const rest = new BitgetRest(account);
      await rest.setLeverage(symbol, String(leverage));
      logAudit({ category: 'manual', action: 'leverage.set', symbol, payload: { leverage, accountId: account.id, demo: account.demoMode } });
      return ok({ ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  });
}
