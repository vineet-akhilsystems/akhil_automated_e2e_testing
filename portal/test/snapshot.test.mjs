import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../store.mjs';
import { writeSnapshotFile } from '../snapshot.mjs';

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
