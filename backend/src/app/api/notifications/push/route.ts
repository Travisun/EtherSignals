import { NextRequest, NextResponse } from 'next/server';
import { settingsRepo } from '@/server/store/repos';
import { guard } from '@/server/security/guard';

export const dynamic = 'force-dynamic';

/** Web Push (PWA) subscription endpoint. GET → VAPID public key. */
export async function GET() {
  const { webpush } = settingsRepo.get().notifications;
  return NextResponse.json({ ok: true, data: { publicKey: webpush.publicKey || null, enabled: webpush.enabled } });
}

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    const sub = await req.json();
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return NextResponse.json({ ok: false, error: 'invalid subscription' }, { status: 400 });
    }
    const cfg = settingsRepo.get().notifications.webpush;
    const subscriptions = [
      ...cfg.subscriptions.filter((s) => s.endpoint !== sub.endpoint),
      { endpoint: String(sub.endpoint), keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } },
    ];
    settingsRepo.update({ notifications: { ...settingsRepo.get().notifications, webpush: { ...cfg, subscriptions } } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
