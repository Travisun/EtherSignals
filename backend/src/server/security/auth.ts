import crypto from 'crypto';
import { settingsRepo } from '@/server/store/repos';
import { getStore } from '@/server/store/jsonStore';
import type { SecurityConfig } from '@/core/types';

/**
 * Financial-grade local security: scrypt password hashing, RFC-6238 TOTP
 * 2FA, transaction PIN with 3-strike lockout (TOTP-gated unlock),
 * device-fingerprint-bound sessions, login rate limiting.
 * Disabled by default (local-first); activates once a password is set.
 */

// ─── hashing ─────────────────────────────────────────────────────────────────

export function hashSecret(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `s1:${salt}:${hash}`;
}

export function verifySecret(plain: string, stored: string): boolean {
  try {
    const [, salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const candidate = crypto.scryptSync(plain, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// ─── TOTP (RFC 6238, SHA-1, 6 digits, 30s) ──────────────────────────────────

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function totpNow(secret: string, at = Date.now()): string {
  return hotp(secret, Math.floor(at / 30_000));
}

/** verify with ±1 time-step window */
export function verifyTotp(secret: string, code: string): boolean {
  const clean = (code ?? '').replace(/\D/g, '');
  if (clean.length !== 6) return false;
  const step = Math.floor(Date.now() / 30_000);
  for (const w of [-1, 0, 1]) {
    const expected = hotp(secret, step + w);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

export function totpUri(secret: string, username: string): string {
  return `otpauth://totp/DownTrade:${encodeURIComponent(username || 'local')}?secret=${secret}&issuer=DownTrade&algorithm=SHA1&digits=6&period=30`;
}

// ─── sessions ────────────────────────────────────────────────────────────────

interface Session {
  username: string;
  device: string;
  expires: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 12 * 3600_000;
// sessions survive process restarts / dev hot-reloads — otherwise every
// server-side recompile logs the user out (local-first: file 0600)
const SESSIONS_FILE = 'sessions';
let sessionsLoaded = false;

function loadSessions() {
  if (sessionsLoaded) return;
  sessionsLoaded = true;
  try {
    const stored = getStore().read<Record<string, Session>>(SESSIONS_FILE, {});
    const now = Date.now();
    for (const [token, s] of Object.entries(stored)) {
      if (s?.expires > now) sessions.set(token, s);
    }
  } catch {
    // unreadable store → start with an empty session set
  }
}

function persistSessions() {
  try {
    const out: Record<string, Session> = {};
    for (const [token, s] of sessions) out[token] = s;
    getStore().write(SESSIONS_FILE, out);
  } catch {
    // best effort — in-memory sessions keep working
  }
}

function pruneSessions() {
  const now = Date.now();
  let pruned = false;
  for (const [token, s] of sessions) {
    if (s.expires < now) {
      sessions.delete(token);
      pruned = true;
    }
  }
  if (pruned) persistSessions();
}

export function createSession(username: string, device: string): { token: string; expires: number } {
  loadSessions();
  pruneSessions();
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { username, device, expires });
  persistSessions();
  return { token, expires };
}

export function revokeSession(token: string) {
  loadSessions();
  if (sessions.delete(token)) persistSessions();
}

export function revokeAllSessions() {
  loadSessions();
  sessions.clear();
  persistSessions();
}

export function sessionFromRequest(req: { cookies: { get(name: string): { value: string } | undefined } }): Session | null {
  loadSessions();
  const token = req.cookies.get('gt_session')?.value;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) return null;
  return s;
}

// ─── login rate limiting ─────────────────────────────────────────────────────

const loginFails = new Map<string, { count: number; windowStart: number }>();
const MAX_TRACKED_IPS = 10_000;

export function loginAllowed(ip: string): boolean {
  const now = Date.now();
  // bound memory: drop the whole cache if an attacker floods fake IPs
  if (loginFails.size > MAX_TRACKED_IPS) loginFails.clear();
  const rec = loginFails.get(ip);
  if (!rec || now - rec.windowStart > 60_000) {
    loginFails.set(ip, { count: 1, windowStart: now });
    return true;
  }
  rec.count += 1;
  return rec.count <= 8;
}

/** Client IP for rate limiting — stamped by server.mjs from the real socket;
 *  client-supplied X-Forwarded-For is never trusted. */
export function clientIpFrom(req: { headers: { get(name: string): string | null } }): string {
  return req.headers.get('x-gt-client-ip')?.split(',')[0]?.trim() || 'local';
}

// ─── PIN with 3-strike lockout ───────────────────────────────────────────────

export type PinResult = 'ok' | 'invalid' | 'locked' | 'not-set';

export function pinStatus(): { locked: boolean; fails: number } {
  const sec = settingsRepo.get().security;
  return { locked: sec.pinLocked, fails: sec.pinFailCount };
}

export function verifyPin(pin: string): PinResult {
  const sec = settingsRepo.get().security;
  if (!sec.pinHash) return 'not-set';
  if (sec.pinLocked) return 'locked';
  if (verifySecret(pin, sec.pinHash)) {
    settingsRepo.update({ security: { ...sec, pinFailCount: 0 } });
    return 'ok';
  }
  const fails = sec.pinFailCount + 1;
  const locked = fails >= 3;
  settingsRepo.update({ security: { ...sec, pinFailCount: fails, pinLocked: locked } });
  if (locked) {
    logSecurity('pin.locked', { fails });
  }
  return locked ? 'locked' : 'invalid';
}

/** unlocking the PIN strictly requires a valid 2FA code */
export function unlockWithTotp(code: string): { ok: boolean; error?: string } {
  const sec = settingsRepo.get().security;
  if (!sec.pinLocked) return { ok: true };
  if (!sec.totpEnabled || !sec.totpSecret) return { ok: false, error: '2FA is required to unlock the PIN' };
  if (!verifyTotp(sec.totpSecret, code)) return { ok: false, error: 'invalid 2FA code' };
  settingsRepo.update({ security: { ...sec, pinLocked: false, pinFailCount: 0 } });
  logSecurity('pin.unlocked', {});
  return { ok: true };
}

export function security(): SecurityConfig {
  return settingsRepo.get().security;
}

export function securityEnabled(): boolean {
  return security().enabled;
}

export function updateSecurity(patch: Partial<SecurityConfig>) {
  settingsRepo.update({ security: { ...settingsRepo.get().security, ...patch } });
}

export function logSecurity(action: string, payload: Record<string, unknown>) {
  // late import to avoid cycles
  void import('@/server/store/pg').then(({ logAudit }) => {
    logAudit({ category: 'system', action: `security.${action}`, level: 'warning', payload });
  });
}
