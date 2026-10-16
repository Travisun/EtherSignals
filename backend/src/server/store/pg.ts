import { Pool, type PoolClient } from 'pg';

/**
 * Optional PostgreSQL audit trail (docker-compose provides the database).
 * Local-first: when DATABASE_URL is unset — or the database is unreachable —
 * every call degrades to a no-op and the JSON event log keeps working.
 */

export interface AuditEntry {
  category: 'manual' | 'strategy' | 'grid' | 'system' | 'mcp' | 'llm' | 'backtest';
  action: string;
  level?: string;
  accountId?: string | null;
  strategyId?: string | null;
  symbol?: string | null;
  payload?: unknown;
  result?: 'ok' | 'fail';
  error?: string | null;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS audit_events (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  category    TEXT NOT NULL,
  action      TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info',
  account_id  TEXT,
  strategy_id TEXT,
  symbol      TEXT,
  payload     JSONB,
  result      TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS audit_events_ts_idx ON audit_events (ts DESC);
CREATE INDEX IF NOT EXISTS audit_events_category_idx ON audit_events (category);
CREATE INDEX IF NOT EXISTS audit_events_symbol_idx ON audit_events (symbol);
`;

let pool: Pool | null = null;
let ready = false;
let warned = false;

export function pgEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function ensurePg(): Promise<boolean> {
  if (!pgEnabled()) return false;
  if (ready && pool) return true;
  try {
    if (!pool) {
      pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
      pool.on('error', () => undefined); // idle client errors must not crash
    }
    await pool.query(SCHEMA_SQL);
    ready = true;
    return true;
  } catch (e) {
    if (!warned) {
      warned = true;
      console.warn('[pg] audit database unavailable, falling back to JSON logs only:', (e as Error).message);
    }
    return false;
  }
}

/** Fire-and-forget audit write; never throws, never blocks the caller. */
export function logAudit(entry: AuditEntry): void {
  void (async () => {
    if (!(await ensurePg()) || !pool) return;
    try {
      await pool.query(
        `INSERT INTO audit_events (category, action, level, account_id, strategy_id, symbol, payload, result, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          entry.category,
          entry.action,
          entry.level ?? 'info',
          entry.accountId ?? null,
          entry.strategyId ?? null,
          entry.symbol ?? null,
          entry.payload ? JSON.stringify(entry.payload) : null,
          entry.result ?? 'ok',
          entry.error ?? null,
        ],
      );
    } catch {
      // audit must never break trading
    }
  })();
}

export async function queryAudit(opts: { limit?: number; category?: string; symbol?: string } = {}): Promise<Record<string, unknown>[]> {
  if (!(await ensurePg()) || !pool) return [];
  const limit = Math.min(opts.limit ?? 100, 1000);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.category) {
    params.push(opts.category);
    clauses.push(`category = $${params.length}`);
  }
  if (opts.symbol) {
    params.push(opts.symbol.toUpperCase());
    clauses.push(`symbol = $${params.length}`);
  }
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  try {
    const res = await pool.query(
      `SELECT id, ts, category, action, level, account_id, strategy_id, symbol, payload, result, error
       FROM audit_events ${where} ORDER BY ts DESC LIMIT $${params.length}`,
      params,
    );
    return res.rows as Record<string, unknown>[];
  } catch {
    return [];
  }
}

export async function closePg(): Promise<void> {
  if (pool) await pool.end().catch(() => undefined);
  pool = null;
  ready = false;
}

export type { PoolClient };
