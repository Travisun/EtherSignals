import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { settingsRepo, strategiesRepo, botsRepo, eventsRepo, equityRepo } from '@/server/store/repos';
import { getStore } from '@/server/store/jsonStore';
import { getRuntime } from '@/server/engine/runtime';
import { ok, errorResponse } from '@/server/api/helpers';
import { notify, sendMail, sendTelegram, testWebhook } from '@/server/events/notifier';
import { logAudit } from '@/server/store/pg';
import { testAccount } from '@/server/engine/accountService';
import { guard } from '@/server/security/guard';
import { renderNotif } from '@/server/i18n/notifyTexts';
import { uid } from '@/lib/utils';
import type { AccountConfig, AppSettings, SmtpConfig } from '@/core/types';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** mask sentinel the UI echoes back verbatim; unmask() restores the stored value */
const MASKED = '••••••••';

function secureToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function maskSettings(s: AppSettings): AppSettings {
  // short secrets must be fully masked (first4+last4 would leak everything)
  const mask = (v: string) => (!v ? '' : v.length < 12 ? MASKED : `${v.slice(0, 4)}••••${v.slice(-4)}`);
  return {
    ...s,
    accounts: s.accounts.map((a) => ({
      ...a,
      apiKey: mask(a.apiKey),
      apiSecret: a.apiSecret ? MASKED : '',
      passphrase: a.passphrase ? MASKED : '',
    })),
    smtp: { ...s.smtp, password: s.smtp.password ? MASKED : '' },
    notifications: {
      ...s.notifications,
      telegram: { ...s.notifications.telegram, botToken: s.notifications.telegram.botToken ? MASKED : '' },
      webhook: { ...s.notifications.webhook, token: s.notifications.webhook.token ? MASKED : '' },
      webpush: {
        ...s.notifications.webpush,
        privateKey: s.notifications.webpush.privateKey ? MASKED : '',
        // subscription endpoint + auth keys are credentials — never echo them back
        subscriptions: (s.notifications.webpush.subscriptions ?? []).map((sub) => {
          let host = '…';
          try {
            host = `${new URL(sub.endpoint).host}/…`;
          } catch {
            // malformed endpoint — mask fully
          }
          return { ...sub, endpoint: sub.endpoint ? host : '', keys: {} as { p256dh: string; auth: string } };
        }),
      },
    },
    llm: {
      ...s.llm,
      providers: s.llm.providers.map((p) => ({ ...p, apiKey: mask(p.apiKey) })),
    },
    mcp: { ...s.mcp, token: s.mcp.token ? `${s.mcp.token.slice(0, 6)}••••` : '' },
    security: {
      ...s.security,
      passwordHash: s.security.passwordHash ? 'set' : '',
      pinHash: s.security.pinHash ? 'set' : '',
      totpSecret: s.security.totpSecret ? 'set' : '',
      devices: s.security.devices.map((d) => ({ ...d, id: d.id.length > 10 ? `${d.id.slice(0, 6)}…${d.id.slice(-4)}` : d.id })),
    },
  };
}

/** Restore masked secrets from the stored settings (mask sentinel = unchanged). */
function unmask(incoming: AppSettings, stored: AppSettings): AppSettings {
  const wasMasked = (v: string) => v.includes('••••');
  const wasHidden = (v: string) => v === MASKED;
  const st = stored.notifications;
  const inc = incoming.notifications;
  return {
    ...incoming,
    accounts: incoming.accounts.map((a) => {
      const orig = stored.accounts.find((x) => x.id === a.id);
      return {
        ...a,
        apiKey: a.apiKey && !wasMasked(a.apiKey) ? a.apiKey : orig?.apiKey ?? '',
        apiSecret: a.apiSecret && !wasHidden(a.apiSecret) ? a.apiSecret : orig?.apiSecret ?? '',
        passphrase: a.passphrase && !wasHidden(a.passphrase) ? a.passphrase : orig?.passphrase ?? '',
      };
    }),
    smtp: {
      ...incoming.smtp,
      password: incoming.smtp.password && !wasHidden(incoming.smtp.password)
        ? incoming.smtp.password
        : stored.smtp.password,
    },
    notifications: {
      ...inc,
      telegram: {
        ...inc.telegram,
        botToken: inc.telegram.botToken === MASKED
          ? st.telegram.botToken
          : inc.telegram.botToken ?? st.telegram.botToken,
      },
      webhook: {
        ...inc.webhook,
        token: inc.webhook.token === MASKED
          ? st.webhook.token
          : inc.webhook.token ?? st.webhook.token,
      },
      webpush: {
        ...inc.webpush,
        privateKey: inc.webpush.privateKey === MASKED ? st.webpush.privateKey : inc.webpush.privateKey ?? st.webpush.privateKey,
        // client cannot reconstruct subscriptions — always keep the stored ones
        subscriptions: st.webpush.subscriptions ?? [],
      },
    },
    llm: {
      ...incoming.llm,
      providers: incoming.llm.providers.map((p) => {
        const orig = stored.llm.providers.find((x) => x.id === p.id);
        return { ...p, apiKey: p.apiKey && !wasMasked(p.apiKey) ? p.apiKey : orig?.apiKey ?? '' };
      }),
    },
    mcp: {
      ...incoming.mcp,
      token: incoming.mcp.token && !String(incoming.mcp.token).includes('••••')
        ? incoming.mcp.token
        : stored.mcp.token,
    },
    security: stored.security,
  };
}

export async function GET(req: NextRequest) {
  {
    const denied = await guard(req);
    if (denied) return denied;
  }
  try {
    const s = settingsRepo.get();
    return ok({ settings: maskSettings(s) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: NextRequest) {
  const denied = await guard(req, { pin: true });
  if (denied) return denied;
  try {
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > MAX_BODY_BYTES) return errorResponse(new Error('payload too large (max 2MB)'));
    const body = (await req.json()) as Partial<AppSettings>;
    const stored = settingsRepo.get();
    // deep-merge the partial body over stored settings, then restore secrets
    const incoming: AppSettings = {
      ...stored,
      ...body,
      general: { ...stored.general, ...(body.general ?? {}) },
      smtp: { ...stored.smtp, ...(body.smtp ?? {}) },
      notifications: { ...stored.notifications, ...(body.notifications ?? {}) },
      llm: { ...stored.llm, ...(body.llm ?? {}) },
      risk: { ...stored.risk, ...(body.risk ?? {}) },
      mcp: { ...stored.mcp, ...(body.mcp ?? {}) },
      onboarding: { ...stored.onboarding, ...(body.onboarding ?? {}) },
    };
    const merged = unmask(incoming, stored);

    // optional risk limits: null (cleared in the UI) means "rule disabled"
    const risk = { ...merged.risk };
    for (const k of ['maxDailyLossUsd', 'maxTotalExposureUsd', 'maxConsecutiveLosses', 'maxDailyMovePct'] as const) {
      if ((risk[k] ?? null) === null) risk[k] = undefined;
    }
    merged.risk = risk;

    // assign ids / defaults for new entries
    merged.accounts = merged.accounts.map((a) => ({
      ...a,
      id: a.id || uid('acc_'),
      createdAt: a.createdAt || Date.now(),
    }));
    merged.llm.providers = merged.llm.providers.map((p) => ({ ...p, id: p.id || uid('llm_') }));
    if (!merged.mcp.token) {
      merged.mcp.token = secureToken();
    }
    // only one active account
    const activeIdx = merged.accounts.findIndex((a) => a.active);
    merged.accounts = merged.accounts.map((a, i) => ({ ...a, active: i === activeIdx }));

    settingsRepo.save(merged);

    const fingerprint = (accounts: AccountConfig[]) =>
      JSON.stringify(accounts.map((a) => [a.id, a.active, a.demoMode, a.apiKey, a.passphrase]));
    const accountChanged = fingerprint(merged.accounts) !== fingerprint(stored.accounts);
    if (accountChanged) {
      await getRuntime().onAccountChanged();
    }

    notify('settings.saved', undefined, { level: 'success', channel: 'system', silentSocket: true });
    logAudit({ category: 'system', action: 'settings.update', level: 'info', payload: { keys: Object.keys(body ?? {}) } });
    return ok({ settings: maskSettings(merged) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Sub-actions: smtp/telegram/webpush tests, account test/activate, mcp rotate, data export/clear. */
export async function POST(req: NextRequest) {
  const denied = await guard(req, { pin: true });
  if (denied) return denied;
  try {
    const body = await req.json();
    const action = String(body.action ?? '');
    const settings = settingsRepo.get();
    const locale = settings.general.locale;

    if (action === 'smtp.test') {
      const smtp = body.smtp as SmtpConfig;
      try {
        const saved = settingsRepo.get().smtp;
        if (smtp && !smtp.password?.includes('••••')) settingsRepo.update({ smtp });
        await sendMail(
          '[DownTrade] SMTP Test / SMTP 测试',
          renderNotif('smtp.test.ok', undefined, locale),
        );
        return ok({ ok: true });
      } catch (e) {
        return ok({ ok: false, error: (e as Error).message });
      }
    }

    if (action === 'account.test') {
      const id = String(body.id);
      const result = await testAccount(id);
      // client already toasts the outcome; record + mail only
      notify(result.ok ? 'account.test.ok' : 'account.test.fail',
        result.ok
          ? { label: settings.accounts.find((a) => a.id === id)?.label ?? id }
          : { reason: result.error ?? 'unknown error' },
        { level: result.ok ? 'success' : 'error', channel: 'system', silentSocket: true });
      return ok(result);
    }

    if (action === 'account.activate') {
      const id = String(body.id);
      const accounts = settings.accounts.map((a) => ({ ...a, active: a.id === id }));
      settingsRepo.save({ ...settings, accounts });
      await getRuntime().onAccountChanged();
      notify('account.switched', { label: accounts.find((a) => a.id === id)?.label ?? id }, { level: 'success' });
      return ok({ ok: true });
    }

    if (action === 'mcp.rotate') {
      const token = secureToken();
      settingsRepo.update({ mcp: { ...settings.mcp, token } });
      return ok({ token });
    }

    if (action === 'webpush.generate') {
      const w = await import('web-push');
      const keys = w.default.generateVAPIDKeys();
      settingsRepo.update({
        notifications: {
          ...settingsRepo.get().notifications,
          webpush: { ...settingsRepo.get().notifications.webpush, publicKey: keys.publicKey, privateKey: keys.privateKey, enabled: true },
        },
      });
      return ok({ publicKey: keys.publicKey });
    }

    if (action === 'paper.reset') {
      const { paperRepo } = await import('@/server/store/repos');
      paperRepo.reset(Number(body.initial) || undefined);
      return ok({ ok: true });
    }

    if (action === 'telegram.test') {
      const tg = body.telegram as { enabled?: boolean; botToken?: string; chatId?: string } | undefined;
      try {
        const saved = settingsRepo.get().notifications.telegram;
        // a masked token echo means "unchanged" → restore the stored secret (same pattern as smtp.test)
        const botToken = tg?.botToken && !tg.botToken.includes('••••') ? tg.botToken : saved.botToken;
        const chatId = tg?.chatId ?? saved.chatId;
        if (tg) settingsRepo.update({ notifications: { ...settingsRepo.get().notifications, telegram: { ...saved, ...tg, botToken, chatId } } });
        if (!botToken || !chatId) throw new Error('botToken / chatId required');
        await sendTelegram('DownTrade test ok ✅');
        notify('telegram.test.ok', undefined, { level: 'success', channel: 'system', silentSocket: true });
        return ok({ ok: true });
      } catch (e) {
        notify('telegram.test.fail', { reason: (e as Error).message }, { level: 'error', channel: 'system', silentSocket: true });
        return ok({ ok: false, error: (e as Error).message });
      }
    }

    if (action === 'webhook.test') {
      const wh = body.webhook as { enabled?: boolean; url?: string; token?: string } | undefined;
      try {
        const saved = settingsRepo.get().notifications.webhook;
        const url = wh?.url && !wh.url.includes('••••') ? wh.url : saved.url;
        const token = wh?.token && !wh.token.includes('••••') ? wh.token : saved.token;
        if (wh) settingsRepo.update({ notifications: { ...settingsRepo.get().notifications, webhook: { ...saved, ...wh, token, url } } });
        if (!url || !token) throw new Error('url / token required');
        await testWebhook(url, token);
        notify('webhook.test.ok', undefined, { level: 'success', channel: 'system', silentSocket: true });
        return ok({ ok: true });
      } catch (e) {
        notify('webhook.test.fail', { reason: (e as Error).message }, { level: 'error', channel: 'system', silentSocket: true });
        return ok({ ok: false, error: (e as Error).message });
      }
    }

    if (action === 'webpush.test') {
      const cfg = settingsRepo.get().notifications.webpush;
      const subs = cfg.subscriptions ?? [];
      if (!subs.length) return ok({ ok: false, error: 'no subscriptions' });
      const w = await import('web-push');
      w.default.setVapidDetails('mailto:downtrade@local', cfg.publicKey, cfg.privateKey);
      const dead: string[] = [];
      let sent = 0;
      await Promise.all(
        subs.map(async (sub) => {
          try {
            await w.default.sendNotification(sub, JSON.stringify({ title: 'DownTrade', body: 'WebPush test' }));
            sent += 1;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) dead.push(sub.endpoint);
          }
        }),
      );
      if (dead.length) {
        settingsRepo.update({
          notifications: {
            ...settingsRepo.get().notifications,
            webpush: { ...cfg, subscriptions: cfg.subscriptions.filter((s) => !dead.includes(s.endpoint)) },
          },
        });
      }
      if (!sent) return ok({ ok: false, error: 'delivery failed for all endpoints' });
      notify('webpush.test.ok', undefined, { level: 'success', channel: 'system', silentSocket: true });
      return ok({ ok: true });
    }

    if (action === 'data.export') {
      // maskSettings is mandatory — exports must never contain plaintext credentials
      const exportData = {
        settings: maskSettings(settingsRepo.get()),
        strategies: strategiesRepo.list(),
        bots: botsRepo.list(),
        events: eventsRepo.list(),
        exportedAt: new Date().toISOString(),
      };
      logAudit({ category: 'system', action: 'data.export', level: 'info' });
      return ok({ export: exportData });
    }

    if (action === 'data.clear') {
      const scope = String(body.scope ?? '');
      if (scope === 'backtests') getStore().write('backtests', []);
      else if (scope === 'events') eventsRepo.clear();
      else if (scope === 'equity') equityRepo.clear();
      else return errorResponse(new Error(`unknown scope: ${scope || '(empty)'}`));
      logAudit({ category: 'system', action: 'data.clear', level: 'warning', payload: { scope } });
      return ok({ ok: true });
    }

    return errorResponse(new Error(`unknown action: ${action}`));
  } catch (e) {
    return errorResponse(e);
  }
}
