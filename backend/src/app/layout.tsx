import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/i18n/provider';
import { AppShell } from '@/components/layout/AppShell';

export const metadata: Metadata = {
  title: 'DownTrade — 专业交易工作台 · Trading Workbench',
  description:
    'Bitget 实时行情 · 合约/现货 · 多图交易工作台 · 策略 Hooks · 回测 · LLM 交易助手 — Real-time Bitget trading workbench with multi-chart analysis, strategy hooks, backtesting and an LLM assistant',
  applicationName: 'DownTrade',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <I18nProvider>
          <AppShell>{children}</AppShell>
        </I18nProvider>
      </body>
    </html>
  );
}
