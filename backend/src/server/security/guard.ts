import { NextRequest, NextResponse } from 'next/server';
import { securityEnabled, sessionFromRequest, verifyPin, security } from './auth';

export interface GuardOptions {
  /** require the transaction PIN for this mutation */
  pin?: boolean;
}

/**
 * Route protection. No-op while security is disabled (local-first first run);
 * once enabled: valid session cookie + matching device fingerprint required,
 * and mutations additionally require the PIN header (x-gt-pin).
 */
export async function guard(req: NextRequest, opts: GuardOptions = {}): Promise<Response | null> {
  if (!securityEnabled()) return null;

  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'auth required', code: 'AUTH_REQUIRED' }, { status: 401 });
  }
  // device binding is enforced: a session created for a device may only be
  // used with the matching fingerprint header (omitting the header is a mismatch)
  if (session.device) {
    const device = req.headers.get('x-gt-device') ?? '';
    if (device !== session.device) {
      return NextResponse.json({ ok: false, error: 'device mismatch', code: 'DEVICE_MISMATCH' }, { status: 401 });
    }
  }

  if (opts.pin) {
    const sec = security();
    if (sec.pinHash) {
      const pin = req.headers.get('x-gt-pin') ?? '';
      if (!pin) {
        return NextResponse.json({ ok: false, error: 'pin required', code: 'PIN_REQUIRED' }, { status: 428 });
      }
      const result = verifyPin(pin);
      if (result === 'locked') {
        return NextResponse.json({ ok: false, error: 'pin locked — unlock with 2FA', code: 'PIN_LOCKED' }, { status: 428 });
      }
      if (result === 'invalid') {
        const { pinFailCount } = security();
        return NextResponse.json(
          { ok: false, error: 'invalid pin', code: 'PIN_INVALID', remaining: Math.max(0, 3 - pinFailCount) },
          { status: 428 },
        );
      }
    }
  }
  return null;
}

/** request origin proto (for secure-cookie decisions behind a TLS proxy) */
export function isSecureRequest(req: NextRequest): boolean {
  return (req.headers.get('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https';
}
