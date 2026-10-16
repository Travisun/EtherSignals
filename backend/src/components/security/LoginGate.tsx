'use client';

import React, { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getDeviceId } from '@/lib/fingerprint';

interface SessionInfo {
  enabled: boolean;
  authed: boolean;
  totpEnabled: boolean;
  pinLocked: boolean;
  devices: { id: string; label: string; addedAt: number }[];
  onboardingRequired?: boolean;
  onboarded?: boolean;
  hasExchangeAccount?: boolean;
}

export function useSession(): SessionInfo | null {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  useEffect(() => {
    const load = () =>
      fetch('/api/auth')
        .then((r) => r.json())
        .then((j) => j?.ok && setInfo(j.data))
        .catch(() => undefined);
    void load();
    // never guess: a 401 (or a fresh login elsewhere) is always resolved by
    // refetching the authoritative server state — an optimistic flip to
    // unauthenticated would resurrect the login gate right after a login
    const onAuth = () => void load();
    window.addEventListener('gt:auth-required', onAuth);
    window.addEventListener('gt:session-changed', onAuth);
    return () => {
      window.removeEventListener('gt:auth-required', onAuth);
      window.removeEventListener('gt:session-changed', onAuth);
    };
  }, []);
  return info;
}

/** Full-screen login gate shown while security is enabled and unauthenticated. */
export function LoginGate({ onAuthed }: { onAuthed: () => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [needDevice, setNeedDevice] = useState(false);
  const [deviceTotp, setDeviceTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (registerDevice = false) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: registerDevice ? 'device.register' : 'login',
          username,
          password,
          totpCode: totp,
          device: getDeviceId(),
          deviceLabel: typeof navigator !== 'undefined' ? navigator.platform || 'Browser' : 'Browser',
        }),
      });
      const j = await res.json();
      if (j?.ok) {
        // the session cookie is set server-side — refresh the shell's session
        // state so the gate actually lifts (otherwise nothing happens visually)
        window.dispatchEvent(new CustomEvent('gt:session-changed'));
        onAuthed();
      } else if (j?.code === 'TOTP') {
        setNeedTotp(true);
        setError(t('security.invalidTotp'));
      } else if (j?.code === 'DEVICE') {
        setNeedDevice(true);
        // whether registering needs a 2FA code depends on the server's 2FA
        // state — resolve it rather than trusting possibly-stale session data
        void fetch('/api/auth').then((r) => r.json()).then((a) => {
          const totpOn = Boolean(a?.data?.totpEnabled);
          setDeviceTotp(totpOn);
          setError(totpOn ? t('security.unknownDevice') : t('security.unknownDeviceNoTotp'));
        }).catch(() => setError(t('security.unknownDeviceNoTotp')));
      } else {
        setError(j?.error ?? t('common.requestFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-pop">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-gray-900">DownTrade</h1>
          <p className="mt-0.5 text-xs text-gray-400">{t('security.loginHint')}</p>
        </div>
        <div className="space-y-3">
          <Input label={t('security.username')} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          <Input label={t('security.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && !needDevice && submit(false)} />
          {(needTotp || (needDevice && deviceTotp)) && (
            <Input label={t('security.totpCode')} value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="000000" />
          )}
          {error && <p className="rounded-md bg-down/5 px-3 py-2 text-xs text-down">{error}</p>}
          <Button block size="lg" loading={busy} onClick={() => submit(false)} disabled={!username || !password}>
            {t('security.login')}
          </Button>
          {needDevice && (
            <Button block variant="outline" loading={busy} onClick={() => submit(true)} disabled={!totp && needTotp}>
              {t('security.registerDevice')}
            </Button>
          )}
        </div>
        <p className="mt-4 text-center text-2xs leading-relaxed text-gray-300">{t('security.deviceNote')}</p>
      </div>
    </div>
  );
}

/** PIN unlock modal: verify, or unlock a locked PIN with 2FA. */
export function PinGate({ open, onResolved }: { open: boolean; onResolved: () => void }) {
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [totp, setTotp] = useState('');
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPin('');
      setTotp('');
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const verify = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pin.verify', pin }),
      });
      const j = await res.json();
      if (j?.ok) {
        setCachedPinWrapper(pin);
        onResolved();
      } else {
        setLocked(Boolean(j?.locked));
        setError(`${t('security.pinWrong')}${j?.remaining != null ? ` · ${t('security.attemptsLeft', { n: j.remaining })}` : ''}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pin.unlock', code: totp }),
      });
      const j = await res.json();
      if (j?.ok) {
        setLocked(false);
        setError(t('security.pinUnlocked'));
      } else {
        setError(j?.error ?? t('security.invalidTotp'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-xs rounded-2xl bg-white p-5 shadow-pop">
        <h3 className="mb-1 text-sm font-bold text-gray-900">{locked ? t('security.pinLockedTitle') : t('security.pinTitle')}</h3>
        <p className="mb-3 text-2xs leading-relaxed text-gray-400">
          {locked ? t('security.pinLockedHint') : t('security.pinHint')}
        </p>
        <div className="space-y-2.5">
          {!locked && (
            <Input
              label={t('security.pin')}
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verify()}
              autoFocus
            />
          )}
          {locked && (
            <Input label={t('security.totpCode')} value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="000000" />
          )}
          {error && <p className="text-xs text-down">{error}</p>}
          <div className="flex gap-2">
            {locked ? (
              <Button block loading={busy} onClick={unlock} disabled={totp.length !== 6}>{t('security.unlock')}</Button>
            ) : (
              <Button block loading={busy} onClick={verify} disabled={pin.length < 4}>{t('common.confirm')}</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { setCachedPin, resolvePendingPin } from '@/lib/http';

function setCachedPinWrapper(pin: string) {
  setCachedPin(pin);
  // release any API calls held on 428 PIN_REQUIRED — they replay transparently
  resolvePendingPin();
}
