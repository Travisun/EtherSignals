import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Agent as HttpAgent } from 'http';

/**
 * Exchange egress helper. In restricted regions the Node process usually
 * cannot reach api.bitget.com directly while the user's browser goes through
 * a system VPN — Node's fetch does NOT honor OS proxy settings. Setting the
 * standard HTTPS_PROXY / HTTP_PROXY / NO_PROXY environment variables routes
 * ALL exchange traffic (REST + WebSocket) through the given proxy.
 */

const PROBE_URL = 'https://api.bitget.com/api/v2/public/time';

function proxyUrl(): string | null {
  return (
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy ||
    null
  );
}

let dispatcher: EnvHttpProxyAgent | null | undefined;

function getDispatcher(): EnvHttpProxyAgent | null {
  if (dispatcher !== undefined) return dispatcher;
  const proxy = proxyUrl();
  if (!proxy) {
    dispatcher = null;
    return null;
  }
  const d = new EnvHttpProxyAgent();
  dispatcher = d;
  console.log(`[proxy] exchange traffic routed via ${proxy}`);
  void probeExchange(d, proxy);
  return d;
}

/** true when a proxy env var is configured */
export function proxyConfigured(): boolean {
  return getDispatcher() !== null;
}

/** the proxy URL from the environment (for actionable error messages) */
export function currentProxyUrl(): string | null {
  return proxyUrl();
}

/**
 * One-shot startup verification that the configured proxy actually reaches
 * the exchange. A dead proxy (app not running / wrong port) otherwise only
 * shows up later as silent blank charts and NETWORK errors.
 */
async function probeExchange(d: EnvHttpProxyAgent, proxy: string): Promise<void> {
  const t0 = Date.now();
  try {
    const res = await undiciFetch(PROBE_URL, { dispatcher: d, signal: AbortSignal.timeout(8_000) });
    const j = (await res.json().catch(() => ({}))) as { code?: string };
    if (j.code === '00000') {
      console.log(`[proxy] OK — api.bitget.com reachable via ${proxy} (${Date.now() - t0}ms)`);
    } else {
      console.warn(`[proxy] ${proxy} connected but the exchange replied code=${j.code} — check the proxy rules cover api.bitget.com`);
    }
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : '';
    const msg = e instanceof Error ? e.message : String(e);
    if (/ECONNREFUSED|connect/i.test(cause || msg)) {
      console.warn(
        `[proxy] ${proxy} 拒绝连接 (ECONNREFUSED) — 代理软件未运行或端口不对。` +
        `macOS 实际端口用 scutil --proxy 查看（Clash Verge 默认 7897，旧版 Clash 为 7890）`,
      );
    } else {
      console.warn(`[proxy] probe via ${proxy} failed: ${cause || msg}`);
    }
  }
}

type ExchangeInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  cache?: 'no-store';
};

/** fetch for exchange traffic — honors HTTPS_PROXY when configured */
export async function exchangeFetch(url: string, init?: ExchangeInit): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }> {
  const d = getDispatcher();
  if (d) {
    const res = await undiciFetch(url, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
      dispatcher: d,
    });
    return res;
  }
  return globalThis.fetch(url, {
    method: init?.method,
    headers: init?.headers,
    body: init?.body,
    signal: init?.signal,
    cache: init?.cache,
  });
}

/** options for the `ws` client so Bitget WebSocket traffic uses the proxy too */
export function wsAgentOptions(): { agent?: HttpAgent } {
  const proxy = proxyUrl();
  if (!proxy) return {};
  try {
    return { agent: new HttpsProxyAgent(proxy) as unknown as HttpAgent };
  } catch {
    return {};
  }
}
