const Database = require('better-sqlite3');

const db = new Database('portal.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  password TEXT,
  must_reset INTEGER DEFAULT 1,
  is_selected INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_name TEXT NOT NULL,
  org TEXT NOT NULL,
  catalog TEXT NOT NULL,
  version TEXT,
  swagger_json TEXT,
  product_json TEXT,
  oauth_enabled INTEGER DEFAULT 0,
  backend_targets TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL,
  catalog TEXT NOT NULL,
  consumer_org TEXT NOT NULL,
  app_name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  product_name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS certs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cert_name TEXT NOT NULL,
  cert_type TEXT NOT NULL,
  owner TEXT NOT NULL,
  expires_on TEXT NOT NULL,
  notes TEXT,
  updated_at TEXT NOT NULL
);
`);

const seedUsers = db.prepare(`INSERT OR IGNORE INTO users (user_id, role, password, must_reset, is_selected) VALUES
  ('apic_admin', 'ADMIN', 'Temp#1234', 1, 1),
  ('publisher1', 'PUBLISHER', 'Temp#1234', 1, 1),
  ('viewer1', 'VIEWER', 'Temp#1234', 1, 0)
`);
seedUsers.run();

module.exports = db;
