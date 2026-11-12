import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scaffold, normalizeKind } from '../../qa/tools/scaffold-module-fields.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'qa', 'tools', 'scaffold-module-fields.mjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'qa', 'modules', 'billing', 'discovery');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fields-default.json'), JSON.stringify([
    { card: 'Invoice', label: 'Invoice No', required: true, kind: 'text', column: 'invoice_no', default: '', disabled: false },
    { card: 'Invoice', label: 'Amount', required: true, kind: 'number', column: 'amount', default: '', disabled: false },
    { card: 'Invoice', label: 'Payer Type', required: false, kind: 'select', column: 'payer_type', default: '', disabled: false, options: ['Cash'] },
    { card: 'Payment', label: 'Name', required: false, kind: 'text', column: 'pay_name', default: '', disabled: false },
    { card: 'Notes', label: "Doctor's Remark", required: false, kind: 'textarea', column: 'remark', default: '', disabled: false },
  ]));
  fs.writeFileSync(path.join(dir, 'fields-credit-note.json'), JSON.stringify([
    { card: 'Invoice', label: 'Invoice No', kind: 'text', column: '' },
    { card: 'Credit', label: 'Name', kind: 'text', column: 'credit_name' },
    { card: 'Credit', label: 'Approved', kind: 'checkbox', column: 'approved' },
  ]));
  fs.writeFileSync(path.join(dir, 'layout-default.json'), '{"cards":[]}'); // must be ignored
  return { root, target: path.join(root, 'tests', 'modules', 'billing', 'fields.ts') };
}

test('normalizeKind maps raw input types onto the registration FieldKind set', () => {
  assert.equal(normalizeKind('number'), 'text');
  assert.equal(normalizeKind('tel'), 'text');
  assert.equal(normalizeKind('radio'), 'checkbox');
  assert.equal(normalizeKind('select'), 'select');
  assert.equal(normalizeKind(undefined), 'text');
});

test('generates fields.ts in the registration shape with merged variants and FILL_ORDER', (t) => {
  const { root, target } = fixture(t);
  const r = scaffold({ moduleId: 'billing', root });
  assert.equal(r.written, true);
  assert.equal(r.count, 7);
  const ts = fs.readFileSync(target, 'utf8');
  assert.match(ts, /export const FIELDS: Record<string, FieldDef> = \{/);
  assert.match(ts, /invoice_no: \{ card: 'Invoice', label: 'Invoice No', kind: 'text', column: 'invoice_no' \},/);
  assert.match(ts, /amount: \{ card: 'Invoice', label: 'Amount', kind: 'text', column: 'amount' \},/); // number -> text
  assert.match(ts, /label: "Doctor's Remark", kind: 'textarea'/);
  // Same label in different cards gets distinct keys.
  assert.match(ts, /name: \{ card: 'Payment', label: 'Name'/);
  assert.match(ts, /credit_name: \{ card: 'Credit', label: 'Name'.*only in: credit-note/);
  assert.match(ts, /approved: \{ card: 'Credit', label: 'Approved', kind: 'checkbox', column: 'approved' \}, {2}\/\/ only in: credit-note/);
  // Invoice No appears in both files: one entry, not flagged as variant-only.
  assert.equal((ts.match(/label: 'Invoice No'/g) || []).length, 1);
  assert.doesNotMatch(ts, /label: 'Invoice No'.*only in/);
  assert.match(ts, /export const FILL_ORDER = \[/);
  assert.match(ts, /'invoice_no', 'amount', 'payer_type', 'name'/);
});

test('refuses to overwrite without --force, then overwrites with it', (t) => {
  const { root, target } = fixture(t);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '// hand written\n');
  assert.throws(() => scaffold({ moduleId: 'billing', root }), /already exists.*--force/);
  assert.equal(fs.readFileSync(target, 'utf8'), '// hand written\n');
  const r = scaffold({ moduleId: 'billing', root, force: true });
  assert.equal(r.existed, true);
  assert.match(fs.readFileSync(target, 'utf8'), /export const FIELDS/);
});

test('--dry-run writes nothing, even over an existing file', (t) => {
  const { root, target } = fixture(t);
  const r = scaffold({ moduleId: 'billing', root, dryRun: true });
  assert.equal(r.written, false);
  assert.ok(r.content.includes('FILL_ORDER'));
  assert.equal(fs.existsSync(target), false);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'keep');
  scaffold({ moduleId: 'billing', root, dryRun: true });
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
});

test('rejects bad module ids and missing discovery output', (t) => {
  const { root } = fixture(t);
  assert.throws(() => scaffold({ moduleId: '../evil', root }), /moduleId must match/);
  assert.throws(() => scaffold({ moduleId: 'Billing', root }), /moduleId must match/);
  assert.throws(() => scaffold({ moduleId: 'nothing', root }), /No discovery directory/);
});

test('CLI honours --root, --dry-run and exit codes', (t) => {
  const { root, target } = fixture(t);
  const dry = spawnSync(process.execPath, [CLI, 'billing', '--root', root, '--dry-run'], { encoding: 'utf8' });
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /export const FIELDS/);
  assert.equal(fs.existsSync(target), false);
  assert.equal(spawnSync(process.execPath, [CLI, 'billing', '--root', root], { encoding: 'utf8' }).status, 0);
  const again = spawnSync(process.execPath, [CLI, 'billing', '--root', root], { encoding: 'utf8' });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /--force/);
  assert.equal(spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).status, 2);
});
