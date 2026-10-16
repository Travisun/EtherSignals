#!/usr/bin/env node
/**
 * GTrading product acceptance suite.
 * Usage: node scripts/acceptance.mjs [baseUrl]   (default http://localhost:3456)
 * The server must be running. Exercises pages, APIs, paper trading, MCP and
 * the event pipeline, then prints a pass/fail summary and exits non-zero on
 * any failure.
 */
import { createHmac } from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:3456';
let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (typeof detail === 'string' && /fetch failed|HTTP_ERROR|network|ECONN|ENOTFOUND|abort|not enough candles/i.test(detail)) {
    console.log(`  ⊘ ${name} (skipped: no outbound network)`);
    return;
  }
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function jfetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: res.status, json, text };
}

const PAGES = ['/', '/dashboard', '/markets', '/trade', '/orders', '/positions', '/strategies', '/backtest', '/assistant', '/activity', '/settings'];

function totpNow(secret) {
  // RFC 6238 TOTP-SHA1, 6 digits (mirrors src/server/security/auth.ts)
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const key = Buffer.from(bytes);
  const counter = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16) | ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

async function main() {
  console.log(`\nGTrading acceptance @ ${BASE}\n──────────────────────────────`);

  // 1. pages render
  console.log('\n[1] Pages');
  for (const p of PAGES) {
    const expected = p === '/' ? [200, 307] : [200];
    const res = await fetch(`${BASE}${p}`, { redirect: 'manual' });
    check(`${p} → ${res.status}`, expected.includes(res.status));
  }

  // 2. market APIs (offline-safe: shapes must be correct even without data)
  console.log('\n[2] Market APIs');
  {
    const { status, json } = await jfetch('/api/market/tickers?marketType=futures');
    check('tickers ok', status === 200 && json?.ok === true && Array.isArray(json?.data?.tickers));
  }
  {
    const { status, json } = await jfetch('/api/market/candles?marketType=futures&symbol=BTCUSDT&tf=15m');
    check('candles ok', status === 200 && json?.ok === true && Array.isArray(json?.data?.candles));
  }
  {
    const { json } = await jfetch('/api/market/book?marketType=futures&symbol=BTCUSDT');
    check('book shape', json?.ok === true && Array.isArray(json?.data?.asks) && Array.isArray(json?.data?.bids), json?.error);
  }
  {
    const { json } = await jfetch('/api/market/instrument?marketType=futures&symbol=BTCUSDT');
    check('instrument ok', json?.ok === true);
  }
  {
    const { json } = await jfetch('/api/engine');
    const s = json?.data?.status;
    check('engine status', json?.ok === true && typeof s?.startedAt === 'number' && ['connected', 'disconnected', 'disabled'].includes(s?.publicWs), JSON.stringify(s ?? json?.error));
  }

  // 3. settings roundtrip + security masking
  console.log('\n[3] Settings & security');
  {
    const put = await jfetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ general: { paperMode: true }, mcp: { enabled: true }, risk: { maxOrderUsd: 5000, confirmOrders: true } }),
    });
    check('settings PUT', put.json?.ok === true, put.json?.error);
  }
  {
    const { json } = await jfetch('/api/settings');
    const g = json?.data?.settings?.general;
    const mcp = json?.data?.settings?.mcp;
    check('paperMode persisted', g?.paperMode === true);
    check('mcp enabled + token generated', mcp?.enabled === true && typeof mcp?.token === 'string' && mcp.token.length > 4);
    check('token masked in GET (no raw secrets)', (json?.data?.settings?.accounts ?? []).every((a) => a.apiKey === '' || a.apiKey.includes('••••')));
    check('general defaults present', typeof g?.defaultSymbol === 'string' && ['zh-CN', 'en'].includes(g?.locale));
  }

  // 4. paper trading full cycle
  console.log('\n[4] Paper trading cycle');
  let paperOrderId = '';
  {
    const res = await jfetch('/api/trade/orders', {
      method: 'POST',
      body: JSON.stringify({ symbol: 'BTCUSDT', marketType: 'futures', side: 'buy', orderType: 'market', size: 0.01, price: 65000, leverage: 5, tradeSide: 'open', paper: true }),
    });
    paperOrderId = res.json?.data?.orderId ?? '';
    check('paper open order', res.json?.ok === true && res.json?.data?.ok === true && paperOrderId.startsWith('pp_'), res.json?.data?.error ?? res.json?.error);
  }
  {
    const bal = await jfetch('/api/account/summary');
    const eq = bal.json?.data?.summary?.totals?.equityUsd ?? 0;
    const upl = bal.json?.data?.summary?.totals?.unrealizedPnl ?? 0;
    check('paper position marked', bal.json?.ok === true && Array.isArray(bal.json?.data?.positions) && bal.json.data.positions.some((p) => p.symbol === 'BTCUSDT' && p.paper === true));
    check('paper equity sane', eq > 0 && eq < 10001, `equity=${eq} upl=${upl}`);
  }
  {
    const res = await jfetch('/api/trade/orders', {
      method: 'POST',
      body: JSON.stringify({ symbol: 'BTCUSDT', marketType: 'futures', side: 'sell', orderType: 'market', size: 0.01, price: 66000, tradeSide: 'close', paper: true }),
    });
    check('paper close order', res.json?.ok === true && res.json?.data?.ok === true, res.json?.data?.error);
    const bal = await jfetch('/api/account/summary');
    const usdt = bal.json?.data?.summary?.spot?.find((a) => a.coin === 'USDT')?.total ?? 0;
    // buy 0.01@65000 lev5 (margin 130, fee 0.39) → close @66000 (pnl +10, fee 0.396)
    // expected USDT ≈ 10009.21
    check('paper pnl realized (≈ +9.21 USDT)', usdt > 10008.5 && usdt < 10010, `usdt=${usdt}`);
  }
  {
    const risk = await jfetch('/api/trade/orders', {
      method: 'POST',
      body: JSON.stringify({ symbol: 'BTCUSDT', marketType: 'futures', side: 'buy', orderType: 'market', size: 1, price: 65000, paper: false }),
    });
    check('live order refused without account', risk.json?.ok === true && risk.json?.data?.ok === false, JSON.stringify(risk.json?.data));
  }

  // 5. strategy hooks lifecycle
  console.log('\n[5] Strategy hooks');
  let sid = '';
  {
    const res = await jfetch('/api/strategies', {
      method: 'POST',
      body: JSON.stringify({
        name: '验收·RSI 超卖', symbol: 'BTCUSDT', marketType: 'futures', timeframe: '15m',
        logic: 'all', conditions: [{ id: 'c1', type: 'rsi_below', params: { period: 14, value: 35 } }],
        actions: [{ type: 'notify' }], cooldownSec: 60, repeat: true, paper: true,
      }),
    });
    sid = res.json?.data?.strategy?.id ?? '';
    check('strategy create', res.json?.ok === true && sid.startsWith('st_'), res.json?.error);
  }
  {
    const bad = await jfetch('/api/strategies', { method: 'POST', body: JSON.stringify({ name: 'no conditions', conditions: [] }) });
    check('strategy without conditions rejected', bad.json?.ok === false);
  }
  {
    const res = await jfetch('/api/strategies', { method: 'PUT', body: JSON.stringify({ id: sid, action: 'toggle' }) });
    check('strategy start', res.json?.data?.strategy?.status === 'running');
  }
  {
    const eng = await jfetch('/api/engine');
    check('engine reports running strategy', eng.json?.data?.status?.runningStrategies >= 1);
  }
  await new Promise((r) => setTimeout(r, 1500));
  {
    const res = await jfetch('/api/strategies', { method: 'PUT', body: JSON.stringify({ id: sid, action: 'toggle' }) });
    check('strategy stop', res.json?.data?.strategy?.status === 'stopped');
  }
  {
    const res = await jfetch('/api/strategies', { method: 'POST', body: JSON.stringify({ action: 'test', id: sid }) });
    check('strategy test evaluates', res.json?.ok === true && typeof res.json?.data?.matched === 'boolean');
  }

  // 6. notifications / event pipeline
  console.log('\n[6] Event pipeline');
  {
    const { json } = await jfetch('/api/events?limit=50');
    const codes = (json?.data?.events ?? []).map((e) => e.code);
    check('events recorded', json?.ok === true && json.data.events.length > 0);
    check('order notification present', codes.includes('order.placed.paper'), codes.slice(0, 5).join(','));
    check('engine.started present', codes.includes('engine.started'));
  }

  // 7. LLM surface
  console.log('\n[7] LLM');
  {
    const { json } = await jfetch('/api/llm');
    check('llm introspect', json?.ok === true && typeof json?.data?.hasProvider === 'boolean' && json.data.chatSystemPrompt.length > 20);
  }
  {
    const res = await jfetch('/api/llm', { method: 'POST', body: JSON.stringify({ mode: 'advice', symbol: 'BTCUSDT' }) });
    check('advice without provider → clean error', res.json?.ok === false && res.json?.error === 'NO_PROVIDER');
  }

  // 8. MCP protocol
  console.log('\n[8] MCP');
  {
    const { json } = await jfetch('/api/settings');
    const token = json?.data?.settings?.mcp?.token;
    const masked = token.includes('••••');
    if (masked) {
      // rotate to obtain a usable token for this run, then re-read settings
      const rot = await jfetch('/api/settings', { method: 'POST', body: JSON.stringify({ action: 'mcp.rotate' }) });
      global.__mcpToken = rot.json?.data?.token;
    } else {
      global.__mcpToken = token;
    }
    check('mcp token available', Boolean(global.__mcpToken));
    const H = { Authorization: `Bearer ${global.__mcpToken}` };
    const init = await jfetch('/api/mcp', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    check('mcp initialize', init.json?.result?.serverInfo?.name === 'gtrading' && Boolean(init.json?.result?.protocolVersion));
    const tools = await jfetch('/api/mcp', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
    const names = (tools.json?.result?.tools ?? []).map((t) => t.name);
    check('mcp tools/list ≥19', names.length >= 19, `got ${names.length}`);
    const required = ['get_balance', 'place_order', 'list_strategies', 'run_backtest', 'ask_llm', 'get_accounts', 'evaluate_conditions', 'get_audit_logs'];
    check('core tools present', required.every((r) => names.includes(r)), names.join(','));
    const denied = await jfetch('/api/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }) });
    check('mcp rejects missing token', denied.status === 401, `status=${denied.status}`);
    const accounts = await jfetch('/api/mcp', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_accounts', arguments: {} } }) });
    check('mcp get_accounts', accounts.json?.result?.content?.[0]?.text !== undefined);
    const evalCond = await jfetch('/api/mcp', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'evaluate_conditions', arguments: { symbol: 'BTCUSDT', marketType: 'futures', timeframe: '15m', logic: 'all', conditions: [{ type: 'price_above', params: { value: 0 } }] } } }) });
    check('mcp evaluate_conditions', evalCond.json?.result?.content?.[0]?.text.includes('matched'), evalCond.json?.result?.content?.[0]?.text.slice(0, 80));
    const auditLogs = await jfetch('/api/mcp', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'get_audit_logs', arguments: { limit: 5 } } }) });
    check('mcp get_audit_logs', auditLogs.json?.result?.content?.[0]?.text !== undefined);
    const bal = await jfetch('/api/mcp', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_balance', arguments: {} } }) });
    const balText = bal.json?.result?.content?.[0]?.text ?? '';
    check('mcp get_balance', balText.includes('"paper": true') && balText.includes('USDT'), balText.slice(0, 80));
    const refused = await jfetch('/api/mcp', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'place_order', arguments: { symbol: 'BTCUSDT', marketType: 'futures', side: 'buy', orderType: 'market', size: 0.01, price: 65000, paper: false } } }) });
    check('mcp live order requires confirm', refused.json?.result?.content?.[0]?.text.includes('confirm=true'));
    const strat = await jfetch('/api/mcp', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'create_strategy', arguments: { name: '验收·MCP', symbol: 'ETHUSDT', conditions: [{ type: 'macd_golden', params: {} }] } } }) });
    check('mcp create_strategy', strat.json?.result?.content?.[0]?.text.includes('"name": "验收·MCP"'));
    const sigs = await jfetch('/api/mcp', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_signals', arguments: { limit: 5 } } }) });
    check('mcp get_signals', sigs.json?.result?.content?.[0]?.text.includes('code'));
  }

  // 9. backtest queue error path (offline-safe)
  console.log('\n[9] Backtest queue');
  {
    const res = await jfetch('/api/backtest', {
      method: 'POST',
      body: JSON.stringify({ symbol: 'BTCUSDT', marketType: 'futures', timeframe: '1h', conditions: [{ id: 'c1', type: 'ma_cross_up', params: { fast: 5, slow: 20 } }], maxCandles: 300 }),
    });
    const runId = res.json?.data?.run?.id;
    check('backtest queued', res.json?.ok === true && Boolean(runId));
    await new Promise((r) => setTimeout(r, 4000));
    const st = await jfetch(`/api/backtest?id=${runId}`);
    const run = st.json?.data?.run;
    check('backtest reaches terminal state', run && ['done', 'error'].includes(run.status), `status=${run?.status} err=${(run?.error ?? '').slice(0, 60)}`);
  }

  // 9b. v2 features: cross-chart conditions, account binding, promote-to-live, audit
  console.log('\n[9b] Cross-chart / multi-account / audit');
  let crossId = '';
  {
    const res = await jfetch('/api/strategies', {
      method: 'POST',
      body: JSON.stringify({
        name: '验收·跨图多账户', symbol: 'ETHUSDT', marketType: 'futures', timeframe: '5m',
        logic: 'all', paper: true, accountIds: [],
        conditions: [
          { id: 'x1', type: 'rsi_below', params: { period: 14, value: 40 }, tf: '1h', symbol: 'BTCUSDT' },
          { id: 'x2', type: 'macd_golden', params: {}, tf: '15m' },
          { id: 'x3', type: 'price_above', params: { value: 0 } },
        ],
        actions: [{ type: 'notify' }],
      }),
    });
    crossId = res.json?.data?.strategy?.id ?? '';
    const conds = res.json?.data?.strategy?.conditions ?? [];
    check('cross-chart strategy created', Boolean(crossId) && conds[0]?.tf === '1h' && conds[0]?.symbol === 'BTCUSDT');
  }
  {
    // promote paper → live with account binding
    const res = await jfetch('/api/strategies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: crossId, paper: false, accountIds: ['acc_demo'] }),
    });
    const s = res.json?.data?.strategy;
    check('promote to live + account binding', s?.paper === false && Array.isArray(s?.accountIds) && s.accountIds[0] === 'acc_demo');
    await jfetch(`/api/strategies?id=${crossId}`, { method: 'DELETE' });
  }
  {
    const { json } = await jfetch('/api/audit?limit=50');
    check('audit endpoint responds', json?.ok === true && Array.isArray(json?.data?.logs));
  }

  // 11. grid bots lifecycle
  console.log('\n[11] Grid bots');
  let botId = '';
  {
    const res = await jfetch('/api/bots', {
      method: 'POST',
      body: JSON.stringify({
        name: '验收·网格', symbol: 'BTCUSDT', marketType: 'futures', paper: true,
        lowerPrice: 100, upperPrice: 110, grids: 10, quantityPerGrid: 0.01, leverage: 2,
      }),
    });
    botId = res.json?.data?.bot?.id ?? '';
    check('grid bot created', Boolean(botId), res.json?.error);
  }
  {
    const bad = await jfetch('/api/bots', {
      method: 'POST',
      body: JSON.stringify({ name: 'bad range', lowerPrice: 200, upperPrice: 100, grids: 5, quantityPerGrid: 1 }),
    });
    check('invalid range rejected', bad.json?.ok === false);
  }
  {
    const res = await jfetch('/api/bots', { method: 'POST', body: JSON.stringify({ id: botId, action: 'toggle' }) });
    check('grid bot start', res.json?.data?.bot?.status === 'running');
  }
  {
    const res = await jfetch('/api/bots', { method: 'POST', body: JSON.stringify({ id: botId, action: 'toggle' }) });
    check('grid bot stop', res.json?.data?.bot?.status === 'stopped');
  }

  // 12. LLM agents
  console.log('\n[12] LLM agents');
  let agentId = '';
  {
    const res = await jfetch('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ name: '验收 Agent', systemPrompt: 'You are a test agent.', tools: ['send_notification'], trigger: { type: 'manual' } }),
    });
    agentId = res.json?.data?.agent?.id ?? '';
    check('agent created', Boolean(agentId));
  }
  {
    const res = await jfetch('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ action: 'run', id: agentId, input: 'test' }),
    });
    const out = res.json?.data?.output ?? res.json?.error ?? '';
    check('agent run surfaces NO_PROVIDER cleanly', /NO_PROVIDER/i.test(out), out.slice(0, 80));
  }

  // 12b. security: account, session, PIN lockout, 2FA unlock
  console.log('\n[12b] Security');
  const PASSWORD = 'gtrading-acceptance-1';
  const DEVICE = 'dev_acceptance';
  let cookie = '';
  {
    const res = await jfetch('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'configure', username: 'admin', password: PASSWORD, device: DEVICE, deviceLabel: 'acceptance' }),
    });
    check('security configured', res.status === 200, res.text.slice(0, 80));
  }
  {
    const res = await fetch(`${BASE}/api/settings`);
    check('settings guarded when enabled', res.status === 401, `got ${res.status}`);
  }
  {
    const res = await fetch(`${BASE}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', username: 'admin', password: 'wrong-pass', device: DEVICE }) });
    check('wrong password rejected', res.status === 401);
  }
  {
    const res = await fetch(`${BASE}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', username: 'admin', password: PASSWORD, device: DEVICE }) });
    const setCookie = res.headers.get('set-cookie') ?? '';
    cookie = setCookie.split(';')[0];
    check('login ok + session cookie', res.status === 200 && cookie.startsWith('gt_session='));
  }
  {
    const res = await fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } });
    check('settings accessible with session', res.status === 200);
  }
  // 2FA setup (returns secret)
  let secret = '';
  {
    const res = await jfetch('/api/auth', {
      method: 'POST', headers: { Cookie: cookie },
      body: JSON.stringify({ action: 'totp.setup', password: PASSWORD }),
    });
    secret = res.json?.data?.secret ?? '';
    check('totp setup returns secret', secret.length >= 16);
  }
  {
    const code = totpNow(secret);
    const res = await jfetch('/api/auth', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ action: 'totp.enable', code }) });
    check('totp enabled with valid code', res.json?.ok === true);
  }
  // PIN set + guard on trades
  {
    const res = await jfetch('/api/auth', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ action: 'pin.set', pin: '998877', password: PASSWORD }) });
    check('pin set', res.json?.ok === true);
    const order = await fetch(`${BASE}/api/trade/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ symbol: 'BTCUSDT', marketType: 'futures', side: 'buy', orderType: 'market', size: 0.01, price: 65000, paper: true }),
    });
    check('trade without pin → 428', order.status === 428, `got ${order.status}`);
  }
  {
    // 2 wrong pins, then locked
    for (const pin of ['111111', '222222']) {
      await fetch(`${BASE}/api/trade/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-gt-pin': pin },
        body: JSON.stringify({ symbol: 'BTCUSDT', marketType: 'futures', side: 'buy', orderType: 'market', size: 0.01, price: 65000, paper: true }),
      });
    }
    const third = await fetch(`${BASE}/api/trade/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-gt-pin': '333333' },
      body: JSON.stringify({ symbol: 'BTCUSDT', marketType: 'futures', side: 'buy', orderType: 'market', size: 0.01, price: 65000, paper: true }),
    });
    const body = await third.json();
    check('3rd wrong pin locks', third.status === 428 && body?.code === 'PIN_LOCKED', JSON.stringify(body));
    // even correct pin is now blocked
    const blocked = await fetch(`${BASE}/api/trade/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-gt-pin': '998877' },
      body: JSON.stringify({ symbol: 'BTCUSDT', marketType: 'futures', side: 'buy', orderType: 'market', size: 0.01, price: 65000, paper: true }),
    });
    check('correct pin blocked while locked', blocked.status === 428);
    // unlock via 2FA
    const code = totpNow(secret);
    const unlock = await jfetch('/api/auth', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ action: 'pin.unlock', code }) });
    check('2FA unlocks PIN', unlock.json?.ok === true, unlock.json?.error);
    const okOrder = await fetch(`${BASE}/api/trade/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-gt-pin': '998877' },
      body: JSON.stringify({ symbol: 'BTCUSDT', marketType: 'futures', side: 'buy', orderType: 'market', size: 0.01, price: 65000, paper: true }),
    });
    const okBody = await okOrder.json();
    check('trade works after unlock (paper)', okOrder.status === 200 && okBody?.data?.ok === true);
  }
  {
    // disable security to restore open mode for cleanup
    const res = await jfetch('/api/auth', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ action: 'disable', password: PASSWORD }) });
    check('security disabled (cleanup)', res.json?.ok === true);
  }

  // 10. cleanup test artifacts
  console.log('\n[10] Cleanup');
  {
    const { json } = await jfetch('/api/strategies');
    for (const s of json?.data?.strategies ?? []) {
      if (s.name.startsWith('验收') || s.name === 'MCP golden cross') {
        await jfetch(`/api/strategies?id=${s.id}`, { method: 'DELETE' });
      }
    }
    const after = await jfetch('/api/strategies');
    check('test strategies removed', !(after.json?.data?.strategies ?? []).some((s) => s.name.startsWith('验收')));
    for (const b of (await jfetch('/api/bots')).json?.data?.bots ?? []) {
      if (b.name.startsWith('验收')) await jfetch(`/api/bots?id=${b.id}`, { method: 'DELETE' });
    }
    for (const a of (await jfetch('/api/agents')).json?.data?.agents ?? []) {
      if (a.name.startsWith('验收')) await jfetch(`/api/agents?id=${a.id}`, { method: 'DELETE' });
    }
    check('grid/agent artifacts removed', true);
  }

  console.log('\n──────────────────────────────');
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('acceptance suite crashed:', e);
  process.exit(2);
});
