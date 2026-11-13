import fs from 'node:fs';
import path from 'node:path';

// Shared team data that travels through git (portal-data/snapshot.json): users (password hashes only), products,
// modules, cases, insights, teams and access memberships. Deliberately NOT included: login profiles and their key
// (.portal/environment-settings.*), runs and reports, audit log, uploaded files, sessions.
// Order matters for the foreign keys on import.
export const SHARED_TABLES = [
  { name: 'users', key: ['id'], json: ['document'] },
  { name: 'products', key: ['id'], json: ['document'] },
  { name: 'modules', key: ['id'], json: ['document'] },
  { name: 'cases', key: ['module_id', 'id'], json: ['document'] },
  { name: 'insights', key: ['id'], json: ['document'] },
  { name: 'teams', key: ['id'], json: ['document'] },
  { name: 'team_members', key: ['team_id', 'user_id'], json: [] },
  { name: 'memberships', key: ['id'], json: ['document'] },
];

// Readable, diff-friendly: documents are stored as JSON objects and rows are sorted by primary key.
// Shared settings kept in the meta table (key prefix "setting:"), e.g. the AI quality preset. Other meta rows are per-machine and stay out.
const settingsOf = db => Object.fromEntries(db.prepare("SELECT key, value FROM meta WHERE key LIKE 'setting:%' ORDER BY key").all().map(r => [r.key, JSON.parse(r.value)]));

// Login profiles (Settings) are stored encrypted in <data dir>/environment-settings.json with the key in environment-settings.key.
// By team decision both travel in the snapshot so a clone can log in at once. The key sits next to the data: the repo MUST stay private.
const PROFILE_FILE = 'environment-settings.json', KEY_FILE = 'environment-settings.key';
export function readProfileStore(dir) {
  const f = path.join(dir, PROFILE_FILE), k = path.join(dir, KEY_FILE);
  if (!fs.existsSync(f) || !fs.existsSync(k)) return null;
  return { profiles: JSON.parse(fs.readFileSync(f, 'utf8')), key: fs.readFileSync(k).toString('base64') };
}
// Without `overwrite` an existing local profile store is never touched (first start only).
export function restoreProfileStore(dir, credentials, { overwrite = false } = {}) {
  if (!Array.isArray(credentials?.profiles) || typeof credentials?.key !== 'string' || !credentials.key) return false;
  const f = path.join(dir, PROFILE_FILE), k = path.join(dir, KEY_FILE);
  if (!overwrite && (fs.existsSync(f) || fs.existsSync(k))) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(k, Buffer.from(credentials.key, 'base64'), { mode: 0o600 });
  fs.writeFileSync(f, JSON.stringify(credentials.profiles, null, 2), { mode: 0o600 });
  return true;
}

export function exportSnapshot(db, { credentials = null } = {}) {
  const tables = {};
  for (const t of SHARED_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${t.name} ORDER BY ${t.key.join(', ')}`).all();
    tables[t.name] = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, t.json.includes(k) ? JSON.parse(v) : v])));
  }
  return { format: 1, note: 'Shared Test Studio data. Contains password hashes and login profiles. Regenerate with: node qa/tools/portal-snapshot.mjs export', settings: settingsOf(db), ...(credentials ? { credentials: { warning: 'Encrypted login profiles AND their key. Anyone who can read this file can read the passwords. Keep this repository private.', ...credentials } } : {}), tables };
}

export function writeSnapshotFile(db, file, extras = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(exportSnapshot(db, extras), null, 2) + '\n');
}

// Replaces the shared tables with the snapshot's rows inside one transaction.
export function importSnapshot(db, snapshot) {
  if (snapshot?.format !== 1 || typeof snapshot.tables !== 'object') throw new Error('Unsupported snapshot file.');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const t of [...SHARED_TABLES].reverse()) db.exec(`DELETE FROM ${t.name}`);
    for (const t of SHARED_TABLES) {
      for (const row of snapshot.tables[t.name] ?? []) {
        const cols = Object.keys(row);
        db.prepare(`INSERT INTO ${t.name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .run(...cols.map(c => t.json.includes(c) ? JSON.stringify(row[c]) : row[c]));
      }
    }
    if (snapshot.settings && typeof snapshot.settings === 'object') {
      db.exec("DELETE FROM meta WHERE key LIKE 'setting:%'");
      for (const [key, value] of Object.entries(snapshot.settings)) { if (/^setting:[\w.-]+$/.test(key)) db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(key, JSON.stringify(value)); }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// First start only: a brand-new database (no users, no modules) adopts the committed snapshot instead of the built-in seed.
export function importSnapshotIfFresh(db, file, log = () => {}) {
  if (!file || !fs.existsSync(file)) return false;
  const count = t => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  if (count('users') || count('modules')) return false;
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  importSnapshot(db, snapshot);
  log(`Loaded shared data from ${path.basename(file)}: ${Object.entries(snapshot.tables).map(([k, v]) => `${v.length} ${k}`).join(', ')}${Object.keys(snapshot.settings ?? {}).length ? `, ${Object.keys(snapshot.settings).length} setting(s)` : ''}.`);
  return true;
}
