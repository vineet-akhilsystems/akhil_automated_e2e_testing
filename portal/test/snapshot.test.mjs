import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../store.mjs';
import { writeSnapshotFile } from '../snapshot.mjs';
import { createAiPolicy } from '../ai-policy.mjs';

const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('a snapshot exported from one database is adopted by a brand-new one, and never overwrites an existing one', t => {
  const a = openStore(tmp(t));
  a.saveProduct({ id: 'shared-product', name: 'Shared', description: 'x' });
  const file = path.join(tmp(t), 'snapshot.json');
  writeSnapshotFile(a.db, file); a.close();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).tables.products.some(p => p.id === 'shared-product'), true);

  const messages = [];
  const b = openStore(tmp(t), { snapshotFile: file, log: m => messages.push(m) });
  assert.ok(b.product('shared-product'), 'snapshot product is loaded');
  assert.match(messages.join(' '), /Loaded shared data/);
  b.saveProduct({ id: 'local-only', name: 'Local', description: 'y' }); b.close();

  const dir = path.join(path.dirname(file), 'again'); fs.mkdirSync(dir);
  const c = openStore(dir, { snapshotFile: file }); c.saveProduct({ id: 'local-only', name: 'Local', description: 'y' }); c.close();
  const d = openStore(dir, { snapshotFile: file });
  assert.ok(d.product('local-only'), 'an existing database is left alone'); d.close();
});

test('shared settings (AI quality) live in the database and travel with the snapshot; per-machine meta rows do not', t => {
  const a = openStore(tmp(t));
  const policy = createAiPolicy(path.join(tmp(t)), { db: a.db });
  policy.save({ preset: 'quality', dailyJobLimit: 9 });
  assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key='setting:ai-policy'").get().n, 1, 'stored in the database, not a loose file');
  const file = path.join(tmp(t), 'snapshot.json');
  writeSnapshotFile(a.db, file);
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(snap.settings), ['setting:ai-policy']); assert.equal(snap.settings['setting:ai-policy'].preset, 'quality');
  assert.ok(!JSON.stringify(snap).includes('access-migration-1'), 'per-machine meta rows are not shared');
  a.close();

  const b = openStore(tmp(t), { snapshotFile: file });
  const other = createAiPolicy(tmp(t), { db: b.db });
  assert.deepEqual([other.get().preset, other.get().dailyJobLimit], ['quality', 9], 'a new machine starts with the team policy');
  b.close();
});
