import './env.mjs';
import { createServer } from 'http';
import crypto from 'crypto';
import next from 'next';
import { Server } from 'socket.io';

const port = parseInt(process.env.PORT || '3000', 10);
// Trading system: default to loopback only. Set HOST=0.0.0.0 explicitly for
// LAN/container exposure (then put it behind a TLS reverse proxy).
const host = process.env.HOST || '127.0.0.1';
const dev = process.env.NODE_ENV !== 'production';
const dir = process.cwd();

// Shared with route handlers in the same process — proves "the server itself
// is calling", browsers cannot attach this header cross-origin (no CORS).
const bootSecret = crypto.randomBytes(24).toString('hex');
globalThis.__gtBootSecret = bootSecret;

const app = next({ dev, dir });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  // stamp the real socket address; route handlers must never trust a
  // client-supplied x-forwarded-for for rate limiting
  try {
    req.headers['x-gt-client-ip'] = req.socket.remoteAddress || 'local';
  } catch {
    // ignore
  }
  // surface handler failures in production: a silent 500 with an empty log
  // is the worst failure mode to debug on a headless box
  handle(req, res).catch((e) => {
    console.error(`[handle error] ${req.method} ${req.url}`, e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('internal error');
    }
  });
});

const io = new Server(httpServer, {
  path: '/ws',
  // same-origin only: the workbench is served from this server, so browser
  // clients either send no Origin or this host's origin
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // native ws clients / same-origin fetches
      try {
        const o = new URL(origin);
        const h = o.hostname;
        const local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
        const lanAllowed = process.env.GT_EXTRA_ORIGINS?.split(',').filter(Boolean) ?? [];
        cb(null, local || lanAllowed.includes(origin));
      } catch {
        cb(null, false);
      }
    },
  },
  transports: ['websocket', 'polling'],
});

globalThis.__gtIo = io;

// Socket handshake auth: once the app's security layer is enabled, only
// browsers holding a valid session cookie may subscribe to account/position/
// order/notification broadcasts. Verified via the internal-only engine API.
io.use(async (socket, next) => {
  try {
    const cookie = socket.handshake.headers.cookie ?? '';
    const session = /(?:^|;\s*)gt_session=([^;]+)/.exec(cookie)?.[1];
    if (!session) return next(); // security may be disabled — routes guard themselves
    const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      headers: { cookie: `gt_session=${session}`, 'x-gt-internal': bootSecret },
    }).catch(() => undefined);
    if (!res || !res.ok) return next(); // auth route unavailable → don't lock out local users
    const body = await res.json().catch(() => undefined);
    if (body?.data?.enabled && !body?.data?.authed) {
      return next(new Error('auth required'));
    }
    next();
  } catch {
    next(); // fail-open for local-first single-user mode
  }
});

io.on('connection', (socket) => {
  socket.emit('hello', { ts: Date.now() });
});

httpServer.listen(port, host, () => {
  console.log(`> GTrading ready on http://localhost:${port} (${dev ? 'development' : 'production'}, bound ${host})`);
  // Warm up the trading engine (Bitget streams, rule engine) via the API.
  fetch(`http://127.0.0.1:${port}/api/engine`, { headers: { 'x-gt-internal': bootSecret } }).catch(() => undefined);
});

// ─── graceful shutdown: stop engines → flush stores → exit ──────────────────
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received — graceful shutdown`);
  try {
    await fetch(`http://127.0.0.1:${port}/api/engine`, {
      method: 'POST',
      headers: { 'x-gt-internal': bootSecret, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'shutdown' }),
    }).catch(() => undefined);
  } finally {
    io.close();
    httpServer.close(() => process.exit(0));
    // hard exit watchdog in case open sockets block close()
    setTimeout(() => process.exit(0), 3000).unref();
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// The engine also lazy-boots from any API route (see src/server/engine/runtime.ts).
