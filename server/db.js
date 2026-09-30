// SQLite storage (node:sqlite) - schema, tiny query helpers, audit trail.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const DATA_DIR = process.env.AVANTRO_DATA || path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, process.env.AVANTRO_DB || 'avantro.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const cache = new Map();
const stmt = (sql) => {
  let s = cache.get(sql);
  if (!s) cache.set(sql, (s = db.prepare(sql)));
  return s;
};
const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? +v : v);
export const q = (sql, ...p) => stmt(sql).all(...p.map(norm)).map((r) => ({ ...r }));
export const q1 = (sql, ...p) => {
  const r = stmt(sql).get(...p.map(norm));
  return r ? { ...r } : null;
};
export const run = (sql, ...p) => stmt(sql).run(...p.map(norm));
export const insert = (table, obj) => {
  const keys = Object.keys(obj);
  const r = run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => obj[k]));
  return Number(r.lastInsertRowid);
};
export const update = (table, id, obj) => {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, ...keys.map((k) => obj[k]), id);
};
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export const now = () => new Date().toISOString();

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('pm','engineer','supervisor','admin')),
  pw_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, company TEXT, phone TEXT,
  must_change INTEGER NOT NULL DEFAULT 0, is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT, last_seen TEXT, expires_at TEXT, ip TEXT, ua TEXT
);
CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS towers (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, weight REAL, sort INTEGER DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, notes TEXT, is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tower_trades (
  tower_id INTEGER NOT NULL REFERENCES towers(id) ON DELETE CASCADE,
  trade_id INTEGER NOT NULL REFERENCES trades(id), weight REAL, PRIMARY KEY (tower_id, trade_id)
);
CREATE TABLE IF NOT EXISTS levels (
  id INTEGER PRIMARY KEY, tower_id INTEGER NOT NULL REFERENCES towers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, UNIQUE (tower_id, name)
);
CREATE TABLE IF NOT EXISTS zones (
  id INTEGER PRIMARY KEY, level_id INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, UNIQUE (level_id, name)
);
CREATE TABLE IF NOT EXISTS catalog (
  id INTEGER PRIMARY KEY, trade_id INTEGER NOT NULL REFERENCES trades(id), category TEXT NOT NULL,
  name TEXT NOT NULL, uom TEXT, method TEXT NOT NULL DEFAULT 'quantity', milestones TEXT
);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY, tower_id INTEGER NOT NULL REFERENCES towers(id) ON DELETE CASCADE,
  level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL, zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
  trade_id INTEGER NOT NULL REFERENCES trades(id), category TEXT, name TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'quantity' CHECK (method IN ('quantity','milestone')),
  uom TEXT, scope_qty REAL, weight REAL, plan_start TEXT, plan_finish TEXT, contractor TEXT,
  engineer_id INTEGER REFERENCES users(id), supervisor_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'not_started', status_note TEXT, actual_start TEXT, actual_finish TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT, is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_act_tower ON activities(tower_id, trade_id, level_id);
CREATE TABLE IF NOT EXISTS activity_milestones (
  id INTEGER PRIMARY KEY, activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  name TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0, achieved_date TEXT, achieved_update_id INTEGER
);
CREATE TABLE IF NOT EXISTS project_milestones (
  id INTEGER PRIMARY KEY, tower_id INTEGER REFERENCES towers(id) ON DELETE CASCADE, name TEXT NOT NULL,
  due_date TEXT NOT NULL, achieved_date TEXT, note TEXT, is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS updates (
  id INTEGER PRIMARY KEY, activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL, author_id INTEGER REFERENCES users(id), engineer_id INTEGER, supervisor_id INTEGER,
  contractor TEXT, location_note TEXT, qty_today REAL NOT NULL DEFAULT 0, planned_qty REAL, uom TEXT,
  manpower INTEGER, status TEXT, milestone_ids TEXT, remarks TEXT, next_plan TEXT,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','approved','rejected')),
  over_scope INTEGER NOT NULL DEFAULT 0, review_by INTEGER, review_at TEXT, review_note TEXT,
  submitted_at TEXT, copied_from INTEGER, created_at TEXT, updated_at TEXT, is_demo INTEGER NOT NULL DEFAULT 0,
  UNIQUE (activity_id, report_date)
);
CREATE INDEX IF NOT EXISTS ix_upd_state ON updates(state, report_date);
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, title TEXT NOT NULL, description TEXT, required_action TEXT,
  tower_id INTEGER NOT NULL REFERENCES towers(id) ON DELETE CASCADE, level_id INTEGER, zone_id INTEGER,
  trade_id INTEGER, activity_id INTEGER REFERENCES activities(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open',
  is_blocker INTEGER NOT NULL DEFAULT 0, needs_decision INTEGER NOT NULL DEFAULT 0,
  owner_id INTEGER, raised_by INTEGER, raised_date TEXT, target_date TEXT, resolved_date TEXT, resolution_note TEXT,
  closed_by INTEGER, closed_date TEXT, update_id INTEGER REFERENCES updates(id) ON DELETE SET NULL,
  created_at TEXT, updated_at TEXT, is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS issue_comments (
  id INTEGER PRIMARY KEY, issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id INTEGER, body TEXT NOT NULL, created_at TEXT
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY, file TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER, caption TEXT,
  uploader_id INTEGER, tower_id INTEGER, level_id INTEGER, zone_id INTEGER, trade_id INTEGER,
  activity_id INTEGER REFERENCES activities(id) ON DELETE SET NULL, update_id INTEGER REFERENCES updates(id) ON DELETE SET NULL,
  issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL, kind TEXT NOT NULL DEFAULT 'progress',
  taken_date TEXT, created_at TEXT, is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_photo_date ON photos(taken_date);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, user_id INTEGER, user_name TEXT, action TEXT NOT NULL,
  entity TEXT, entity_id INTEGER, summary TEXT, details TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit(entity, entity_id);
`);

export function audit(user, action, entity, entityId, summary, details) {
  run(
    'INSERT INTO audit (ts,user_id,user_name,action,entity,entity_id,summary,details) VALUES (?,?,?,?,?,?,?,?)',
    now(), user?.id ?? null, user?.name ?? 'system', action, entity, entityId ?? null, summary ?? null,
    details === undefined ? null : JSON.stringify(details)
  );
}

// ---- settings ----
export const DEFAULT_SETTINGS = {
  project_name: 'Avantro Project',
  at_risk_pp: '5', // variance (percentage points) at or below -X => At Risk
  delayed_pp: '15', // variance at or below -X (or past finish date and unfinished) => Delayed
  stale_days: '3', // days without a submitted update before an active activity is "outdated"
  backdate_days: '14', // how far back site staff may date an update
  demo_mode: '0',
};
export function getSettings() {
  const s = { ...DEFAULT_SETTINGS };
  for (const r of q('SELECT key,value FROM settings')) s[r.key] = r.value;
  return {
    ...s,
    at_risk_pp: +s.at_risk_pp,
    delayed_pp: +s.delayed_pp,
    stale_days: +s.stale_days,
    backdate_days: +s.backdate_days,
    demo_mode: s.demo_mode === '1',
  };
}
export const setSetting = (k, v) =>
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
