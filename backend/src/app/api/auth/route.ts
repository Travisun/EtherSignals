import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/server/store/pg';
import { settingsRepo } from '@/server/store/repos';
import {
  clientIpFrom, createSession, generateTotpSecret, hashSecret, loginAllowed,
  logSecurity, pinStatus, revokeAllSessions, revokeSession, security,
  sessionFromRequest, totpUri, unlockWithTotp, updateSecurity, verifyPin,
  verifySecret, verifyTotp,
} from '@/server/security/auth';
import { isSecureRequest } from '@/server/security/guard';
import { uid } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const COOKIE = 'gt_session';

/** session state for the login gate */
export async function GET(req: NextRequest) {
  const sec = security();
  const session = sessionFromRequest(req);
  const authed = Boolean(session);
  const settings = settingsRepo.get();
  // first-run guided setup: either the WIZARD itself already started (resume
  // mid-wizard), or the workspace is brand-new (no owner credential, no
  // exchange account). Security enabled manually via Settings is a completed
  // initialization by hand — never force the wizard on it.
  const onboardingRequired =
    !settings.onboarding?.completed &&
    (settings.onboarding?.wizardStarted ||
      (!sec.passwordHash && settings.accounts.length === 0 && !sec.enabled));
  if (!authed && sec.enabled && !onboardingRequired) {
    // unauthenticated callers learn only that the gate exists
    return NextResponse.json({ ok: true, data: { enabled: true, authed: false, username: null, onboardingRequired: false } });
  }
  return NextResponse.json({
    ok: true,
    data: {
      enabled: sec.enabled,
      authed,
      username: session?.username ?? null,
      totpEnabled: sec.totpEnabled,
      pinSet: Boolean(sec.pinHash),
      pinLocked: sec.pinLocked,
      pinFails: sec.pinFailCount,
      devices: sec.devices,
      onboardingRequired,
      onboarded: Boolean(settings.onboarding?.completed),
      hasExchangeAccount: settings.accounts.length > 0,
    },
  });
}

/** Every credential-verification branch funnels through here so that password
 *  guessing on side actions (disable/totp/pin/devices) is rate limited exactly
 *  like the main login. */
function credentialAllowed(ip: string): boolean {
  return loginAllowed(ip);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action ?? '');
    const sec = security();
    const ip = clientIpFrom(req);

    switch (action) {
      case 'login': {
        if (!sec.enabled) return NextResponse.json({ ok: true, data: { authed: true } });
        if (!credentialAllowed(ip)) {
          return NextResponse.json({ ok: false, error: 'too many attempts, wait a minute' }, { status: 429 });
        }
        if (body.username !== sec.username || !verifySecret(String(body.password ?? ''), sec.passwordHash)) {
          logSecurity('login.fail', { ip });
          return NextResponse.json({ ok: false, error: 'invalid credentials' }, { status: 401 });
        }
        if (sec.totpEnabled && !verifyTotp(sec.totpSecret, String(body.totpCode ?? ''))) {
          return NextResponse.json({ ok: false, error: 'invalid 2FA code', code: 'TOTP' }, { status: 401 });
        }
        const device = String(body.device ?? '');
        if (sec.devices.length && !sec.devices.some((d) => d.id === device)) {
          return NextResponse.json({ ok: false, error: 'unrecognized device — register it in Settings', code: 'DEVICE' }, { status: 401 });
        }
        const { token } = createSession(sec.username, device);
        logAudit({ category: 'system', action: 'security.login', level: 'success', payload: { device } });
        const res = NextResponse.json({ ok: true, data: { authed: true } });
        res.cookies.set(COOKIE, token, {
          httpOnly: true,
          sameSite: 'strict',
          secure: isSecureRequest(req),
          path: '/',
          maxAge: 12 * 3600,
        });
        return res;
      }

      case 'logout': {
        const token = req.cookies.get(COOKIE)?.value;
        if (token) revokeSession(token);
        const res = NextResponse.json({ ok: true });
        res.cookies.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
        return res;
      }

      case 'logout-all': {
        // only an authenticated session may terminate every session
        if (sec.enabled && !sessionFromRequest(req)) {
          return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });
        }
        revokeAllSessions();
        const res = NextResponse.json({ ok: true });
        res.cookies.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
        return res;
      }

      /** first-time enable / change credentials (requires current password when enabled) */
      case 'configure': {
        const wasEnabled = sec.enabled;
        if (wasEnabled) {
          if (!credentialAllowed(ip)) {
            return NextResponse.json({ ok: false, error: 'too many attempts, wait a minute' }, { status: 429 });
          }
          if (!verifySecret(String(body.currentPassword ?? ''), sec.passwordHash)) {
            logSecurity('password.fail', { ip, action });
            return NextResponse.json({ ok: false, error: 'current password is wrong' }, { status: 403 });
          }
        }
        const username = String(body.username ?? '').trim();
        const password = String(body.password ?? '');
        if (!username || password.length < 8) {
          return NextResponse.json({ ok: false, error: 'username required, password ≥ 8 chars' }, { status: 400 });
        }
        updateSecurity({ enabled: true, username, passwordHash: hashSecret(password) });
        revokeAllSessions();
        const device = String(body.device ?? '');
        if (device && !sec.devices.some((d) => d.id === device)) {
          updateSecurity({ devices: [...security().devices, { id: device, label: String(body.deviceLabel ?? 'This device'), addedAt: Date.now() }] });
        }
        if (body.onboarding === true) {
          // wizard path: mark it started so a mid-wizard refresh resumes the
          // wizard instead of dropping into a half-protected workspace
          settingsRepo.update({ onboarding: { ...settingsRepo.get().onboarding, wizardStarted: true } });
        } else if (!wasEnabled) {
          // manual setup via Settings = initialization done by hand; never
          // hijack this workspace with the guided setup afterwards
          settingsRepo.update({ onboarding: { ...settingsRepo.get().onboarding, completed: true, completedAt: Date.now() } });
        }
        logAudit({ category: 'system', action: 'security.configured', level: 'warning' });
        const res = NextResponse.json({ ok: true });
        if (!wasEnabled) {
          // first-time setup (onboarding): the creator IS the owner — hand
          // them a session immediately so the remaining wizard steps (which
          // now require auth) keep working without a re-login
          const { token } = createSession(username, device);
          res.cookies.set(COOKIE, token, {
            httpOnly: true,
            sameSite: 'strict',
            secure: isSecureRequest(req),
            path: '/',
            maxAge: 12 * 3600,
          });
        }
        return res;
      }

      case 'disable': {
        if (!sec.enabled) return NextResponse.json({ ok: true });
        if (!credentialAllowed(ip)) {
          return NextResponse.json({ ok: false, error: 'too many attempts, wait a minute' }, { status: 429 });
        }
        if (!verifySecret(String(body.password ?? ''), sec.passwordHash)) {
          logSecurity('password.fail', { ip, action });
          return NextResponse.json({ ok: false, error: 'password is wrong' }, { status: 403 });
        }
        updateSecurity({ enabled: false });
        revokeAllSessions();
        logAudit({ category: 'system', action: 'security.disabled', level: 'warning' });
        return NextResponse.json({ ok: true });
      }

      case 'totp.setup': {
        if (sec.enabled) {
          if (!credentialAllowed(ip)) {
            return NextResponse.json({ ok: false, error: 'too many attempts, wait a minute' }, { status: 429 });
          }
          if (!verifySecret(String(body.password ?? ''), sec.passwordHash)) {
            logSecurity('password.fail', { ip, action });
            return NextResponse.json({ ok: false, error: 'password is wrong' }, { status: 403 });
          }
        }
        const secret = generateTotpSecret();
        updateSecurity({ totpSecret: secret, totpEnabled: false });
        return NextResponse.json({ ok: true, data: { secret, uri: totpUri(secret, sec.username) } });
      }

      case 'totp.enable': {
        if (!sec.totpSecret || !verifyTotp(sec.totpSecret, String(body.code ?? ''))) {
          return NextResponse.json({ ok: false, error: 'invalid 2FA code' }, { status: 400 });
        }
        updateSecurity({ totpEnabled: true });
        logAudit({ category: 'system', action: 'security.2fa.enabled', level: 'warning' });
        return NextResponse.json({ ok: true });
      }

      case 'totp.disable': {
        if (!credentialAllowed(ip)) {
          return NextResponse.json({ ok: false, error: 'too many attempts, wait a minute' }, { status: 429 });
        }
        if (!verifySecret(String(body.password ?? ''), sec.passwordHash)) {
          logSecurity('password.fail', { ip, action });
          return NextResponse.json({ ok: false, error: 'password is wrong' }, { status: 403 });
        }
        // removing 2FA must itself prove possession of the current 2FA
        if (sec.totpEnabled && !verifyTotp(sec.totpSecret, String(body.code ?? ''))) {
          return NextResponse.json({ ok: false, error: 'current 2FA code required', code: 'TOTP' }, { status: 403 });
        }
        updateSecurity({ totpEnabled: false, totpSecret: '' });
        logAudit({ category: 'system', action: 'security.2fa.disabled', level: 'warning' });
        return NextResponse.json({ ok: true });
      }

      case 'pin.set': {
        if (sec.enabled) {
          if (!credentialAllowed(ip)) {
            return NextResponse.json({ ok: false, error: 'too many attempts, wait a minute' }, { status: 429 });
          }
          if (!verifySecret(String(body.password ?? ''), sec.passwordHash)) {
            logSecurity('password.fail', { ip, action });
            return NextResponse.json({ ok: false, error: 'password is wrong' }, { status: 403 });
          }
        }
        const pin = String(body.pin ?? '');
        if (!/^\d{4,8}$/.test(pin)) {
          return NextResponse.json({ ok: false, error: 'PIN must be 4-8 digits' }, { status: 400 });
        }
        updateSecurity({ pinHash: hashSecret(pin), pinFailCount: 0, pinLocked: false });
        logAudit({ category: 'system', action: 'security.pin.set', level: 'warning' });
        return NextResponse.json({ ok: true });
      }

      case 'pin.verify': {
        // only an authenticated session may probe the PIN (avoid lockout DoS)
        if (sec.enabled && !sessionFromRequest(req)) {
          return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });
        }
        const result = verifyPin(String(body.pin ?? ''));
        if (result === 'ok') return NextResponse.json({ ok: true });
        const st = pinStatus();
        return NextResponse.json(
          { ok: false, error: result, locked: st.locked, remaining: Math.max(0, 3 - st.fails) },
          { status: 428 },
        );
      }

      case 'pin.unlock': {
        const res = unlockWithTotp(String(body.code ?? ''));
        if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 403 });
        return NextResponse.json({ ok: true });
      }

      /** guided-setup completion: requires a session (the wizard owner) */
      case 'onboarding.finish': {
        if (sec.enabled && !sessionFromRequest(req)) {
          return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });
        }
        settingsRepo.update({ onboarding: { completed: true, completedAt: Date.now() } });
        logAudit({ category: 'system', action: 'onboarding.completed', level: 'success' });
        return NextResponse.json({ ok: true });
      }

      case 'device.revoke': {
        if (sec.enabled) {
          if (!credentialAllowed(ip)) {
            return NextResponse.json({ ok: false, error: 'too many attempts, wait a minute' }, { status: 429 });
          }
          if (!verifySecret(String(body.password ?? ''), sec.passwordHash)) {
            logSecurity('password.fail', { ip, action });
            return NextResponse.json({ ok: false, error: 'password is wrong' }, { status: 403 });
          }
        }
        updateSecurity({ devices: security().devices.filter((d) => d.id !== String(body.id)) });
        return NextResponse.json({ ok: true });
      }

      case 'device.register': {
        // registering a new device requires full credentials + 2FA
        if (!sec.enabled) return NextResponse.json({ ok: true });
        if (!credentialAllowed(ip)) {
          return NextResponse.json({ ok: false, error: 'too many attempts, wait a minute' }, { status: 429 });
        }
        if (body.username !== sec.username || !verifySecret(String(body.password ?? ''), sec.passwordHash)) {
          logSecurity('login.fail', { ip, action });
          return NextResponse.json({ ok: false, error: 'invalid credentials' }, { status: 401 });
        }
        if (sec.totpEnabled && !verifyTotp(sec.totpSecret, String(body.totpCode ?? ''))) {
          return NextResponse.json({ ok: false, error: 'invalid 2FA code' }, { status: 401 });
        }
        const device = String(body.device ?? '');
        if (!device) return NextResponse.json({ ok: false, error: 'device id required' }, { status: 400 });
        if (!sec.devices.some((d) => d.id === device)) {
          updateSecurity({ devices: [...security().devices, { id: device, label: String(body.label ?? 'Device ' + uid('').slice(0, 4)), addedAt: Date.now() }] });
        }
        const { token } = createSession(sec.username, device);
        const res = NextResponse.json({ ok: true });
        res.cookies.set(COOKIE, token, {
          httpOnly: true, sameSite: 'strict', secure: isSecureRequest(req), path: '/', maxAge: 12 * 3600,
        });
        logAudit({ category: 'system', action: 'security.device.registered', level: 'warning', payload: { device } });
        return res;
      }

      default:
        return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
