import nodemailer from 'nodemailer';
import { settingsRepo } from '@/server/store/repos';
import { queue } from './queue';
import { renderNotif, LEVEL_RANK } from '@/server/i18n/notifyTexts';
import { eventsRepo } from '@/server/store/repos';
import { logAudit, type AuditEntry } from '@/server/store/pg';
import { bus, Events } from './bus';
import { uid } from '@/lib/utils';
import { exchangeFetch } from '@/server/bitget/proxy';
import type { AppEvent, EventLevel, SocketNotification } from '@/core/types';

export interface NotifyOptions {
  level?: EventLevel;
  channel?: string;
  strategyId?: string;
  data?: unknown;
  /** skip socket push (used when pushing manually) */
  silentSocket?: boolean;
}

function auditCategory(channel: string, fromStrategy: boolean): AuditEntry['category'] {
  if (channel === 'strategy') return 'strategy';
  if (channel === 'grid') return 'grid';
  if (channel === 'trade') return fromStrategy ? 'strategy' : 'manual';
  if (channel === 'llm') return 'llm';
  if (channel === 'backtest') return 'backtest';
  return 'system';
}

/** chat targets — comma-separated chatIds are supported (private + channel) */
export function telegramTargets(): string[] {
  const { telegram } = settingsRepo.get().notifications;
  if (!telegram?.enabled || !telegram.botToken || !telegram.chatId) return [];
  return telegram.chatId.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Send one text to every configured target; fails only if ALL targets fail.
 *  `codeBlock` wraps the text in a fenced block (Markdown parse mode) so
 *  column-aligned boards keep their shape — Telegram has no table syntax. */
export async function sendTelegram(text: string, opts?: { codeBlock?: boolean }): Promise<void> {
  const targets = telegramTargets();
  if (!targets.length) throw new Error('telegram not configured');
  const { telegram } = settingsRepo.get().notifications;
  const body = opts?.codeBlock ? '```\n' + text + '\n```' : text;
  const payload: Record<string, unknown> = { chat_id: '', text: body };
  if (opts?.codeBlock) payload.parse_mode = 'Markdown';
  let lastErr: unknown = null;
  for (const chatId of targets) {
    try {
      // api.telegram.org is blocked in some regions — go through the configured
      // proxy (HTTPS_PROXY) like all other exchange/external traffic
      payload.chat_id = chatId;
      const res = await exchangeFetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`telegram http ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
}

/** structured push to a remote webhook with Bearer-token auth.
 *  Only trend boards go out — the channel consumers want signals, not noise. */
function dispatchWebhook(code: string, data: unknown, text: string) {
  if (code !== 'signal.trend') return;
  const { webhook } = settingsRepo.get().notifications;
  if (!webhook?.enabled || !webhook.url || !webhook.token) return;
  const payload = {
    type: code,
    ts: Date.now(),
    message: text,
    ...(data && typeof data === 'object' ? data : {}),
  };
  queue.push(
    'webhook',
    payload,
    async (p) => {
      const cfg = settingsRepo.get().notifications.webhook;
      const res = await exchangeFetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
        body: JSON.stringify(p),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`webhook http ${res.status}`);
    },
    { retries: 1, onError: () => console.error('[notify] webhook delivery failed') },
  );
}

/** one-shot webhook test against arbitrary url/token (settings test button).
 *  Sends a schema-compliant sample so strict consumers accept it. */
export async function testWebhook(url: string, token: string): Promise<void> {
  const res = await exchangeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      type: 'signal.trend',
      ts: Date.now(),
      symbol: 'ETHUSDT',
      marketType: 'futures',
      price: 0,
      timeframe: '5m',
      regime: 'neutral',
      score: 0,
      signals: [{ tf: '5m', regime: 'neutral', score: 0, prob: null, patterns: [] }],
      levels: null,
      nhnl: {
        price: 0,
        donN: 20,
        rows: [{
          tf: '5m', barTime: 0, barHigh: 0, barLow: 0, nh: true, nl: false,
          prevHigh: null, prevLow: null, brkUp: false, brkDown: false,
          donHigh: null, donLow: null, donUp: false, donDown: false,
          distHighPct: 0, distLowPct: 0,
        }],
      },
      message: 'DownTrade webhook test',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`webhook http ${res.status}`);
}

function dispatchTelegram(code: string, text: string, level: EventLevel) {
  // the channel is a public signal feed: only trend boards go out — tuning
  // reports, rollbacks and other system dynamics stay in-app
  if (code !== 'signal.trend') return;
  const { telegram } = settingsRepo.get().notifications;
  if (!telegram?.enabled || !telegram.botToken || !telegram.chatId) return;
  queue.push(
    'telegram',
    { text, level },
    async (p) => {
      await sendTelegram(p.text, { codeBlock: code === 'signal.trend' });
    },
    { retries: 1, onError: () => console.error('[notify] telegram delivery failed') },
  );
}

function dispatchWebPush(text: string, level: EventLevel) {
  const { webpush } = settingsRepo.get().notifications;
  if (!webpush?.enabled || !webpush.subscriptions?.length) return;
  queue.push(
    'webpush',
    { text, level },
    async (p) => {
      const w = await import('web-push');
      const cfg = settingsRepo.get().notifications.webpush;
      w.default.setVapidDetails('mailto:downtrade@local', cfg.publicKey, cfg.privateKey);
      const dead: string[] = [];
      await Promise.all(
        cfg.subscriptions.map(async (sub) => {
          try {
            await w.default.sendNotification(sub, JSON.stringify({ title: 'DownTrade', body: p.text, tag: p.level }));
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
    },
    { retries: 0, onError: () => console.error('[notify] web-push delivery failed') },
  );
}

function getIo(): import('socket.io').Server | undefined {
  return (globalThis as { __gtIo?: import('socket.io').Server }).__gtIo;
}

async function sendMail(subject: string, body: string) {
  const { smtp } = settingsRepo.get();
  if (!smtp.enabled || !smtp.host || !smtp.to) return;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
  });
  await transporter.sendMail({
    from: smtp.from || smtp.username,
    to: smtp.to,
    subject,
    text: body,
  });
}

/**
 * Central notification dispatcher — the analogue of Laravel's Notification
 * fan-out: persists to the event log, broadcasts over the socket, and
 * dispatches mail through the retry queue.
 */
export function notify(code: string, params?: Record<string, string | number>, opts: NotifyOptions = {}) {
  const settings = settingsRepo.get();
  const level = opts.level ?? 'info';
  const ev: AppEvent = {
    id: uid('ev_'),
    ts: Date.now(),
    level,
    code,
    params,
    channel: opts.channel ?? 'system',
    strategyId: opts.strategyId,
  };
  eventsRepo.append(ev);
  bus.emit(Events.NOTIFICATION, ev);

  // durable audit trail (PostgreSQL when configured; no-op otherwise)
  logAudit({
    category: auditCategory(ev.channel, Boolean(opts.strategyId)),
    action: code,
    level,
    strategyId: opts.strategyId ?? null,
    symbol: typeof params?.symbol === 'string' ? params.symbol : null,
    payload: params ?? null,
    result: level === 'error' ? 'fail' : 'ok',
  });

  const socketPayload: SocketNotification = {
    id: ev.id, ts: ev.ts, level, code, params, channel: ev.channel, strategyId: ev.strategyId,
  };

  if (settings.notifications.socket !== false && !opts.silentSocket) {
    const io = getIo();
    io?.emit('notification', socketPayload);
  }

  // extra channels (each queued; failures never break trading)
  const text = renderNotif(code, params, settings.general.locale);
  dispatchTelegram(ev.code, text, level);
  void dispatchWebhook(ev.code, opts.data, text);
  dispatchWebPush(text, level);

  const shouldMail =
    settings.notifications.mail &&
    settings.smtp.enabled &&
    LEVEL_RANK[level] >= LEVEL_RANK[settings.notifications.minLevel];

  if (shouldMail) {
    const locale = settings.general.locale;
    queue.push(
      'mail',
      { code, params, locale, level },
      async (p) => {
        const text = renderNotif(p.code, p.params, p.locale);
        const prefix = '[DownTrade]';
        await sendMail(`${prefix} ${text}`, `${text}\n\n— DownTrade · ${new Date().toLocaleString(p.locale)}`);
      },
      {
        onError: () => {
          // mail failure is logged only; never breaks the trading flow
          console.error('[mail] delivery failed permanently');
        },
      },
    );
  }
  return ev;
}

export { sendMail };
