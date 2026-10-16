// Standalone connectivity probe: verifies that the local proxy (Clash) can
// carry BOTH the Bitget REST endpoint and the v2 public WebSocket.
//   node scripts/ws-probe.mjs
import '../env.mjs';
import WebSocket from 'ws';
import { exchangeFetch, wsAgentOptions } from '../src/server/bitget/proxy.ts';

const PROBE_REST = 'https://api.bitget.com/api/v2/public/time';
const PROBE_WS = 'wss://ws.bitget.com/v2/ws/public';

async function restProbe() {
  const t0 = Date.now();
  const res = await exchangeFetch(PROBE_REST, {});
  const j = (await res.json());
  if (j.code !== '00000') throw new Error(`REST code=${j.code}`);
  console.log(`[probe] REST  OK  ${Date.now() - t0}ms  serverTime=${j.data?.serverTime}`);
}

function wsProbe(timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(PROBE_WS, wsAgentOptions());
    let gotPong = false;
    let gotData = false;
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`timeout — pong=${gotPong} candle=${gotData}`));
    }, timeoutMs);
    const done = () => {
      if (gotPong && gotData) {
        clearTimeout(timer);
        ws.close();
        console.log('[probe] WS    OK  ping/pong + candle1m frame received');
        resolve();
      }
    };
    ws.on('open', () => {
      console.log('[probe] WS    open —', PROBE_WS);
      ws.send(JSON.stringify({ op: 'subscribe', args: [{ instType: 'USDT-FUTURES', channel: 'candle1m', instId: 'ETHUSDT' }] }));
      ws.send('ping');
    });
    ws.on('message', (raw) => {
      const text = raw.toString();
      if (text === 'pong') {
        gotPong = true;
        done();
        return;
      }
      try {
        const msg = JSON.parse(text);
        if (msg.event === 'subscribe') {
          console.log('[probe] WS    subscribed:', JSON.stringify(msg.arg));
        } else if (msg.arg?.channel === 'candle1m') {
          gotData = true;
          console.log('[probe] WS    candle frame:', text.slice(0, 140), '…');
          done();
        } else if (msg.event === 'error') {
          clearTimeout(timer);
          reject(new Error(`ws error: ${msg.msg}`));
        }
      } catch { /* ignore */ }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

try {
  await restProbe();
  await wsProbe();
  console.log('[probe] ALL OK — proxy carries Bitget REST + WebSocket');
  process.exit(0);
} catch (e) {
  console.error('[probe] FAILED:', e.message);
  process.exit(1);
}
