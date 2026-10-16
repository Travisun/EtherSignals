'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/primitives';
import { QRCodeSVG } from 'qrcode.react';
import { getDeviceId } from '@/lib/fingerprint';
import { setCachedPin } from '@/lib/http';
import { usePrefs, applyUpDownVars, type UpDownPref } from '@/stores/prefs';
import {
  ShieldCheck, KeyRound, UserPlus, ScanLine, Wallet, Rocket, Check, ArrowLeft,
  ArrowRight, Eye, EyeOff, Copy, Lock, Globe, Palette,
} from 'lucide-react';

type StepKey = 'welcome' | 'account' | 'totp' | 'pin' | 'exchange' | 'done';

interface ServerState {
  enabled: boolean;
  totpEnabled: boolean;
  pinSet: boolean;
  hasExchangeAccount: boolean;
}

const STEP_ICONS: Record<StepKey, React.ComponentType<{ className?: string }>> = {
  welcome: Rocket,
  account: UserPlus,
  totp: ScanLine,
  pin: KeyRound,
  exchange: Wallet,
  done: ShieldCheck,
};

/**
 * First-run guided setup: welcome → admin account → 2FA → PIN → exchange →
 * activation. The workspace stays gated until every security step completes;
 * a refresh mid-wizard resumes at the first incomplete step (server-derived).
 */
export function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const toast = useToast();

  const [srv, setSrv] = useState<ServerState | null>(null);
  const [steps, setSteps] = useState<StepKey[]>(['welcome']);
  const [stepIdx, setStepIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // credentials typed during this wizard session (never persisted client-side)
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  // per-step completion overrides (server state only changes via refetch)
  const [totpVerified, setTotpVerified] = useState(false);
  const [pinSaved, setPinSaved] = useState(false);
  const [exchangeSaved, setExchangeSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth')
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok) return;
        const d = j.data as ServerState & { started?: boolean };
        setSrv({ enabled: d.enabled, totpEnabled: d.totpEnabled, pinSet: d.pinSet, hasExchangeAccount: d.hasExchangeAccount });
        // build the required steps from actual server state (resume-safe)
        const arr: StepKey[] = ['welcome'];
        if (!d.enabled) arr.push('account');
        if (d.enabled && !d.totpEnabled) arr.push('totp');
        if (d.enabled && !d.pinSet) arr.push('pin');
        arr.push('exchange');
        arr.push('done');
        setSteps(arr);
        const progress = d.enabled || d.totpEnabled || d.pinSet || d.hasExchangeAccount;
        // first incomplete step (welcome counts as done once progress exists)
        let idx = 0;
        for (let i = 0; i < arr.length; i++) {
          const k = arr[i];
          const done =
            k === 'welcome' ? Boolean(progress) :
            k === 'account' ? d.enabled :
            k === 'totp' ? d.totpEnabled :
            k === 'pin' ? d.pinSet :
            k === 'exchange' ? d.hasExchangeAccount : false;
          if (!done) {
            idx = i;
            break;
          }
          idx = i;
        }
        setStepIdx(idx);
      })
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const stepDone = useCallback(
    (k: StepKey): boolean => {
      if (!srv) return false;
      switch (k) {
        case 'welcome': return true;
        case 'account': return srv.enabled;
        case 'totp': return srv.totpEnabled || totpVerified;
        case 'pin': return srv.pinSet || pinSaved;
        case 'exchange': return srv.hasExchangeAccount || exchangeSaved;
        case 'done': return false;
      }
    },
    [srv, totpVerified, pinSaved, exchangeSaved],
  );

  const current = steps[stepIdx];

  /** single progression primitive: each step's primary action advances on success */
  const goNext = () => {
    setError('');
    setStepIdx((i) => Math.min(i + 1, steps.length - 1));
  };
  const goBack = () => {
    setError('');
    setStepIdx((i) => Math.max(i - 1, 0));
  };

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'onboarding.finish' }),
      });
      const j = await res.json();
      if (j?.ok) {
        onDone();
        window.dispatchEvent(new CustomEvent('gt:session-changed'));
      } else {
        setError(j?.error ?? t('common.requestFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          <p className="text-xs text-gray-400">DownTrade</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* left rail — step checklist (desktop) */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-gray-200 bg-white lg:flex">
        <div className="flex items-center gap-2.5 px-6 pt-7">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">DownTrade</p>
            <p className="text-2xs text-gray-400">{t('onboarding.subtitle')}</p>
          </div>
        </div>
        <nav className="mt-8 flex-1 space-y-1 px-3">
          {steps.map((k, i) => {
            const Icon = STEP_ICONS[k];
            const done = stepDone(k) && k !== 'done';
            const active = i === stepIdx;
            return (
              <div
                key={k}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs transition-colors',
                  active ? 'bg-brand-50 font-semibold text-brand-700' : done ? 'text-gray-500' : 'text-gray-400',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-2xs',
                    done ? 'border-up bg-up text-white' : active ? 'border-brand-500 text-brand-600' : 'border-gray-200',
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                </span>
                {t(`onboarding.step_${k}`)}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-gray-100 px-6 py-4">
          <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-gray-400">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            {t('onboarding.railNote')}
          </p>
        </div>
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile progress */}
        <div className="flex items-center gap-1.5 px-4 pt-4 lg:hidden">
          {steps.map((k, i) => (
            <span
              key={k}
              className={cn('h-1 flex-1 rounded-full', i < stepIdx ? 'bg-up' : i === stepIdx ? 'bg-brand-500' : 'bg-gray-200')}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 px-4 pt-3 lg:hidden">
          {(() => {
            const Icon = STEP_ICONS[current];
            return (
              <>
                <Icon className="h-4 w-4 text-brand-600" />
                <span className="text-xs font-semibold text-gray-800">{t(`onboarding.step_${current}`)}</span>
                <span className="ml-auto text-2xs text-gray-400">{stepIdx + 1} / {steps.length}</span>
              </>
            );
          })()}
        </div>

        <main className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 py-6 lg:items-center lg:px-10">
          <div className="w-full max-w-xl">
            {current === 'welcome' && <WelcomeStep onNext={goNext} />}
            {current === 'account' && (
              <AccountStep
                busy={busy}
                error={error}
                onError={setError}
                onBusy={setBusy}
                password={password}
                setPassword={setPassword}
                onNext={goNext}
                onCreated={() => {
                  setHasPassword(true);
                  setSrv((s) => (s ? { ...s, enabled: true } : s));
                }}
              />
            )}
            {current === 'totp' && (
              <TotpStep
                password={password}
                hasPassword={hasPassword}
                busy={busy}
                error={error}
                onError={setError}
                onBusy={setBusy}
                onPassword={setPassword}
                onNext={goNext}
                onVerified={() => {
                  setTotpVerified(true);
                  setSrv((s) => (s ? { ...s, totpEnabled: true } : s));
                }}
              />
            )}
            {current === 'pin' && (
              <PinStep
                password={password}
                hasPassword={hasPassword}
                busy={busy}
                error={error}
                onError={setError}
                onBusy={setBusy}
                onPassword={setPassword}
                onNext={goNext}
                onSaved={(pin) => {
                  setPinSaved(true);
                  setCachedPin(pin);
                  setSrv((s) => (s ? { ...s, pinSet: true } : s));
                }}
              />
            )}
            {current === 'exchange' && (
              <ExchangeStep
                busy={busy}
                error={error}
                onError={setError}
                onBusy={setBusy}
                toast={toast}
                onNext={goNext}
                onSaved={() => {
                  setExchangeSaved(true);
                  setSrv((s) => (s ? { ...s, hasExchangeAccount: true } : s));
                }}
              />
            )}
            {current === 'done' && <DoneStep srv={srv} usernameHint={t('onboarding.doneAccount')} busy={busy} error={error} onActivate={() => void finish()} />}
          </div>
        </main>

        {/* footer nav — Back only: every step advances from its own action */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3 lg:px-10">
          <Button variant="ghost" onClick={goBack} disabled={stepIdx === 0 || busy}>
            <ArrowLeft className="mr-1 h-4 w-4" />{t('onboarding.back')}
          </Button>
          <div className="text-2xs text-gray-400">
            {stepIdx + 1} / {steps.length}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: welcome ─────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const upDown = usePrefs((s) => s.upDown);
  const setUpDown = usePrefs((s) => s.setUpDown);
  const features = ['onboarding.featMarket', 'onboarding.featStrategy', 'onboarding.featBacktest', 'onboarding.featRisk'];
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-widest text-brand-600">{t('onboarding.welcomeEyebrow')}</p>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">{t('onboarding.welcomeTitle')}</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-500">{t('onboarding.welcomeText')}</p>

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {features.map((f) => (
          <div key={f} className="flex items-start gap-2.5 rounded-xl border border-gray-100 bg-white px-3.5 py-3">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-up" />
            <span className="text-xs leading-relaxed text-gray-600">{t(f)}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-4 rounded-xl border border-gray-100 bg-white p-4">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-700">
            <Globe className="h-3.5 w-3.5 text-gray-400" />{t('onboarding.language')}
          </p>
          <div className="flex gap-2">
            {(['zh-CN', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                  locale === l ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:border-gray-300',
                )}
              >
                {l === 'zh-CN' ? '简体中文' : 'English'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-700">
            <Palette className="h-3.5 w-3.5 text-gray-400" />{t('onboarding.upDown')}
          </p>
          <div className="flex gap-2">
            {([
              { v: 'auto', label: t('settings.upDownAuto') },
              { v: 'red-up', label: t('settings.redUp') },
              { v: 'green-up', label: t('settings.greenUp') },
            ] as { v: UpDownPref; label: string }[]).map((o) => (
              <button
                key={o.v}
                onClick={() => {
                  setUpDown(o.v);
                  applyUpDownVars(o.v, locale);
                }}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                  upDown === o.v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:border-gray-300',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-2xs leading-relaxed text-amber-700">{t('onboarding.welcomeNote')}</p>
      </div>

      <Button block size="lg" className="mt-5" onClick={onNext}>
        {t('onboarding.start')}<ArrowRight className="ml-1.5 h-4 w-4" />
      </Button>
    </div>
  );
}

// ─── Step 2: admin account ───────────────────────────────────────────────────

function passwordScore(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score += 1;
  return Math.min(score, 4);
}

function AccountStep({
  busy, error, onError, onBusy, password, setPassword, onCreated, onNext,
}: {
  busy: boolean;
  error: string;
  onError: (s: string) => void;
  onBusy: (b: boolean) => void;
  password: string;
  setPassword: (s: string) => void;
  onCreated: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);

  const score = passwordScore(password);
  const valid =
    username.trim().length >= 2 &&
    password.length >= 8 &&
    password === confirm;

  const submit = async () => {
    onBusy(true);
    onError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'configure',
          onboarding: true,
          username: username.trim(),
          password,
          device: getDeviceId(),
          deviceLabel: typeof navigator !== 'undefined' ? navigator.platform || 'Browser' : 'Browser',
        }),
      });
      const j = await res.json();
      if (j?.ok) {
        onCreated();
        onNext();
      } else {
        onError(j?.error ?? t('common.requestFailed'));
      }
    } catch (e) {
      onError(String(e));
    } finally {
      onBusy(false);
    }
  };

  return (
    <StepShell
      icon={<UserPlus className="h-5 w-5" />}
      title={t('onboarding.accountTitle')}
      desc={t('onboarding.accountDesc')}
      error={error}
      content={
        <div className="space-y-4">
          <Input label={t('onboarding.adminUsername')} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="admin" />
          <div>
            <Input
              label={t('onboarding.adminPassword')}
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="••••••••"
              suffix={
                <button type="button" onClick={() => setShow((v) => !v)} className="text-gray-400 hover:text-gray-600" aria-label={show ? t('settings.hideApiKey') : t('settings.showApiKey')}>
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />
            <div className="mt-2 flex gap-1">
              {[1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1 flex-1 rounded-full',
                    score >= i ? (score <= 2 ? 'bg-down' : score === 3 ? 'bg-amber-500' : 'bg-up') : 'bg-gray-200',
                  )}
                />
              ))}
            </div>
            <p className="mt-1 text-2xs text-gray-400">
              {t('onboarding.passwordStrength', { n: String(score) })}
            </p>
          </div>
          <Input
            label={t('onboarding.confirmPassword')}
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            error={confirm && confirm !== password ? t('onboarding.passwordMismatch') : undefined}
          />
          <Button block size="lg" loading={busy} disabled={!valid || busy} onClick={submit}>
            {t('onboarding.accountCreate')}
          </Button>
          <p className="text-2xs leading-relaxed text-gray-400">{t('onboarding.accountNote')}</p>
        </div>
      }
    />
  );
}

// ─── Step 3: 2FA ─────────────────────────────────────────────────────────────

function TotpStep({
  password, hasPassword, busy, error, onError, onBusy, onPassword, onVerified, onNext,
}: {
  password: string;
  hasPassword: boolean;
  busy: boolean;
  error: string;
  onError: (s: string) => void;
  onBusy: (b: boolean) => void;
  onPassword: (s: string) => void;
  onVerified: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [gatePassword, setGatePassword] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const beganRef = React.useRef(false);

  const beginSetup = async (pw: string) => {
    onBusy(true);
    onError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'totp.setup', password: pw }),
      });
      const j = await res.json();
      if (j?.ok) {
        setSetup(j.data as { secret: string; uri: string });
        if (!hasPassword) onPassword(pw);
      } else {
        onError(j?.error ?? t('common.requestFailed'));
      }
    } finally {
      onBusy(false);
    }
  };

  // already holding the password (created the account this session) →
  // skip the extra click and generate the QR immediately
  React.useEffect(() => {
    if (hasPassword && password && !beganRef.current) {
      beganRef.current = true;
      void beginSetup(password);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async () => {
    onBusy(true);
    onError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'totp.enable', code }),
      });
      const j = await res.json();
      if (j?.ok) {
        toast.success(t('onboarding.totpEnabled'));
        onVerified();
        onNext();
      } else {
        onError(j?.error ?? t('security.invalidTotp'));
      }
    } finally {
      onBusy(false);
    }
  };

  return (
    <StepShell
      icon={<ScanLine className="h-5 w-5" />}
      title={t('onboarding.totpTitle')}
      desc={t('onboarding.totpDesc')}
      error={error}
      content={
        !setup ? (
          <div className="space-y-4">
            {hasPassword ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-gray-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
                {t('onboarding.totpGenerating')}
              </div>
            ) : (
              <>
                <Input
                  label={t('onboarding.verifyIdentity')}
                  type="password"
                  value={gatePassword}
                  onChange={(e) => setGatePassword(e.target.value)}
                  autoComplete="current-password"
                  onKeyDown={(e) => e.key === 'Enter' && gatePassword && beginSetup(gatePassword)}
                />
                <Button block size="lg" loading={busy} disabled={!gatePassword} onClick={() => beginSetup(gatePassword)}>
                  {t('common.confirm')}
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-gray-100 bg-white p-4 sm:flex-row sm:items-start">
              <div className="rounded-lg border border-gray-100 bg-white p-2">
                <QRCodeSVG value={setup.uri} size={132} />
              </div>
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <p className="text-xs font-medium text-gray-700">{t('onboarding.totpScan')}</p>
                <p className="mt-1 text-2xs leading-relaxed text-gray-400">{t('onboarding.totpScanHint')}</p>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(setup.secret);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 font-mono text-2xs text-gray-600 transition-colors hover:bg-gray-100"
                >
                  {copied ? <Check className="h-3 w-3 text-up" /> : <Copy className="h-3 w-3" />}
                  {setup.secret}
                </button>
              </div>
            </div>
            <Input
              label={t('security.totpCode')}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              className="text-center font-mono text-lg tracking-[0.4em]"
              onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verify()}
            />
            <Button block size="lg" loading={busy} disabled={code.length !== 6} onClick={verify}>
              {t('onboarding.totpVerify')}
            </Button>
            <p className="text-2xs leading-relaxed text-gray-400">{t('onboarding.totpNote')}</p>
          </div>
        )
      }
    />
  );
}

// ─── Step 4: transaction PIN ─────────────────────────────────────────────────

function PinStep({
  password, hasPassword, busy, error, onError, onBusy, onPassword, onSaved, onNext,
}: {
  password: string;
  hasPassword: boolean;
  busy: boolean;
  error: string;
  onError: (s: string) => void;
  onBusy: (b: boolean) => void;
  onPassword: (s: string) => void;
  onSaved: (pin: string) => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [gatePassword, setGatePassword] = useState('');

  const valid = /^\d{4,8}$/.test(pin) && pin === confirm && (hasPassword || gatePassword.length > 0);

  const submit = async () => {
    onBusy(true);
    onError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pin.set', pin, password: hasPassword ? password : gatePassword }),
      });
      const j = await res.json();
      if (j?.ok) {
        if (!hasPassword) onPassword(gatePassword);
        onSaved(pin);
        onNext();
      } else {
        onError(j?.error ?? t('common.requestFailed'));
      }
    } finally {
      onBusy(false);
    }
  };

  return (
    <StepShell
      icon={<KeyRound className="h-5 w-5" />}
      title={t('onboarding.pinTitle')}
      desc={t('onboarding.pinDesc')}
      error={error}
      content={
        <div className="space-y-4">
          <Input
            label={t('security.pin')}
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="text-center font-mono text-lg tracking-[0.4em]"
          />
          <Input
            label={t('onboarding.confirmPin')}
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
            error={confirm && confirm !== pin ? t('onboarding.pinMismatch') : undefined}
            className="text-center font-mono text-lg tracking-[0.4em]"
          />
          {!hasPassword && (
            <Input
              label={t('onboarding.verifyIdentity')}
              type="password"
              value={gatePassword}
              onChange={(e) => setGatePassword(e.target.value)}
              autoComplete="current-password"
            />
          )}
          <Button block size="lg" loading={busy} disabled={!valid || busy} onClick={submit}>
            {t('onboarding.pinSave')}
          </Button>
          <p className="text-2xs leading-relaxed text-gray-400">{t('onboarding.pinNote')}</p>
        </div>
      }
    />
  );
}

// ─── Step 5: exchange account (optional) ─────────────────────────────────────

function ExchangeStep({
  busy, error, onError, onBusy, onSaved, onNext, toast,
}: {
  busy: boolean;
  error: string;
  onError: (s: string) => void;
  onBusy: (b: boolean) => void;
  onSaved: () => void;
  onNext: () => void;
  toast: { success: (t: string, d?: string) => void; error: (t: string, d?: string) => void };
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [demo, setDemo] = useState(true);
  const [show, setShow] = useState(false);
  const [tested, setTested] = useState<'ok' | 'fail' | null>(null);
  const [skipped, setSkipped] = useState(false);

  const validFields = apiKey.trim() && apiSecret.trim() && passphrase.trim();
  const canContinue = Boolean(validFields && tested === 'ok') || skipped;

  const randomId = () => {
    const b = new Uint8Array(9);
    globalThis.crypto.getRandomValues(b);
    return `acc_${Date.now().toString(36)}${Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('')}`;
  };

  const saveAndTest = async () => {
    onBusy(true);
    onError('');
    try {
      // pull current settings, append the new account as active
      const cur = await fetch('/api/settings').then((r) => r.json());
      if (!cur?.ok) {
        onError(t('common.requestFailed'));
        return;
      }
      const accounts = (cur.data.settings.accounts ?? []).map((a: { active: boolean }) => ({ ...a, active: false }));
      const id = randomId();
      accounts.push({
        id,
        label: label.trim() || (demo ? 'Bitget Demo' : 'Bitget'),
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        passphrase: passphrase.trim(),
        demoMode: demo,
        active: true,
        createdAt: Date.now(),
      });
      const put = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts }),
      });
      const putJ = await put.json();
      if (!putJ?.ok) {
        onError(putJ?.error ?? t('common.requestFailed'));
        return;
      }
      // connection test against the saved account
      const test = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'account.test', id }),
      });
      const testJ = await test.json();
      if (testJ?.ok && testJ.data?.ok) {
        setTested('ok');
        toast.success(t('notif.account.test.ok', { label: '' }));
        onSaved();
        onNext();
      } else {
        setTested('fail');
        onError(testJ?.data?.error ?? testJ?.error ?? t('notif.account.test.fail', { reason: '' }));
      }
    } catch (e) {
      onError(String(e));
    } finally {
      onBusy(false);
    }
  };

  return (
    <StepShell
      icon={<Wallet className="h-5 w-5" />}
      title={t('onboarding.exchangeTitle')}
      desc={t('onboarding.exchangeDesc')}
      error={error}
      content={
        <div className="space-y-4">
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-2xs leading-relaxed text-gray-500">
            {t('onboarding.exchangeOptional')}
          </div>
          <Input label={t('onboarding.exchangeLabel')} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={demo ? 'Bitget Demo' : 'Bitget'} />
          <Input label="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
          <Input
            label="API Secret"
            type={show ? 'text' : 'password'}
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            autoComplete="off"
            suffix={
              <button type="button" onClick={() => setShow((v) => !v)} className="text-gray-400 hover:text-gray-600">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />
          <Input label="Passphrase" type={show ? 'text' : 'password'} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" />
          <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5">
            <div>
              <p className="text-xs font-medium text-gray-700">{t('onboarding.demoMode')}</p>
              <p className="text-2xs text-gray-400">{t('onboarding.demoModeHint')}</p>
            </div>
            <Switch checked={demo} onChange={setDemo} />
          </div>

          <div className="flex gap-2">
            <Button className="flex-1" loading={busy} disabled={!validFields || busy} onClick={saveAndTest} variant={tested === 'ok' ? 'buy' : 'primary'}>
              {tested === 'ok' ? <><Check className="mr-1 h-4 w-4" />{t('onboarding.exchangeOk')}</> : t('onboarding.exchangeSaveTest')}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSkipped(true);
                onSaved();
                onNext();
              }}
            >
              {t('onboarding.exchangeSkip')}
            </Button>
          </div>
          <p className="text-2xs leading-relaxed text-gray-400">{t('onboarding.exchangeNote')}</p>
        </div>
      }
    />
  );
}

// ─── Step 6: activation ──────────────────────────────────────────────────────

function DoneStep({
  srv, usernameHint, busy, error, onActivate,
}: {
  srv: ServerState | null;
  usernameHint: string;
  busy: boolean;
  error: string;
  onActivate: () => void;
}) {
  const { t } = useI18n();
  const items = [
    { ok: true, label: t('onboarding.step_account'), detail: usernameHint },
    { ok: Boolean(srv?.totpEnabled), label: t('onboarding.step_totp'), detail: t('onboarding.doneTotp') },
    { ok: Boolean(srv?.pinSet), label: t('onboarding.step_pin'), detail: t('onboarding.donePin') },
    {
      ok: Boolean(srv?.hasExchangeAccount),
      label: t('onboarding.step_exchange'),
      detail: srv?.hasExchangeAccount ? t('onboarding.doneExchange') : t('onboarding.doneNoExchange'),
    },
  ];
  return (
    <StepShell
      icon={<ShieldCheck className="h-5 w-5" />}
      title={t('onboarding.doneTitle')}
      desc={t('onboarding.doneDesc')}
      error={error}
      content={
        <div className="space-y-4">
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
            {items.map((it) => (
              <div key={it.label} className="flex items-center gap-3 px-4 py-3">
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-full', it.ok ? 'bg-up text-white' : 'bg-gray-100 text-gray-400')}>
                  {it.ok ? <Check className="h-3.5 w-3.5" /> : <span className="text-2xs">—</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-800">{it.label}</p>
                  <p className="text-2xs text-gray-400">{it.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
            <p className="text-2xs leading-relaxed text-brand-800">{t('onboarding.doneHint')}</p>
          </div>
          <Button block size="lg" loading={busy} onClick={onActivate}>
            <Rocket className="mr-1.5 h-4 w-4" />{t('onboarding.activate')}
          </Button>
        </div>
      }
    />
  );
}

// ─── shared step shell ───────────────────────────────────────────────────────

function StepShell({
  icon, title, desc, error, content,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  error?: string;
  content: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
        <div>
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        </div>
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-gray-500">{desc}</p>
      {error && <p className="mt-3 rounded-md bg-down/5 px-3 py-2 text-xs text-down">{error}</p>}
      <div className="mt-5">{content}</div>
    </div>
  );
}
