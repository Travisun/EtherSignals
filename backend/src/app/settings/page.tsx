'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { Card, Badge, Switch } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/tabs';import { Button } from '@/components/ui/button';
import { Input, Textarea, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Copy, Download, Eye, EyeOff, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { uid } from '@/lib/utils';
import { TIMEFRAMES, type AccountConfig, type AppSettings, type LlmProvider, type LlmProviderType, type RiskConfig } from '@/core/types';

export default function SettingsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState('general');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => j?.ok && setSettings(j.data.settings))
      .catch(() => undefined);
  }, []);

  if (!settings) return <div className="p-10 text-center text-sm text-gray-400">{t('common.loading')}</div>;

  const save = async (next: AppSettings) => {
    setSaving(true);
    setSettings(next);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const j = await res.json();
      if (j?.ok) {
        setSettings(j.data.settings);
        toast.success(t('settings.saved'));
      } else {
        toast.error(t('common.requestFailed'), j?.error);
      }
    } finally {
      setSaving(false);
    }
  };

  const patch = (p: Partial<AppSettings>) => setSettings((s) => (s ? { ...s, ...p } : s));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 p-3 md:p-5">
      <div>
        <h2 className="text-lg font-bold">{t('settings.title')}</h2>
        <p className="text-xs text-gray-400">{t('settings.subtitle')}</p>
      </div>

      <Tabs
        tabs={[
          { key: 'general', label: t('settings.tabGeneral') },
          { key: 'accounts', label: t('settings.tabAccounts'), badge: settings.accounts.length ? <Count n={settings.accounts.length} /> : undefined },
          { key: 'notifications', label: t('settings.tabNotifications') },
          { key: 'llm', label: t('settings.tabLlm'), badge: settings.llm.providers.length ? <Count n={settings.llm.providers.length} /> : undefined },
          { key: 'risk', label: t('settings.tabRisk') },
          { key: 'mcp', label: t('settings.tabMcp') },
          { key: 'security', label: t('settings.tabSecurity') },
          { key: 'data', label: t('settings.dataTab') },
          { key: 'about', label: t('settings.tabAbout') },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'general' && <GeneralTab settings={settings} patch={patch} save={save} saving={saving} />}
      {tab === 'accounts' && <AccountsTab settings={settings} patch={patch} save={save} saving={saving} />}
      {tab === 'notifications' && <NotificationsTab settings={settings} patch={patch} save={save} saving={saving} />}
      {tab === 'llm' && <LlmTab settings={settings} patch={patch} save={save} saving={saving} />}
      {tab === 'risk' && <RiskTab settings={settings} patch={patch} save={save} saving={saving} />}
      {tab === 'mcp' && <McpTab settings={settings} patch={patch} save={save} saving={saving} />}
      {tab === 'security' && <SecurityTab settings={settings} patch={patch} save={save} saving={saving} />}
      {tab === 'data' && <DataTab />}
      {tab === 'about' && (
        <Card className="space-y-3 p-5 text-sm leading-relaxed text-gray-600">
          <p>{t('settings.aboutText')}</p>
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">{t('settings.aboutDisclaimer')}</p>
          <p className="text-xs text-gray-400">DownTrade v1.0 · Next.js · Bitget v2 API · MCP 2024-11-05</p>
        </Card>
      )}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-2xs text-gray-500">{n}</span>;
}

type TabProps = {
  settings: AppSettings;
  patch: (p: Partial<AppSettings>) => void;
  save: (s: AppSettings) => Promise<void>;
  saving: boolean;
};

// ─── General ─────────────────────────────────────────────────────────────────

function GeneralTab({ settings, patch, save, saving }: TabProps) {
  const { t, setLocale } = useI18n();
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const g = settings.general;
  // Note: the topbar language switch is the immediate source of truth for the
  // session; the saved locale is applied here only on an explicit save below.

  return (
    <Card className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('settings.locale')}>
          <Select
            value={g.locale}
            onChange={(v) => {
              patch({ general: { ...g, locale: v as 'zh-CN' | 'en' } });
              setLocale(v as 'zh-CN' | 'en');
            }}
            options={[
              { value: 'zh-CN', label: '简体中文' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Field>
        <Field label={t('settings.upDownColor')}>
          <Select
            value={g.upDownColor}
            onChange={(v) => patch({ general: { ...g, upDownColor: v as 'auto' | 'red-up' | 'green-up' } })}
            options={[
              { value: 'auto', label: t('settings.upDownAuto') },
              { value: 'red-up', label: t('settings.redUp') },
              { value: 'green-up', label: t('settings.greenUp') },
            ]}
          />
        </Field>
        <Field label={t('settings.defaultSymbol')}>
          <Input value={g.defaultSymbol} onChange={(e) => patch({ general: { ...g, defaultSymbol: e.target.value.toUpperCase() } })} />
        </Field>
        <Field label={t('settings.defaultMarket')}>
          <Select
            value={g.defaultMarketType}
            onChange={(v) => patch({ general: { ...g, defaultMarketType: v as 'spot' | 'futures' } })}
            options={[
              { value: 'futures', label: t('markets.futures') },
              { value: 'spot', label: t('markets.spot') },
            ]}
          />
        </Field>
        <Field label={t('settings.defaultTf')}>
          <Select
            value={g.defaultTimeframe}
            onChange={(v) => patch({ general: { ...g, defaultTimeframe: v as (typeof TIMEFRAMES)[number] } })}
            options={TIMEFRAMES.map((tf) => ({ value: tf, label: tf.toUpperCase() }))}
          />
        </Field>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900">{t('settings.paperMode')}</div>
            <p className="mt-0.5 text-2xs leading-relaxed text-gray-500">{t('settings.paperModeHint')}</p>
          </div>
          <Switch checked={g.paperMode} onChange={(v) => patch({ general: { ...g, paperMode: v } })} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-amber-200/60 pt-3">
          <span className="text-2xs text-gray-500">{t('settings.paperResetHint')}</span>
          <Button size="xs" variant="outline" onClick={() => setResetOpen(true)}>
            <RotateCcw className="h-3 w-3" /> {t('settings.paperReset')}
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          loading={saving}
          onClick={() => {
            setLocale(g.locale);
            void save(settings);
          }}
        >
          {t('common.save')}
        </Button>
      </div>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={t('settings.paperReset')}
        text={t('settings.paperResetConfirm')}
        onConfirm={async () => {
          await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'paper.reset' }),
          });
          setResetOpen(false);
          toast.success(t('settings.saved'));
        }}
        confirmLabel={t('common.confirm')}
      />
    </Card>
  );
}
// ─── Accounts ────────────────────────────────────────────────────────────────

function AccountsTab({ settings, patch, save, saving }: TabProps) {
  const { t } = useI18n();
  const toast = useToast();
  const accounts = settings.accounts;
  const [showKey, setShowKey] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTarget = accounts.find((a) => a.id === deleteId);

  const update = (id: string, p: Partial<AccountConfig>) =>
    patch({ accounts: accounts.map((a) => (a.id === id ? { ...a, ...p } : a)) });

  const add = () =>
    patch({
      accounts: [
        ...accounts,
        { id: uid('acc_'), label: '', apiKey: '', apiSecret: '', passphrase: '', demoMode: false, active: accounts.length === 0, createdAt: Date.now() },
      ],
    });

  const test = async (id: string) => {
    await save(settings);
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'account.test', id }),
    });
    const j = await res.json();
    if (j?.data?.ok) toast.success(t('notif.account.test.ok', { label: accounts.find((a) => a.id === id)?.label ?? '' }));
    else toast.error(t('notif.account.test.fail', { reason: j?.data?.error ?? '' }));
  };

  const activate = async (id: string) => {
    await save(settings);
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'account.activate', id }),
    });
    const res = await fetch('/api/settings').then((r) => r.json());
    if (res?.ok) patch(res.data.settings);
    toast.success(t('settings.saved'));
  };

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-brand-50/60 px-3 py-2 text-2xs leading-relaxed text-brand-700">{t('settings.accountSecurity')}</p>
      {accounts.length === 0 && <Card className="p-5 text-sm text-gray-500">{t('settings.noAccounts')}</Card>}
      {accounts.map((a) => (
        <Card key={a.id} className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Input label={t('settings.accountLabel')} value={a.label} onChange={(e) => update(a.id, { label: e.target.value })} placeholder={t('settings.accountLabelPlaceholder')} className="flex-1" />
            {a.active && <Badge tone="up" className="mt-5">{t('settings.activeAccount')}</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label={t('settings.apiKey')}
              type={showKey ? 'text' : 'password'}
              value={a.apiKey}
              onChange={(e) => update(a.id, { apiKey: e.target.value })}
              suffix={
                <button
                  type="button"
                  aria-label={showKey ? t('settings.hideApiKey') : t('settings.showApiKey')}
                  title={showKey ? t('settings.hideApiKey') : t('settings.showApiKey')}
                  onClick={() => setShowKey((v) => !v)}
                  className="text-gray-400 transition-colors hover:text-gray-600"
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              }
            />
            <Input label={t('settings.apiSecret')} type="password" value={a.apiSecret} onChange={(e) => update(a.id, { apiSecret: e.target.value })} />
            <Input label={t('settings.passphrase')} type="password" value={a.passphrase} onChange={(e) => update(a.id, { passphrase: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <Switch checked={a.demoMode} onChange={(v) => update(a.id, { demoMode: v })} />
              {t('settings.demoMode')}
            </label>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => test(a.id)}>{t('settings.testConnection')}</Button>
              {!a.active && <Button size="sm" variant="outline" onClick={() => activate(a.id)}>{t('settings.setActive')}</Button>}
              <Button size="sm" variant="ghost" className="text-down" onClick={() => setDeleteId(a.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <p className="text-2xs text-gray-400">{t('settings.demoModeHint')}</p>
        </Card>
      ))}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={add}><Plus className="h-4 w-4" /> {t('settings.addAccount')}</Button>
        <Button loading={saving} onClick={() => save(settings)}>{t('common.save')}</Button>
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title={t('common.delete')}
        text={t('settings.deleteAccountConfirm', { label: deleteTarget?.label || deleteTarget?.id || '' })}
        onConfirm={() => {
          patch({ accounts: accounts.filter((x) => x.id !== deleteId) });
          setDeleteId(null);
        }}
        confirmLabel={t('common.delete')}
      />
    </div>
  );
}

// ─── Notifications ───────────────────────────────────────────────────────────

function NotificationsTab({ settings, patch, save, saving }: TabProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [vapidBusy, setVapidBusy] = useState(false);
  const [tgTesting, setTgTesting] = useState(false);
  const [whTesting, setWhTesting] = useState(false);
  const [wpTesting, setWpTesting] = useState(false);

  const subscribePush = async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const { webpush } = settings.notifications;
      if (!webpush.publicKey) {
        toast.error(t('common.requestFailed'), t('settings.webpushNeedKeys'));
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(atob(webpush.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
      });
      const res = await fetch('/api/notifications/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      if (res.ok) toast.success(t('settings.saved'));
    } catch (e) {
      toast.error(t('common.requestFailed'), String(e));
    }
  };
  const n = settings.notifications;
  const smtp = settings.smtp;

  const requestDesktop = async () => {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      patch({ notifications: { ...n, desktop: true } });
      new Notification('DownTrade', { body: t('settings.permissionGranted') });
    } else {
      toast.error(t('settings.permissionDenied'));
    }
  };

  const testSmtp = async () => {
    setSmtpTesting(true);
    try {
      await save(settings);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'smtp.test', smtp }),
      });
      const j = await res.json();
      if (j?.data?.ok) toast.success(t('settings.smtpTestSent'));
      else toast.error(t('notif.smtp.test.fail', { reason: j?.data?.error ?? '' }));
    } finally {
      setSmtpTesting(false);
    }
  };

  const testTelegram = async () => {
    setTgTesting(true);
    try {
      await save(settings);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'telegram.test', telegram: settings.notifications.telegram }),
      });
      const j = await res.json();
      if (j?.data?.ok) toast.success(t('settings.telegramTest'));
      else toast.error(t('settings.telegramTest'), j?.data?.error ?? '');
    } finally {
      setTgTesting(false);
    }
  };

  const testWebhook = async () => {
    setWhTesting(true);
    try {
      await save(settings);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'webhook.test', webhook: settings.notifications.webhook }),
      });
      const j = await res.json();
      if (j?.data?.ok) toast.success(t('settings.webhookTest'));
      else toast.error(t('settings.webhookTest'), j?.data?.error ?? '');
    } finally {
      setWhTesting(false);
    }
  };

  const testWebpush = async () => {
    setWpTesting(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'webpush.test' }),
      });
      const j = await res.json();
      if (j?.data?.ok) toast.success(t('settings.webpushTest'));
      else toast.error(t('settings.webpushTest'), j?.data?.error ?? '');
    } finally {
      setWpTesting(false);
    }
  };

  return (
    <Card className="space-y-5 p-5">
      <div className="space-y-3">
        {[
          { key: 'socket' as const, label: t('settings.notifSocket'), hint: '' },
          { key: 'desktop' as const, label: t('settings.notifDesktop'), hint: t('settings.notifDesktopHint') },
          { key: 'mail' as const, label: t('settings.notifMail'), hint: '' },
        ].map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900">{row.label}</div>
              {row.hint && <p className="text-2xs text-gray-400">{row.hint}</p>}
            </div>
            <div className="flex items-center gap-2">
              {row.key === 'desktop' && typeof Notification !== 'undefined' && Notification.permission !== 'granted' && (
                <Button size="xs" variant="outline" onClick={requestDesktop}>{t('settings.requestPermission')}</Button>
              )}
              <Switch checked={n[row.key]} onChange={(v) => patch({ notifications: { ...n, [row.key]: v } })} />
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
          <span className="text-sm text-gray-700">{t('settings.notifMinLevel')}</span>
          <Select
            className="w-36"
            value={n.minLevel}
            onChange={(v) => patch({ notifications: { ...n, minLevel: v as typeof n.minLevel } })}
            options={[
              { value: 'info', label: t('level.info') },
              { value: 'success', label: t('level.success') },
              { value: 'warning', label: t('level.warning') },
              { value: 'error', label: t('level.error') },
            ]}
          />
        </div>
      </div>

      <div className="space-y-3 border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Telegram</div>
          <Button size="xs" variant="outline" loading={tgTesting} onClick={testTelegram}>{t('settings.telegramTest')}</Button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600">{t('settings.telegramEnable')}</span>
          <Switch checked={settings.notifications.telegram.enabled} onChange={(v) => patch({ notifications: { ...settings.notifications, telegram: { ...settings.notifications.telegram, enabled: v } } })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('settings.telegramBotToken')} type="password" value={settings.notifications.telegram.botToken} onChange={(e) => patch({ notifications: { ...settings.notifications, telegram: { ...settings.notifications.telegram, botToken: e.target.value } } })} placeholder="123456:ABC-DEF..." />
          <Input label={t('settings.telegramChatId')} value={settings.notifications.telegram.chatId} onChange={(e) => patch({ notifications: { ...settings.notifications, telegram: { ...settings.notifications.telegram, chatId: e.target.value } } })} placeholder="-100123456789" />
          <div className="text-2xs text-gray-400 sm:col-span-2">Chat ID 支持逗号分隔多目标（私聊 + 频道同时推送）</div>
        </div>
      </div>

      <div className="space-y-3 border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Webhook</div>
          <Button size="xs" variant="outline" loading={whTesting} onClick={testWebhook}>{t('settings.webhookTest')}</Button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600">{t('settings.webhookEnable')}</span>
          <Switch checked={settings.notifications.webhook.enabled} onChange={(v) => patch({ notifications: { ...settings.notifications, webhook: { ...settings.notifications.webhook, enabled: v } } })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="URL" value={settings.notifications.webhook.url} onChange={(e) => patch({ notifications: { ...settings.notifications, webhook: { ...settings.notifications.webhook, url: e.target.value } } })} placeholder="https://your-server.com/signal" />
          <Input label={t('settings.webhookToken')} type="password" value={settings.notifications.webhook.token} onChange={(e) => patch({ notifications: { ...settings.notifications, webhook: { ...settings.notifications.webhook, token: e.target.value } } })} placeholder="Bearer token" />
          <div className="text-2xs text-gray-400 sm:col-span-2">{t('settings.webhookNote')}</div>
        </div>
      </div>

      <div className="space-y-3 border-t border-gray-100 pt-4">
        <div className="text-sm font-semibold">{t('settings.webpushTitle')}</div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-600">{t('settings.webpushEnable')}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" loading={vapidBusy} onClick={async () => {
              setVapidBusy(true);
              try {
                await save(settings);
                const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'webpush.generate' }) });
                const j = await res.json();
                if (j?.ok) {
                  const r2 = await fetch('/api/settings'); const j2 = await r2.json();
                  if (j2?.ok) patch(j2.data.settings);
                  toast.success(t('settings.saved'));
                }
              } finally { setVapidBusy(false); }
            }}>{t('settings.webpushGenerate')}</Button>
            <Button size="sm" variant="outline" onClick={subscribePush}>{t('settings.webpushSubscribe')}</Button>
            <Button size="sm" variant="outline" loading={wpTesting} onClick={testWebpush}>{t('settings.webpushTest')}</Button>
          </div>
        </div>
        <p className="text-2xs text-gray-400">{t('settings.webpushHint')}</p>
      </div>

      <div className="space-y-3 border-t border-gray-100 pt-4">
        <div className="text-sm font-semibold">{t('settings.tabNotifications')} · SMTP</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('settings.smtpHost')} value={smtp.host} onChange={(e) => patch({ smtp: { ...smtp, host: e.target.value } })} placeholder="smtp.gmail.com" />
          <Input label={t('settings.smtpPort')} inputMode="numeric" value={String(smtp.port)} onChange={(e) => patch({ smtp: { ...smtp, port: Number(e.target.value) || 465 } })} />
          <Input label={t('settings.smtpUser')} value={smtp.username} onChange={(e) => patch({ smtp: { ...smtp, username: e.target.value } })} />
          <Input label={t('settings.smtpPass')} type="password" value={smtp.password} onChange={(e) => patch({ smtp: { ...smtp, password: e.target.value } })} />
          <Input label={t('settings.smtpFrom')} value={smtp.from} onChange={(e) => patch({ smtp: { ...smtp, from: e.target.value } })} placeholder="downtrade@example.com" />
          <Input label={t('settings.smtpTo')} value={smtp.to} onChange={(e) => patch({ smtp: { ...smtp, to: e.target.value } })} placeholder="you@example.com" />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <Switch checked={smtp.secure} onChange={(v) => patch({ smtp: { ...smtp, secure: v } })} />
          {t('settings.smtpSecure')}
        </label>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" loading={smtpTesting} onClick={testSmtp}>{t('settings.smtpTest')}</Button>
        <Button loading={saving} onClick={() => save(settings)}>{t('common.save')}</Button>
      </div>
    </Card>
  );
}

// ─── LLM ─────────────────────────────────────────────────────────────────────

const PRESETS: Record<string, { name: string; baseURL: string; model: string; type: LlmProviderType }> = {
  openai: { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', type: 'openai-compatible' },
  deepseek: { name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', type: 'openai-compatible' },
  moonshot: { name: 'Moonshot', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', type: 'openai-compatible' },
  ollama: { name: 'Ollama', baseURL: 'http://localhost:11434/v1', model: 'llama3.1', type: 'openai-compatible' },
  claude: { name: 'Claude', baseURL: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514', type: 'anthropic' },
  gemini: { name: 'Gemini', baseURL: 'https://generativelanguage.googleapis.com', model: 'gemini-1.5-flash', type: 'gemini' },
};

function LlmTab({ settings, patch, save, saving }: TabProps) {
  const { t } = useI18n();
  const providers = settings.llm.providers;

  const update = (id: string, p: Partial<LlmProvider>) =>
    patch({ llm: { ...settings.llm, providers: providers.map((x) => (x.id === id ? { ...x, ...p } : x)) } });

  const addPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    patch({
      llm: {
        ...settings.llm,
        providers: [
          ...providers,
          { id: uid('llm_'), type: p.type, name: p.name, baseURL: p.baseURL, model: p.model, apiKey: '', enabled: true },
        ],
      },
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(PRESETS).map(([key, p]) => (
          <Button key={key} size="sm" variant="outline" onClick={() => addPreset(key)}>
            <Plus className="h-3 w-3" /> {p.name}
          </Button>
        ))}
      </div>

      {providers.map((p) => (
        <Card key={p.id} className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Input label={t('settings.providerName')} value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} className="flex-1" />
            <Badge tone={p.enabled ? 'up' : 'gray'} className="mt-5">{p.enabled ? t('common.enabled') : t('common.disabled')}</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('settings.providerType')}>
              <Select
                value={p.type}
                onChange={(v) => update(p.id, { type: v as LlmProviderType })}
                options={[
                  { value: 'openai-compatible', label: t('settings.typeOpenai') },
                  { value: 'anthropic', label: t('settings.typeAnthropic') },
                  { value: 'gemini', label: t('settings.typeGemini') },
                ]}
              />
            </Field>
            <Input label={t('settings.providerBaseURL')} hint={t('settings.providerBaseURLHint')} value={p.baseURL} onChange={(e) => update(p.id, { baseURL: e.target.value })} />
            <Input label={t('settings.apiKey')} type="password" value={p.apiKey} onChange={(e) => update(p.id, { apiKey: e.target.value })} />
            <Input label={t('settings.providerModel')} value={p.model} onChange={(e) => update(p.id, { model: e.target.value })} />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <Switch checked={p.enabled} onChange={(v) => update(p.id, { enabled: v })} />
              {t('settings.providerEnabled')}
            </label>
            <div className="flex gap-2">
              {settings.llm.activeProviderId !== p.id && (
                <Button size="sm" variant="outline" onClick={() => patch({ llm: { ...settings.llm, activeProviderId: p.id } })}>
                  {t('settings.setActiveProvider')}
                </Button>
              )}
              {settings.llm.activeProviderId === p.id && <Badge tone="brand" className="self-center">{t('settings.activeProvider')}</Badge>}
              <Button size="sm" variant="ghost" className="text-down" onClick={() => patch({ llm: { ...settings.llm, providers: providers.filter((x) => x.id !== p.id) } })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </Card>
      ))}

      <Card className="space-y-4 p-4">
        <Field label={t('settings.chatPrompt')} hint={t('settings.promptHint')}>
          <Textarea rows={4} value={settings.llm.chatSystemPrompt} onChange={(e) => patch({ llm: { ...settings.llm, chatSystemPrompt: e.target.value } })} />
        </Field>
        <Field label={t('settings.advicePrompt')} hint={t('settings.promptHint')}>
          <Textarea rows={6} value={settings.llm.adviceSystemPrompt} onChange={(e) => patch({ llm: { ...settings.llm, adviceSystemPrompt: e.target.value } })} />
        </Field>
        <Field label={`${t('settings.temperature')}: ${settings.llm.temperature}`}>
          <input
            type="range" min={0} max={1} step={0.1} value={settings.llm.temperature}
            onChange={(e) => patch({ llm: { ...settings.llm, temperature: Number(e.target.value) } })}
            className="w-full accent-brand-600"
          />
        </Field>
      </Card>

      <div className="flex justify-end">
        <Button loading={saving} onClick={() => save(settings)}>{t('common.save')}</Button>
      </div>
    </div>
  );
}

// ─── Risk ────────────────────────────────────────────────────────────────────

function RiskTab({ settings, patch, save, saving }: TabProps) {
  const { t } = useI18n();
  const toast = useToast();
  const r = settings.risk;
  // limits live as raw strings so 0 / empty / half-typed values stay editable;
  // '' means "rule disabled" (→ undefined server-side)
  const asStr = (v: number | undefined | null) => (v === undefined || v === null ? '' : String(v));
  const [orderUsd, setOrderUsd] = useState(String(r.maxOrderUsd));
  const [dailyLoss, setDailyLoss] = useState(asStr(r.maxDailyLossUsd));
  const [totalExposure, setTotalExposure] = useState(asStr(r.maxTotalExposureUsd));
  const [consecutiveLosses, setConsecutiveLosses] = useState(asStr(r.maxConsecutiveLosses));
  const [dailyMovePct, setDailyMovePct] = useState(asStr(r.maxDailyMovePct));
  const [killConfirm, setKillConfirm] = useState(false);
  const [resumeConfirm, setResumeConfirm] = useState(false);
  const [engineBusy, setEngineBusy] = useState(false);

  const refresh = async () => {
    const res = await fetch('/api/settings');
    const j = await res.json();
    if (j?.ok) patch(j.data.settings);
  };

  const callEngine = async (action: 'risk.pause' | 'risk.resume') => {
    setEngineBusy(true);
    try {
      const res = await fetch('/api/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = await res.json();
      if (j?.ok) {
        toast.success(t('settings.saved'));
        await refresh();
      } else {
        toast.error(t('common.requestFailed'), j?.error);
      }
    } finally {
      setEngineBusy(false);
    }
  };

  /** blur validation: normalize to a clean number string; garbage/empty collapses to '' */
  const normalize = (v: string, set: (s: string) => void) => {
    const trimmed = v.trim();
    if (trimmed === '') return set('');
    const n = Number(trimmed);
    set(Number.isFinite(n) ? String(n) : '');
  };

  /** '' → null so the backend can tell "clear this limit" apart from "leave unchanged" */
  const numOrNull = (v: string) => {
    const n = Number(v);
    return v.trim() === '' || !Number.isFinite(n) ? null : n;
  };

  const saveRisk = () => {
    const risk = {
      ...r,
      maxOrderUsd: Number(orderUsd) || 0,
      maxDailyLossUsd: numOrNull(dailyLoss),
      maxTotalExposureUsd: numOrNull(totalExposure),
      maxConsecutiveLosses: numOrNull(consecutiveLosses),
      maxDailyMovePct: numOrNull(dailyMovePct),
    } as RiskConfig;
    void save({ ...settings, risk });
  };

  return (
    <div className="space-y-3">
      <Card className="space-y-4 p-5">
        <Field label={t('settings.maxOrderUsd')} hint={t('settings.maxOrderUsdHint')}>
          <Input inputMode="decimal" value={orderUsd} onChange={(e) => setOrderUsd(e.target.value)} onBlur={() => normalize(orderUsd, setOrderUsd)} />
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700">{t('settings.confirmOrders')}</span>
          <Switch checked={r.confirmOrders} onChange={(v) => patch({ risk: { ...r, confirmOrders: v } })} />
        </div>
        <div className="flex justify-end">
          <Button loading={saving} onClick={saveRisk}>{t('common.save')}</Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="text-sm font-semibold">{t('settings.riskEngine')}</div>

        {r.halted && (
          <div className="rounded-lg border border-down/30 bg-down/5 px-3 py-2 text-xs leading-relaxed text-down">
            <span className="font-semibold">⛔ {t('settings.riskHalted')}</span>
            <span className="ml-2">{r.halted.reason}</span>
            <span className="ml-2 text-down/70">· {t('settings.riskHaltedAt')} {new Date(r.halted.ts).toLocaleString()}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-xl border border-down/20 bg-down/5 p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900">{t('settings.killSwitch')}</div>
            <p className="mt-0.5 text-2xs leading-relaxed text-gray-500">{t('settings.killSwitchDesc')}</p>
          </div>
          <Switch checked={r.killSwitch} onChange={(v) => { if (v) setKillConfirm(true); else setResumeConfirm(true); }} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settings.maxDailyLoss')}>
            <Input inputMode="decimal" value={dailyLoss} onChange={(e) => setDailyLoss(e.target.value)} onBlur={() => normalize(dailyLoss, setDailyLoss)} placeholder="—" />
          </Field>
          <Field label={t('settings.maxTotalExposure')}>
            <Input inputMode="decimal" value={totalExposure} onChange={(e) => setTotalExposure(e.target.value)} onBlur={() => normalize(totalExposure, setTotalExposure)} placeholder="—" />
          </Field>
          <Field label={t('settings.maxConsecutiveLosses')}>
            <Input inputMode="numeric" value={consecutiveLosses} onChange={(e) => setConsecutiveLosses(e.target.value)} onBlur={() => normalize(consecutiveLosses, setConsecutiveLosses)} placeholder="—" />
          </Field>
          <Field label={t('settings.maxDailyMovePct')}>
            <Input inputMode="decimal" value={dailyMovePct} onChange={(e) => setDailyMovePct(e.target.value)} onBlur={() => normalize(dailyMovePct, setDailyMovePct)} placeholder="—" />
          </Field>
        </div>

        <div className="flex justify-end">
          <Button loading={saving} onClick={saveRisk}>{t('common.save')}</Button>
        </div>

        <ConfirmDialog
          open={killConfirm}
          onClose={() => setKillConfirm(false)}
          title={t('settings.killSwitch')}
          text={t('settings.killSwitchConfirm')}
          onConfirm={async () => {
            setKillConfirm(false);
            await callEngine('risk.pause');
          }}
          confirmLabel={t('common.confirm')}
        />
        <ConfirmDialog
          open={resumeConfirm}
          onClose={() => setResumeConfirm(false)}
          title={t('settings.killSwitch')}
          text={t('settings.resumeConfirm')}
          danger={false}
          onConfirm={async () => {
            setResumeConfirm(false);
            await callEngine('risk.resume');
          }}
          confirmLabel={t('common.confirm')}
        />
      </Card>
    </div>
  );
}

// ─── MCP ─────────────────────────────────────────────────────────────────────

function McpTab({ settings, patch, save, saving }: TabProps) {
  const { t } = useI18n();
  const toast = useToast();
  const mcp = settings.mcp;
  const [origin, setOrigin] = useState('');

  React.useEffect(() => setOrigin(window.location.origin), []);

  const rotate = async () => {
    await save(settings);
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mcp.rotate' }),
    });
    const j = await res.json();
    if (j?.ok) patch({ mcp: { ...mcp, token: j.data.token } });
  };

  const clientConfig = JSON.stringify(
    {
      mcpServers: {
        downtrade: {
          type: 'http',
          url: `${origin}/api/mcp`,
          headers: mcp.token ? { Authorization: `Bearer <${t('settings.mcpToken')}>` } : undefined,
        },
      },
    },
    null,
    2,
  );

  const tools = [
    'get_ticker', 'list_tickers', 'get_candles', 'get_market_context', 'get_balance',
    'get_positions', 'get_open_orders', 'get_order_history', 'place_order', 'cancel_order',
    'list_strategies', 'create_strategy', 'toggle_strategy', 'run_backtest', 'ask_llm', 'get_signals',
  ];

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-brand-50/60 px-3 py-2 text-2xs leading-relaxed text-brand-700">{t('settings.mcpHint')}</p>
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('settings.mcpEnable')}</span>
          <Switch checked={mcp.enabled} onChange={(v) => patch({ mcp: { ...mcp, enabled: v } })} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-gray-600">{t('settings.mcpEndpoint')}</div>
            <code className="mt-0.5 block truncate rounded bg-gray-50 px-2 py-1 text-2xs text-gray-700">{origin}/api/mcp</code>
          </div>
          <Button size="xs" variant="outline" onClick={() => { void navigator.clipboard?.writeText(`${origin}/api/mcp`); toast.success(t('common.copied')); }}>
            <Copy className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-gray-600">{t('settings.mcpToken')}</div>
            <code className="mt-0.5 block truncate rounded bg-gray-50 px-2 py-1 text-2xs text-gray-700">{mcp.token || '—'}</code>
          </div>
          <Button size="xs" variant="outline" onClick={rotate}><RotateCcw className="h-3 w-3" /> {t('settings.mcpRotate')}</Button>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-gray-600">{t('settings.mcpClientConfig')}</div>
          <pre className="overflow-x-auto rounded-lg bg-gray-900 p-3 text-2xs leading-relaxed text-gray-100">{clientConfig}</pre>
          <div className="mt-2 flex justify-end">
            <Button size="xs" variant="outline" onClick={() => { void navigator.clipboard?.writeText(clientConfig); toast.success(t('common.copied')); }}>
              <Copy className="h-3 w-3" /> {t('settings.copyConfig')}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold">{t('settings.mcpTools')} ({tools.length})</div>
        <div className="flex flex-wrap gap-1.5">
          {tools.map((tool) => (
            <code key={tool} className="rounded bg-gray-100 px-1.5 py-0.5 text-2xs text-gray-600">{tool}</code>
          ))}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button loading={saving} onClick={() => save(settings)}>{t('common.save')}</Button>
      </div>
    </div>
  );
}

// ─── Security ────────────────────────────────────────────────────────────────

function SecurityTab({ settings, save }: TabProps) {
  const { t } = useI18n();
  const toast = useToast();
  const sec = settings.security;
  const [username, setUsername] = useState(sec.username);
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [totpSecret, setTotpSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [pin, setPin] = useState('');
  const [unlockCode, setUnlockCode] = useState('');
  const [busy, setBusy] = useState(false);
  // destructive actions are gated behind explicit confirmations
  const [disableOpen, setDisableOpen] = useState(false);
  const [totpDisableOpen, setTotpDisableOpen] = useState(false);
  const [totpDisableCode, setTotpDisableCode] = useState('');
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);

  const call = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return { status: res.status, j: await res.json() };
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    const res = await fetch('/api/settings');
    const j = await res.json();
    if (j?.ok) {
      // refresh just the security slice via a full settings pull
      window.location.reload();
    }
  };

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-brand-50/60 px-3 py-2 text-2xs leading-relaxed text-brand-700">{t('security.securityHint')}</p>

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('security.configure')}</span>
          <Badge tone={sec.enabled ? 'up' : 'gray'}>{sec.enabled ? t('common.enabled') : t('common.disabled')}</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('security.username')} value={username} onChange={(e) => setUsername(e.target.value)} />
          {sec.enabled && <Input label={t('security.currentPassword')} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />}
          <Input label={t('security.newPassword')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          {sec.enabled && (
            <Button variant="outline" loading={busy} onClick={() => setDisableOpen(true)}>{t('security.disableSecurity')}</Button>
          )}
          <Button loading={busy} onClick={async () => {
            const r = await call({ action: 'configure', username, password, currentPassword, device: localStorage.getItem('gt.device') ?? '', deviceLabel: navigator.platform || t('security.defaultDeviceLabel') });
            if (r.j?.ok) { toast.success(t('settings.saved')); refresh(); }
            else toast.error(t('common.requestFailed'), r.j?.error);
          }}>{t('security.configure')}</Button>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('security.setup2fa')}</span>
          <Badge tone={sec.totpEnabled ? 'up' : 'gray'}>{sec.totpEnabled ? t('security.enabled2fa') : t('common.disabled')}</Badge>
        </div>
        <p className="text-2xs text-gray-400">{t('security.setup2faHint')}</p>
        {!sec.totpEnabled && !totpSecret && (
          <Button size="sm" variant="outline" loading={busy} onClick={async () => {
            const r = await call({ action: 'totp.setup', password: currentPassword || password });
            if (r.j?.ok) setTotpSecret(r.j.data);
            else toast.error(t('common.requestFailed'), r.j?.error);
          }}>{t('security.setup2fa')}</Button>
        )}
        {totpSecret && !sec.totpEnabled && (
          <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <div>
              <div className="text-xs font-semibold text-gray-800">{t('security.qrStep1')}</div>
              <p className="mt-1 text-2xs leading-relaxed text-gray-500">{t('security.scanQrHint')}</p>
              <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-start">
                <div className="shrink-0 rounded-lg border border-gray-200 bg-white p-2.5">
                  <QRCodeSVG value={totpSecret.uri} size={148} level="M" />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="text-2xs text-gray-500">{t('security.manualEntry')}:</div>
                  <div className="flex items-center gap-1.5">
                    <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs">{totpSecret.secret}</code>
                    <Button size="xs" variant="outline" className="shrink-0" onClick={() => { void navigator.clipboard?.writeText(totpSecret.secret); toast.success(t('common.copied')); }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className="break-all font-mono text-2xs text-gray-300">{totpSecret.uri}</p>
                </div>
              </div>
            </div>
            <div className="border-t border-gray-200 pt-3">
              <div className="text-xs font-semibold text-gray-800">{t('security.qrStep2')}</div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Input label={t('security.totpCode')} value={totpCode} onChange={(e) => setTotpCode(e.target.value)} inputMode="numeric" maxLength={6} className="max-w-[140px]" />
                <Button loading={busy} onClick={async () => {
                  const r = await call({ action: 'totp.enable', code: totpCode });
                  if (r.j?.ok) { toast.success(t('settings.saved')); refresh(); }
                  else toast.error(t('common.requestFailed'), r.j?.error);
                }}>{t('security.verifyAndEnable')}</Button>
              </div>
            </div>
          </div>
        )}
        {sec.totpEnabled && (
          <Button size="sm" variant="outline" className="text-down" loading={busy} onClick={() => { setTotpDisableCode(''); setTotpDisableOpen(true); }}>{t('security.disable2fa')}</Button>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('security.setPin')}</span>
          <Badge tone={sec.pinLocked ? 'down' : sec.pinHash ? 'up' : 'gray'}>
            {sec.pinLocked ? t('security.pinLockedTitle') : sec.pinHash ? t('common.enabled') : t('common.disabled')}
          </Badge>
        </div>
        <p className="text-2xs leading-relaxed text-gray-400">{t('security.pinSetHint')}</p>
        <div className="flex items-end gap-2">
          <Input label={t('security.pin')} type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value)} className="max-w-[200px]" />
          <Button loading={busy} onClick={async () => {
            const r = await call({ action: 'pin.set', pin, password: currentPassword || password });
            if (r.j?.ok) { toast.success(t('settings.saved')); setPin(''); refresh(); }
            else toast.error(t('common.requestFailed'), r.j?.error);
          }}>{t('common.save')}</Button>
        </div>
        {sec.pinLocked && (
          <div className="flex items-end gap-2 rounded-lg bg-down/5 p-3">
            <Input label={t('security.totpCode')} value={unlockCode} onChange={(e) => setUnlockCode(e.target.value)} inputMode="numeric" maxLength={6} className="max-w-[160px]" />
            <Button loading={busy} onClick={async () => {
              const r = await call({ action: 'pin.unlock', code: unlockCode });
              if (r.j?.ok) { toast.success(t('security.pinUnlocked')); refresh(); }
              else toast.error(t('common.requestFailed'), r.j?.error);
            }}>{t('security.unlock')}</Button>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <div className="text-sm font-medium">{t('security.devicesTitle')} ({sec.devices.length})</div>
        <div className="space-y-1.5">
          {sec.devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
              <span className="truncate text-gray-700">{d.label} <span className="text-gray-400">{d.id.slice(0, 12)}</span></span>
              <Button size="xs" variant="outline" onClick={() => setRevokeId(d.id)}>{t('security.revoke')}</Button>
            </div>
          ))}
          {!sec.devices.length && <p className="text-2xs text-gray-400">{t('common.empty')}</p>}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setLogoutAllOpen(true)}>{t('security.logoutAll')}</Button>
        </div>
      </Card>

      <ConfirmDialog
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title={t('security.disableSecurity')}
        text={t('common.deleteConfirmText')}
        onConfirm={async () => {
          const r = await call({ action: 'disable', password: currentPassword });
          if (r.j?.ok) { setDisableOpen(false); toast.success(t('settings.saved')); refresh(); }
          else toast.error(t('common.requestFailed'), r.j?.error);
        }}
        loading={busy}
        confirmLabel={t('common.confirm')}
      />

      <ConfirmDialog
        open={totpDisableOpen}
        onClose={() => { setTotpDisableOpen(false); setTotpDisableCode(''); }}
        title={t('security.disable2fa')}
        onConfirm={async () => {
          const r = await call({ action: 'totp.disable', password: currentPassword || password, code: totpDisableCode });
          if (r.j?.ok) { setTotpDisableOpen(false); refresh(); }
          else toast.error(t('common.requestFailed'), r.j?.error);
        }}
        loading={busy}
        confirmLabel={t('common.confirm')}
      >
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-gray-600">{t('settings.totpDisablePrompt')}</p>
          <Input label={t('security.totpCode')} value={totpDisableCode} onChange={(e) => setTotpDisableCode(e.target.value)} inputMode="numeric" maxLength={6} className="max-w-[140px]" />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={revokeId !== null}
        onClose={() => setRevokeId(null)}
        title={t('security.revoke')}
        text={t('common.deleteConfirmText')}
        onConfirm={async () => {
          const r = await call({ action: 'device.revoke', id: revokeId, password: currentPassword || password });
          if (r.j?.ok) { setRevokeId(null); refresh(); }
          else toast.error(t('common.requestFailed'), r.j?.error);
        }}
        loading={busy}
        confirmLabel={t('common.confirm')}
      />

      <ConfirmDialog
        open={logoutAllOpen}
        onClose={() => setLogoutAllOpen(false)}
        title={t('security.logoutAll')}
        text={t('common.deleteConfirmText')}
        onConfirm={async () => {
          const r = await call({ action: 'logout-all' });
          if (r.j?.ok) window.location.reload();
          else toast.error(t('common.requestFailed'), r.j?.error);
        }}
        confirmLabel={t('common.confirm')}
      />
    </div>
  );
}

// ─── Data ────────────────────────────────────────────────────────────────────

type DataScope = 'backtests' | 'events' | 'equity';

function DataTab() {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [clearScope, setClearScope] = useState<DataScope | null>(null);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  const exportData = async () => {
    setBusy(true);
    try {
      const j = await post({ action: 'data.export' });
      if (!j?.ok) {
        toast.error(t('common.requestFailed'), j?.error);
        return;
      }
      const blob = new Blob([JSON.stringify(j.data.export, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `downtrade-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('settings.exportDone'));
    } finally {
      setBusy(false);
    }
  };

  const clearData = async (scope: DataScope) => {
    setBusy(true);
    try {
      const j = await post({ action: 'data.clear', scope });
      if (j?.ok) toast.success(t('settings.saved'));
      else toast.error(t('common.requestFailed'), j?.error);
    } finally {
      setBusy(false);
      setClearScope(null);
    }
  };

  const clearTargets: { scope: DataScope; label: string }[] = [
    { scope: 'backtests', label: t('settings.clearBacktests') },
    { scope: 'events', label: t('settings.clearEvents') },
    { scope: 'equity', label: t('settings.clearEquity') },
  ];

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900">{t('settings.exportData')}</div>
            <p className="mt-0.5 text-2xs leading-relaxed text-gray-500">{t('settings.exportDataDesc')}</p>
          </div>
          <Button size="sm" variant="outline" loading={busy} onClick={exportData}>
            <Download className="h-3.5 w-3.5" /> {t('settings.exportData')}
          </Button>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="text-sm font-medium text-gray-900">{t('settings.dataTab')}</div>
        <p className="text-2xs leading-relaxed text-gray-500">{t('settings.clearDataDesc')}</p>
        <div className="flex flex-wrap gap-2">
          {clearTargets.map((x) => (
            <Button key={x.scope} size="sm" variant="outline" className="text-down" disabled={busy} onClick={() => setClearScope(x.scope)}>
              <Trash2 className="h-3.5 w-3.5" /> {x.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-2xs leading-relaxed text-gray-400">{t('settings.dataDir')}: data/ · JSON</p>
      </Card>

      <ConfirmDialog
        open={clearScope !== null}
        onClose={() => setClearScope(null)}
        title={clearTargets.find((x) => x.scope === clearScope)?.label}
        text={t('settings.clearDataDesc')}
        onConfirm={() => {
          if (clearScope) void clearData(clearScope);
        }}
        confirmLabel={t('common.confirm')}
      />
    </div>
  );
}
