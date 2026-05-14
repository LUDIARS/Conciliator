export const SCHEMA_VERSION = 2;

/** conciliator.db (SQLite WAL) のスキーマ。 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workers (
  id              TEXT PRIMARY KEY,
  host            TEXT NOT NULL,
  label           TEXT NOT NULL,
  kind            TEXT NOT NULL,
  cernere_user_id TEXT,
  first_seen      INTEGER NOT NULL,
  last_seen       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_roots (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  path        TEXT NOT NULL,
  config_json TEXT NOT NULL,
  loaded_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  root_id    TEXT NOT NULL,
  path       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  worker_id  TEXT,
  size_bytes INTEGER,
  hash       TEXT
);
CREATE INDEX IF NOT EXISTS idx_file_events_root_ts ON file_events(root_id, ts);
CREATE INDEX IF NOT EXISTS idx_file_events_path ON file_events(path);
CREATE INDEX IF NOT EXISTS idx_file_events_ts ON file_events(ts);

CREATE TABLE IF NOT EXISTS claims (
  id          TEXT PRIMARY KEY,
  worker_id   TEXT NOT NULL,
  root_id     TEXT NOT NULL,
  path        TEXT NOT NULL,
  origin      TEXT NOT NULL,
  intent_text TEXT,
  status      TEXT NOT NULL,
  snapshot_id TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  released_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_claims_path_status ON claims(path, status);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);

CREATE TABLE IF NOT EXISTS snapshots (
  id          TEXT PRIMARY KEY,
  claim_id    TEXT NOT NULL,
  path        TEXT NOT NULL,
  hash        TEXT,
  stored_path TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_claim ON snapshots(claim_id);

CREATE TABLE IF NOT EXISTS collisions (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL,
  claim_a     TEXT NOT NULL,
  claim_b     TEXT NOT NULL,
  phase       TEXT NOT NULL,
  status      TEXT NOT NULL,
  detected_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_collisions_status ON collisions(status);
CREATE INDEX IF NOT EXISTS idx_collisions_path ON collisions(path);

CREATE TABLE IF NOT EXISTS structure_violations (
  id          TEXT PRIMARY KEY,
  root_id     TEXT NOT NULL,
  path        TEXT NOT NULL,
  rule_id     TEXT NOT NULL,
  detail      TEXT NOT NULL,
  status      TEXT NOT NULL,
  detected_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_structure_violations_status ON structure_violations(status);

CREATE TABLE IF NOT EXISTS risk_rules (
  id        TEXT PRIMARY KEY,
  rule_json TEXT NOT NULL,
  enabled   INTEGER NOT NULL DEFAULT 1,
  source    TEXT NOT NULL,
  added_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_alerts (
  id          TEXT PRIMARY KEY,
  rule_id     TEXT NOT NULL,
  root_id     TEXT,
  path        TEXT NOT NULL,
  severity    TEXT NOT NULL,
  detail      TEXT NOT NULL,
  status      TEXT NOT NULL,
  detected_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_status ON risk_alerts(status);

CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
`;
