'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { usePrefs, upDownColors, hydratePrefs } from '@/stores/prefs';
import { useConn } from '@/stores/conn';
import { installHttpHardening } from '@/lib/http';
import { LoginGate, useSession, PinGate } from '@/components/security/LoginGate';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import {
  LayoutDashboard, CandlestickChart, LineChart, ClipboardList, Bot,
  X, TrendingUp,
} from 'lucide-react';
import { useAppSocket } from '@/hooks/useAppSocket';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { toastBus } from '@/lib/toastBus';
import { SidebarContent } from './sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const session = useSession();
  const [pinOpen, setPinOpen] = React.useState(false);
  const [authedTick, setAuthedTick] = React.useState(0);

  React.useEffect(() => {
    installHttpHardening();
    hydratePrefs();
  }, []);

  React.useEffect(() => {
    const onPin = () => setPinOpen(true);
    window.addEventListener('gt:pin-required', onPin);
    return () => window.removeEventListener('gt:pin-required', onPin);
  }, []);

  useAppSocket(t);

  const authRequired = session?.enabled && !session.authed;
  // first-run gate: the guided setup runs BEFORE everything else (including
  // the login gate — the wizard itself creates the owner account)
  const needsOnboarding = session?.onboardingRequired === true;

  return (
    <ToastBridge>
      {needsOnboarding ? (
        <OnboardingWizard key={authedTick} onDone={() => setAuthedTick((n) => n + 1)} />
      ) : authRequired ? (
        <LoginGate key={authedTick} onAuthed={() => setAuthedTick((n) => n + 1)} />
      ) : (
        <div className="flex h-dvh w-full bg-canvas text-gray-900">
          {/* Desktop sidebar */}
          <aside className="hidden w-56 shrink-0 flex-col border-r border-gray-200 bg-white md:flex">
            <SidebarContent />
          </aside>

          {/* Main column */}
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <RiskHaltBanner />
            <main className="min-h-0 flex-1 overflow-y-auto pb-16 md:pb-0">{children}</main>
            <MobileNav />
          </div>
        </div>
      )}
      <PinGate open={pinOpen} onResolved={() => setPinOpen(false)} />
    </ToastBridge>
  );
}

function ToastBridge({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ToastBusRelay />
      {children}
    </ToastProvider>
  );
}

function ToastBusRelay() {
  const { toast } = useToast();
  React.useEffect(() => toastBus.subscribe(toast), [toast]);
  return null;
}

// ─── Topbar ──────────────────────────────────────────────────────────────────

function Topbar() {
  const { t, locale, setLocale } = useI18n();
  const pathname = usePathname();
  const appSocket = useConn((s) => s.appSocket);
  const engineStatus = usePrefs((s) => s.engineStatus);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-3 md:px-5">
      <div className="flex items-center gap-2 md:hidden">
        <Logo className="h-7 w-7" />
        <span className="text-sm font-bold">DownTrade</span>
      </div>

      <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
        <h1 className="truncate text-sm font-semibold text-gray-900">
          {pageTitleKey(pathname) ? t(pageTitleKey(pathname)!) : t('app.name')}
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-2 md:ml-0 md:gap-3">
        {/* connection dots */}
        <div className="hidden items-center gap-3 rounded-lg border border-gray-200 px-3 py-1.5 lg:flex">
          <ConnDot label={t('app.socketOk')} ok={appSocket === 'connected'} />
          <ConnDot label={t('nav.dashboard')} ok={engineStatus?.publicWs === 'connected'} />
          <ConnDot
            label={engineStatus?.privateWs === 'connected' ? 'API' : t('app.noAccount')}
            ok={engineStatus?.privateWs === 'connected'}
          />
        </div>

        {/* paper / live badge */}
        {engineStatus && (
          <span
            className={cn(
              'hidden items-center rounded-md px-2 py-1 text-2xs font-bold tracking-wide sm:inline-flex',
              engineStatus.paper ? 'bg-amber-50 text-amber-600' : 'bg-up/10 text-up',
            )}
          >
            {engineStatus.paper ? t('app.paperBadge') : engineStatus.privateWs === 'connected' ? t('app.liveBadge') : t('app.noAccount')}
          </span>
        )}

        <button
          onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
          className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
        >
          {locale === 'zh-CN' ? 'EN' : '中文'}
        </button>

        <NotificationsBell />
      </div>
    </header>
  );
}

function ConnDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-2xs text-gray-500" title={label}>
      <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-up' : 'bg-gray-300')} />
      {label}
    </span>
  );
}

function pageTitleKey(pathname: string): string | null {
  const map: [RegExp, string][] = [
    [/^\/dashboard/, 'nav.dashboard'],
    [/^\/markets/, 'nav.markets'],
    [/^\/trade/, 'nav.trade'],
    [/^\/orders/, 'nav.orders'],
    [/^\/positions/, 'nav.positions'],
    [/^\/strategies/, 'nav.strategies'],
    [/^\/bots/, 'nav.bots'],
    [/^\/backtest/, 'nav.backtest'],
    [/^\/assistant/, 'nav.assistant'],
    [/^\/activity/, 'nav.activity'],
    [/^\/settings/, 'nav.settings'],
  ];
  for (const [re, key] of map) if (re.test(pathname)) return key;
  return null;
}

/** Global risk-halt banner — the kill switch must be visible on every page. */
function RiskHaltBanner() {
  const { t } = useI18n();
  const toast = useToast();
  const halted = usePrefs((s) => s.engineStatus?.halted ?? null);
  const [busy, setBusy] = React.useState(false);
  if (!halted) return null;
  const resume = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'risk.resume' }),
      });
      const j = await res.json();
      if (j?.ok) toast.success(t('risk.resumed'));
      else toast.error(t('common.requestFailed'), j?.error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2 border-b border-down/20 bg-down/5 px-3 py-1.5 text-2xs text-down md:px-5">
      <span className="font-bold">⛔ {t('risk.haltedBanner')}</span>
      <span className="min-w-0 flex-1 truncate text-down/80">{halted.reason}</span>
      <button
        onClick={() => void resume()}
        disabled={busy}
        className="shrink-0 rounded border border-down/40 px-2 py-0.5 font-medium text-down transition-colors hover:bg-down/10 disabled:opacity-50"
      >
        {t('risk.resume')}
      </button>
    </div>
  );
}

// ─── Notification bell ───────────────────────────────────────────────────────

function NotificationsBell() {
  const { t } = useI18n();
  const { notifications, unread, clearUnread } = usePrefs();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) clearUnread();
        }}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
        aria-label={t('common.notifications')}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-down px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed left-3 right-3 top-16 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-pop sm:absolute sm:left-auto sm:right-0 sm:top-10 sm:w-96">
          <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-2.5">
            <span className="text-sm font-semibold">{t('dashboard.recentEvents')}</span>
            <Link href="/activity" className="text-xs text-brand-600 hover:underline" onClick={() => setOpen(false)}>
              {t('common.viewAll')}
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {notifications.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-gray-400">{t('activity.empty')}</div>
            )}
            {notifications.slice(0, 20).map((n) => (
              <EventRow key={n.id} event={n} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function EventRow({ event }: { event: { id: string; ts: number; level: string; code: string; params?: Record<string, string | number>; channel: string } }) {
  const { t, locale } = useI18n();
  const text = (t(`notif.${event.code}`, event.params), notifFallback(event.code, event.params, t));
  const time = new Date(event.ts).toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { hour12: false });
  const tone =
    event.level === 'error' ? 'bg-down' : event.level === 'warning' ? 'bg-amber-500' : event.level === 'success' ? 'bg-up' : 'bg-brand-500';
  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5">
      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', tone)} />
      <div className="min-w-0 flex-1">
        <div className="break-words text-xs leading-relaxed text-gray-800">{text}</div>
        <div className="mt-0.5 text-2xs text-gray-400">{time} · {t(`activity.channel_${event.channel}`)}</div>
      </div>
    </div>
  );
}

function notifFallback(code: string, params: Record<string, string | number> | undefined, t: (k: string, p?: Record<string, string | number>) => string): string {
  const direct = t(`notif.${code}`, params);
  if (direct !== `notif.${code}`) return direct;
  let text = code;
  if (params) for (const [k, v] of Object.entries(params)) text += ` ${k}=${v}`;
  return text;
}

// ─── Mobile bottom nav ───────────────────────────────────────────────────────

function MobileNav() {
  const { t } = useI18n();
  const pathname = usePathname();
  const items = [
    { href: '/dashboard', icon: LayoutDashboard, key: 'nav.dashboard' },
    { href: '/markets', icon: LineChart, key: 'nav.markets' },
    { href: '/trade', icon: CandlestickChart, key: 'nav.trade' },
    { href: '/orders', icon: ClipboardList, key: 'nav.orders' },
    { href: '/menu', icon: X, key: 'nav.more' },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t border-gray-200 bg-white md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map((item) => {
        const active = pathname.startsWith(item.href.replace('/menu', '###')) ||
          (item.href === '/menu' && ['/positions', '/strategies', '/backtest', '/assistant', '/activity', '/settings'].some((p) => pathname.startsWith(p)));
        if (item.href === '/menu') {
          return <MobileMenuButton key={item.href} active={active} label={t('nav.more')} />;
        }
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-2xs',
              active ? 'text-brand-600' : 'text-gray-400',
            )}
          >
            <Icon className="h-5 w-5" />
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}

function MobileMenuButton({ active, label }: { active: boolean; label: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn('flex flex-1 flex-col items-center justify-center gap-0.5 text-2xs', active ? 'text-brand-600' : 'text-gray-400')}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
        </svg>
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-[96] md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-gray-900/40" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="text-sm font-semibold">DownTrade</span>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-gray-400"><X className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto py-2">
              <SidebarContent onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center rounded-lg bg-brand-600 text-white', className)}>
      <TrendingUp className="h-3/4 w-3/4 -scale-y-100" strokeWidth={2.5} />
    </div>
  );
}
