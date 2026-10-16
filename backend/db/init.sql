-- GTrading audit trail schema (also created automatically by the app)
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
