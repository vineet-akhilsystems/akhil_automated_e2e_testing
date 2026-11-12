import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { adapters, loadModuleAdapters, reloadAdapters, validateAdapterDefinition, validateCase } from '../registry.mjs';

const good = (id = 'billing') => ({
  id, name: 'Billing - Playwright', spec: `tests/modules/${id}/cases.spec.ts`, prefix: 'BIL',
  actions: { fill: 'Fill and inspect fields', save: 'Save', search: 'Search' },
  outcomes: ['created', 'blocked', 'no-errors', 'no-error'],
  variants: ['Cash Bill', 'Credit Bill'],
  fields: { bill_to: { label: 'Bill to', kind: 'text', required: true }, search: { label: 'Search text', kind: 'text' } },
  bases: { valid: { bill_to: 'Agent Testing' } },
});

function makeRoot(defs, { withSpec = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'registry-dynamic-'));
  for (const [dir, def] of Object.entries(defs)) {
    mkdirSync(path.join(root, 'qa', 'modules', dir), { recursive: true });
    writeFileSync(path.join(root, 'qa', 'modules', dir, 'adapter.json'), typeof def === 'string' ? def : JSON.stringify(def));
    if (withSpec) { mkdirSync(path.join(root, 'tests', 'modules', dir), { recursive: true }); writeFileSync(path.join(root, 'tests', 'modules', dir, 'cases.spec.ts'), '// spec\n'); }
  }
  return root;
}
const quiet = () => { const w = []; return { w, warn: m => w.push(m) }; };

test('valid adapter.json loads and registration stays built in', () => {
  const root = makeRoot({ billing: good() });
  try {
    const { w, warn } = quiet();
    const loaded = loadModuleAdapters({ root, warn });
    assert.deepEqual(Object.keys(loaded), ['billing']); assert.equal(w.length, 0);
    assert.equal(loaded.billing.spec, 'tests/modules/billing/cases.spec.ts');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reloadAdapters mutates the live registry, adds modules, and restores on the real root', () => {
  const root = makeRoot({ billing: good() });
  try {
    const ref = adapters, builtin = adapters.registration;
    assert.deepEqual(reloadAdapters({ root, warn: () => {} }).sort(), ['billing', 'registration']);
    assert.equal(ref, adapters); assert.equal(adapters.registration, builtin);
    const mod = { adapter: 'billing', config: { bases: { valid: { bill_to: 'x' } } } };
    const c = validateCase({ id: 'BIL-001', title: 'Save bill', action: 'save', base: 'valid', input: { bill_to: 'Agent Testing' }, expected: { outcome: 'created' }, registrationType: 'Cash Bill' }, mod);
    assert.equal(c.mode, 'automated');
    reloadAdapters({ root: path.join(root, 'nothing'), warn: () => {} });
    assert.deepEqual(Object.keys(adapters), ['registration']);
  } finally { reloadAdapters({ warn: () => {} }); rmSync(root, { recursive: true, force: true }); }
});

test('invalid adapter files are skipped with warnings and never throw', () => {
  const defs = {
    registration: { ...good('registration') },
    unknownkey: { ...good('unknownkey'), command: 'rm -rf /' },
    badid: { ...good('Bad_Id') },
    mismatch: { ...good('other') },
    traversal: { ...good('traversal'), spec: 'tests/modules/traversal/../registration/cases.spec.ts' },
    absolute: { ...good('absolute'), spec: 'C:/Windows/system32/cmd.exe' },
    otherdir: { ...good('otherdir'), spec: 'tests/modules/registration/cases.spec.ts' },
    shellish: { ...good('shellish'), actions: { fill: 'Fill; rm -rf /' } },
    badkind: { ...good('badkind'), fields: { a: { label: 'A', kind: 'exec' } } },
    fieldcmd: { ...good('fieldcmd'), fields: { a: { label: 'A', kind: 'text', command: 'x' } } },
    garbage: '{not json',
    arrays: '[]',
    ok: good('ok'),
  };
  const root = makeRoot(defs);
  try {
    const { w, warn } = quiet();
    const loaded = loadModuleAdapters({ root, warn });
    assert.deepEqual(Object.keys(loaded), ['ok']);
    assert.equal(w.length, Object.keys(defs).length - 1);
    assert.ok(w.every(m => m.includes('Skipped')));
    assert.ok(!('registration' in loaded));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing spec file and escaping symlink-free paths are rejected', () => {
  const root = makeRoot({ nospec: good('nospec') }, { withSpec: false });
  try {
    assert.throws(() => validateAdapterDefinition(good('nospec'), { root }), /does not exist/);
    assert.throws(() => validateAdapterDefinition({ ...good('nospec'), spec: 'tests/modules/nospec/sub/cases.spec.ts' }, { root }), /relative tests\/modules/);
    assert.throws(() => validateAdapterDefinition({ ...good('nospec'), spec: 'tests\\modules\\nospec\\cases.spec.ts' }, { root }), /relative tests\/modules/);
    assert.throws(() => validateAdapterDefinition(good('registration'), { root }), /cannot be overridden/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing qa/modules directory yields no extra adapters', () => {
  assert.deepEqual(loadModuleAdapters({ root: path.join(tmpdir(), 'definitely-missing-root-xyz'), warn: () => {} }), {});
});

test('spec file names with regex metacharacters or odd characters are rejected', () => {
  const root = makeRoot({ billing: good('billing') });
  try {
    for (const name of ['a+b.spec.ts', 'a(b).spec.ts', 'a b.spec.ts', 'a$.spec.ts', 'a[1].spec.ts', 'a|b.spec.ts', 'a*.spec.ts', 'a^.spec.ts', 'a{1}.spec.ts', 'a?.spec.ts']) {
      assert.throws(() => validateAdapterDefinition({ ...good('billing'), spec: `tests/modules/billing/${name}` }, { root }), /relative tests\/modules/, name);
    }
    assert.equal(validateAdapterDefinition({ ...good('billing') }, { root }).spec, 'tests/modules/billing/cases.spec.ts');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Registration-only rules do not apply to other adapter modules', () => {
  const root = makeRoot({ billing: { ...good(), variants: ['Cash Bill'], fields: { ...good().fields, id_proof_file: { label: 'Proof', kind: 'text' } }, actions: { ...good().actions, workflow: 'Workflow', update: 'Update' } } });
  try {
    reloadAdapters({ root, warn: () => {} });
    const mod = { id: 'billing', adapter: 'billing', config: { bases: { valid: { bill_to: 'x' } } } };
    // A Billing case may reuse a Registration workbook id and the generic names id_proof_file / workflow.
    const c = validateCase({ id: 'TC_REG_001', title: 'Save bill', action: 'save', base: 'valid', input: { bill_to: 'A', id_proof_file: 'whatever.pdf' }, expected: { outcome: 'created' } }, mod);
    assert.equal(c.id, 'TC_REG_001');
    assert.throws(() => validateCase({ id: 'BIL-2', title: 't', action: 'save', input: { bill_to: 'A' }, expected: { outcome: 'created' }, registrationType: 'Nope' }, mod), /Choose a supported variant/);
    assert.throws(() => validateCase({ id: 'BIL-3', title: 't', action: 'update', input: { bill_to: 'A' }, expected: { outcome: 'created' } }, mod), /Target record or dependency token/);
    // Registration keeps its rules.
    assert.throws(() => validateCase({ id: 'TC_REG_001', title: 't', action: 'fill', input: {}, expected: { outcome: 'no-errors' } }, { id: 'registration', adapter: 'registration', config: {} }), /workbook IDs/);
  } finally { reloadAdapters({ warn: () => {} }); rmSync(root, { recursive: true, force: true }); }
});
