import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveModuleFolder, moduleFolder } from '../module-layout.mjs';
import { loadModuleAdapters } from '../registry.mjs';
import { automationFiles } from '../automation-versions.mjs';
import { isIgnoredPath } from '../../qa/tools/impact-check.mjs';
import { install, InstallError } from '../../qa/tools/install-module-adapter.mjs';
import { scaffold } from '../../qa/tools/scaffold-module-fields.mjs';

// Review fixes for Task 2: the old flat layout is not resolved for any product, reserved products, and the --product tools.
function tempRoot(t, dirs = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-layout-tools-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const d of dirs) fs.mkdirSync(path.join(root, ...d.split('/')), { recursive: true });
  return root;
}
const put = (root, rel, text) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

test('no product resolves to the old flat folders, whether or not they exist on disk', t => {
  const root = tempRoot(t, ['qa/modules/foo', 'tests/modules/foo', 'portal/modules/foo']);
  for (const kind of ['qa', 'tests', 'portal']) {
    for (const product of ['miracle', 'augastam']) assert.equal(resolveModuleFolder(root, kind, product, 'foo'), moduleFolder(kind, product, 'foo'));
  }
});

test('registry ignores a leftover qa/modules/foo/adapter.json, whatever product it declares (the flat folder is not a product)', t => {
  const root = tempRoot(t);
  const adapter = { id: 'foo', product: 'miracle', name: 'Foo', spec: 'tests/modules/foo/cases.spec.ts', actions: { fill: 'Fill' }, outcomes: ['created'], variants: [], fields: { a: { label: 'A', kind: 'text' } } };
  put(root, 'qa/modules/foo/adapter.json', JSON.stringify(adapter));
  put(root, 'tests/modules/foo/cases.spec.ts', '// spec\n');
  const warnings = [], loaded = loadModuleAdapters({ root, warn: m => warnings.push(m) });
  assert.deepEqual(loaded, {});
  assert.deepEqual(warnings, [], "a leftover qa/modules folder is not scanned as a product");
});

test('automationFiles never hashes the old flat folders, for any product', t => {
  const root = tempRoot(t);
  put(root, 'tests/modules/foo/a.spec.ts', 'a'); put(root, 'qa/modules/foo/adapter.json', '{}'); put(root, 'portal/modules/foo/index.mjs', 'x');
  assert.deepEqual(automationFiles(root, 'miracle', 'foo'), []);
  assert.deepEqual(automationFiles(root, 'augastam', 'foo'), []);
});

test('"modules" (the old flat layout) and the shared folder names cannot be a product; automation versions fail loudly for them', t => {
  const root = tempRoot(t);
  for (const bad of ['modules', 'tools', 'knowledge', 'shared', 'fixtures', 'discovery', 'smoke']) {
    assert.throws(() => resolveModuleFolder(root, 'qa', bad, 'x'), /reserved/, bad);
    assert.throws(() => automationFiles(root, bad, 'x'), /reserved/, bad);
  }
});

test('generated outputs of any product are ignored by the impact check', () => {
  assert.equal(isIgnoredPath('qa/miracle/registration/results/runs/x/results.jsonl'), true);
  assert.equal(isIgnoredPath('qa/augastam/registration/results/latest-summary.md'), true);
  assert.equal(isIgnoredPath('qa/miracle/registration/rules.md'), false);
  assert.equal(isIgnoredPath('qa/miracle/registration/cases/results.json'), false);
});

function proposal(t, { id = 'bar', spec, product }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo'), from = path.join(dir, 'proposal');
  fs.mkdirSync(root); fs.mkdirSync(from);
  const adapter = { id, ...(product ? { product } : {}), name: 'Bar', spec, prefix: 'BAR', actions: { fill: 'Fill' }, outcomes: ['created'], variants: [], fields: { amount: { label: 'Amount', kind: 'text' } } };
  const files = { 'fields.ts': 'export const FIELDS = {};\n', [`${id}.page.ts`]: 'export class P {}\n', 'case-runner.ts': 'export {};\n', 'cases.spec.ts': 'export {};\n', 'adapter.json': JSON.stringify(adapter) };
  for (const [n, v] of Object.entries(files)) fs.writeFileSync(path.join(from, n), v);
  return { root, from, opts: { root, run: () => ({ code: 0, output: '' }), log: () => {} } };
}
const rejectsInstall = (p, re, label) => assert.rejects(p, e => e instanceof InstallError && re.test(e.message), label);

test('install-module-adapter --product installs into the product-scoped folders', async t => {
  const s = proposal(t, { id: 'miracle-bar', spec: 'tests/miracle/bar/cases.spec.ts', product: 'miracle' });
  const r = await install(['--module', 'miracle-bar', '--product', 'miracle', '--from', s.from, '--yes'], s.opts);
  assert.equal(r.installed, true);
  assert.ok(fs.existsSync(path.join(s.root, 'tests', 'miracle', 'bar', 'cases.spec.ts')));
  assert.ok(fs.existsSync(path.join(s.root, 'qa', 'miracle', 'bar', 'adapter.json')));
  assert.equal(r.registryLoaded, true);
  // a proposal that forgets to declare the product would be skipped by the registry at load, so it is refused up front
  const undeclared = proposal(t, { id: 'miracle-bar', spec: 'tests/miracle/bar/cases.spec.ts' });
  await rejectsInstall(install(['--module', 'miracle-bar', '--product', 'miracle', '--from', undeclared.from, '--dry-run'], undeclared.opts), /must declare "product": "miracle"/);
  // without --product the default (augastam) expects a different spec path for the same proposal
  const other = proposal(t, { id: 'miracle-bar', spec: 'tests/miracle/bar/cases.spec.ts', product: 'miracle' });
  await rejectsInstall(install(['--module', 'miracle-bar', '--from', other.from, '--dry-run'], other.opts), /product must be "augastam"/);
});

test('install-module-adapter gives a plain InstallError for a reserved or malformed product', async t => {
  const s = proposal(t, { spec: 'tests/tools/bar/cases.spec.ts' });
  for (const product of ['tools', 'modules', 'Bad_Product']) {
    await rejectsInstall(install(['--module', 'bar', '--product', product, '--from', s.from, '--dry-run'], s.opts), /--product/, product);
  }
});

test('install-module-adapter refuses to overwrite when the product-scoped tests folder exists (force unlocks it)', async t => {
  const s = proposal(t, { spec: 'tests/augastam/bar/cases.spec.ts' });
  fs.mkdirSync(path.join(s.root, 'tests', 'augastam', 'bar'), { recursive: true });
  await rejectsInstall(install(['--module', 'bar', '--from', s.from, '--dry-run'], s.opts), /already has an automation adapter or a tests\/augastam\/bar folder/);
  assert.equal((await install(['--module', 'bar', '--from', s.from, '--dry-run', '--force'], s.opts)).installed, false);
});

test('scaffold-module-fields --product reads and writes the product-scoped folders', t => {
  const root = tempRoot(t);
  put(root, 'qa/miracle/bar/discovery/fields-default.json', JSON.stringify([{ card: 'Bill', label: 'Amount', kind: 'text', column: 'amount' }]));
  const r = scaffold({ moduleId: 'miracle-bar', productId: 'miracle', root });
  assert.equal(path.relative(root, r.target).split(path.sep).join('/'), 'tests/miracle/bar/fields.ts');
  assert.ok(fs.existsSync(r.target)); assert.match(r.content, /qa\/miracle\/bar\/discovery\/fields-\*\.json/);
  // the same module id under the default product finds no discovery folder
  assert.throws(() => scaffold({ moduleId: 'miracle-bar', root }), /No discovery directory/);
  assert.throws(() => scaffold({ moduleId: 'bar', productId: 'tools', root }), /reserved/);
});
