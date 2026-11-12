import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, resolveCases, validateCase } from '../../portal/registry.mjs';

export function loadPortalCases(directory, selected = []) {
  const filename = path.join(directory, 'portal.sqlite');
  if (!fs.existsSync(filename)) throw new Error(`Portal database not found: ${filename}. Start npm run portal first.`);
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('BEGIN');
    const row = db.prepare('SELECT document FROM modules WHERE id=?').get('registration');
    if (!row) throw new Error('Registration module is missing from the portal database.');
    const module = JSON.parse(row.document);
    const all = db.prepare('SELECT document FROM cases WHERE module_id=? ORDER BY rowid').all('registration')
      .map(row => JSON.parse(row.document));
    const automated = all.filter(c => c.mode === 'automated');
    const cases = resolveCases(automated, selected.length ? selected : automated.filter(c => c.enabled !== false).map(c => c.id));
    for (const c of cases) validateCase(c, module);
    return { module: 'registration', bases: module.config?.bases ?? {}, cases,
      excludedManualCases: all.filter(c => c.mode === 'manual').map(c => ({ id: c.id, title: c.title, reason: 'Manual procedure requires structured automation and its stated prerequisites.' })) };
  } finally { db.close(); }
}

export const defaultPortalDirectory = () => path.resolve(ROOT, process.env.PORTAL_DATA_DIR || '.portal');
