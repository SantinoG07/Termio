PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS nodes (
  node_id TEXT PRIMARY KEY,
  spec TEXT NOT NULL CHECK(json_valid(spec))
);
CREATE TABLE IF NOT EXISTS records (
  ingest_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL UNIQUE,
  node_id TEXT NOT NULL REFERENCES nodes(node_id),
  environment TEXT NOT NULL CHECK(environment IN ('test','operational')),
  record_type TEXT NOT NULL,
  observed_ms INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  canonical_payload TEXT NOT NULL CHECK(json_valid(canonical_payload)),
  payload TEXT NOT NULL CHECK(json_valid(payload))
);
CREATE INDEX IF NOT EXISTS records_node_time ON records(environment,node_id,observed_ms DESC,ingest_sequence DESC);
CREATE TABLE IF NOT EXISTS cursors (
  source_key TEXT PRIMARY KEY, value TEXT
);
CREATE TABLE IF NOT EXISTS connection_state (
  source_key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS rejections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  source_key TEXT NOT NULL,
  error_code TEXT NOT NULL,
  details TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  record_id TEXT PRIMARY KEY REFERENCES records(record_id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','technical_receipt','failed','expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_ms INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  technical_received_at TEXT
);
