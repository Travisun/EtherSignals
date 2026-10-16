'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { usePrefs } from '@/stores/prefs';
import { useConn } from '@/stores/conn';
import {
  LayoutDashboard, CandlestickChart, LineChart, ClipboardList, Layers,
  Workflow, FlaskConical, Sparkles, ScrollText, Settings, Grid3x3,
} from 'lucide-react';
import { Logo } from './AppShell';

const NAV: { href: string; icon: React.ComponentType<{ className?: string }>; key: string; group: 'main' | 'pro' | 'system' }[] = [
  { href: '/dashboard', icon: LayoutDashboard, key: 'nav.dashboard', group: 'main' },
  { href: '/markets', icon: LineChart, key: 'nav.markets', group: 'main' },
  { href: '/trade', icon: CandlestickChart, key: 'nav.trade', group: 'main' },
  { href: '/orders', icon: ClipboardList, key: 'nav.orders', group: 'main' },
  { href: '/positions', icon: Layers, key: 'nav.positions', group: 'main' },
  { href: '/strategies', icon: Workflow, key: 'nav.strategies', group: 'pro' },
  { href: '/bots', icon: Grid3x3, key: 'nav.bots', group: 'pro' },
  { href: '/backtest', icon: FlaskConical, key: 'nav.backtest', group: 'pro' },
  { href: '/assistant', icon: Sparkles, key: 'nav.assistant', group: 'pro' },
  { href: '/activity', icon: ScrollText, key: 'nav.activity', group: 'pro' },
  { href: '/settings', icon: Settings, key: 'nav.settings', group: 'system' },
];

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const engineStatus = usePrefs((s) => s.engineStatus);
  const appSocket = useConn((s) => s.appSocket);

  const groups: ('main' | 'pro' | 'system')[] = ['main', 'pro', 'system'];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <Logo className="h-8 w-8" />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-gray-900">DownTrade</div>
          <div className="truncate text-2xs text-gray-400">{t('app.tagline')}</div>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((group) => (
          <div key={group} className="mb-1">
            {group !== 'main' && (
              <div className="px-2.5 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider text-gray-400">
                {group === 'pro' ? t('nav.strategies') : t('nav.settings')}
              </div>
            )}
            {NAV.filter((n) => n.group === group).map((item) => {
              const active = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    'mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                    active
                      ? 'bg-brand-50 font-semibold text-brand-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-brand-600' : 'text-gray-400')} />
                  <span className="truncate">{t(item.key)}</span>
                  {item.href === '/strategies' && engineStatus?.runningStrategies ? (
                    <span className="ml-auto rounded-full bg-up/10 px-1.5 py-0.5 text-2xs font-bold text-up">
                      {engineStatus.runningStrategies}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2 text-2xs text-gray-400">
          <span className={cn('h-1.5 w-1.5 rounded-full', appSocket === 'connected' ? 'bg-up' : 'bg-gray-300')} />
          {appSocket === 'connected' ? t('app.socketOk') : t('app.socketOff')}
        </div>
        {engineStatus?.paper && (
          <div className="mt-1 text-2xs text-amber-500">{t('app.paperMode')}</div>
        )}
      </div>
    </div>
  );
}
