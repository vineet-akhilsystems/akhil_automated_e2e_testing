import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as layout from '../module-layout.mjs';
import { resolveModuleFolder, moduleFolder } from '../module-layout.mjs';
import { loadModuleAdapters, validateAdapterDefinition } from '../registry.mjs';
import { automationFiles, fingerprintAutomation } from '../automation-versions.mjs';
import { loadTree } from '../tree.mjs';
import { discoveryProduct } from '../../tests/shared/discovery-env.mjs';

// Task 2 of the product-scoped layout: runtime code resolves folders through one resolver. The old flat layout (qa/modules/<id>) is gone and is no longer resolved.
function tempRoot(t, dirs = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-layout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const d of dirs) fs.mkdirSync(path.join(root, ...d.split('/')), { recursive: true });
  return root;
}
const put = (root, rel, text) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

test('resolveModuleFolder: always the product-scoped folder, even when old flat folders exist on disk', t => {
  const root = tempRoot(t, ['qa/modules/billing', 'tests/modules/billing', 'portal/modules/billing']);
  for (const kind of ['qa', 'tests', 'portal']) {
    assert.equal(resolveModuleFolder(root, kind, 'augastam', 'billing'), moduleFolder(kind, 'augastam', 'billing'));
    assert.ok(!resolveModuleFolder(root, kind, 'augastam', 'billing').includes('modules/billing') || kind === 'portal');
  }
  assert.equal(resolveModuleFolder(root, 'qa', 'augastam', 'billing'), 'qa/augastam/billing');
  assert.equal(resolveModuleFolder(root, 'tests', 'augastam', 'billing'), 'tests/augastam/billing');
  assert.equal(resolveModuleFolder(root, 'portal', 'augastam', 'billing'), 'portal/modules/augastam/billing');
  assert.equal('legacyModuleFolder' in layout, false);
});

test('resolveModuleFolder: a new module (neither folder exists) gets the product-scoped folder', t => {
  const root = tempRoot(t);
  assert.equal(resolveModuleFolder(root, 'qa', 'augastam', 'billing'), 'qa/augastam/billing');
  assert.equal(resolveModuleFolder(root, 'tests', 'miracle', 'miracle-registration'), 'tests/miracle/registration');
  assert.equal(resolveModuleFolder(root, 'portal', 'augastam', 'registration'), 'portal/modules/augastam/registration');
});

test('resolveModuleFolder: invalid ids still throw', t => {
  const root = tempRoot(t);
  assert.equal(resolveModuleFolder(root, 'qa', 'augastam', 'billing'), 'qa/augastam/billing');
  assert.throws(() => resolveModuleFolder(root, 'qa', 'augastam', '../x'), /module id/);
  assert.throws(() => resolveModuleFolder(root, 'qa', 'Augastam', 'billing'), /product id/);
  assert.throws(() => resolveModuleFolder(root, 'bogus', 'augastam', 'billing'), /folder kind/);
});

const miracleAdapter = (extra = {}) => ({
  id: 'miracle-registration', product: 'miracle', name: 'Miracle Registration', spec: 'tests/miracle/registration/cases.spec.ts', prefix: 'MIR',
  actions: { fill: 'Fill' }, outcomes: ['created'], variants: [], fields: { name: { label: 'Name', kind: 'text' } }, ...extra,
});

test('registry scans every product folder: qa/miracle/registration/adapter.json declaring product miracle is accepted', t => {
  const root = tempRoot(t);
  put(root, 'qa/miracle/registration/adapter.json', JSON.stringify(miracleAdapter()));
  put(root, 'tests/miracle/registration/cases.spec.ts', '// spec\n');
  const warnings = [], loaded = loadModuleAdapters({ root, warn: m => warnings.push(m) });
  assert.deepEqual(warnings, []);
  assert.deepEqual(Object.keys(loaded), ['miracle-registration']);
  assert.equal(loaded['miracle-registration'].product, 'miracle');
  assert.equal(loaded['miracle-registration'].spec, 'tests/miracle/registration/cases.spec.ts');
});

test('registry rejects an adapter whose folder is not the resolver folder for its (product, id)', t => {
  const root = tempRoot(t);
  put(root, 'qa/miracle/wrong-folder/adapter.json', JSON.stringify(miracleAdapter()));          // right pair, wrong folder
  put(root, 'qa/augastam/registration-copy/adapter.json', JSON.stringify(miracleAdapter({ product: 'augastam', id: 'copy-of-it', spec: 'tests/augastam/copy-of-it/cases.spec.ts' }))); // id does not belong in that folder
  put(root, 'qa/miracle/other/adapter.json', JSON.stringify(miracleAdapter({ product: undefined })));      // no product: defaults to augastam, so it does not belong under qa/miracle
  put(root, 'tests/miracle/registration/cases.spec.ts', '// spec\n');
  const warnings = [], loaded = loadModuleAdapters({ root, warn: m => warnings.push(m) });
  assert.deepEqual(loaded, {});
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every(w => w.includes('Skipped') && /belongs in/.test(w)), warnings.join('\n'));
  assert.ok(warnings.some(w => /qa\/miracle\/registration/.test(w)));
});

test('registry rejects a spec outside tests/<product>/<module>/ and an invalid product', t => {
  const root = tempRoot(t);
  put(root, 'tests/miracle/registration/cases.spec.ts', '// spec\n');
  put(root, 'tests/augastam/registration/cases.spec.ts', '// spec\n');
  put(root, 'tests/miracle/other/cases.spec.ts', '// spec\n');
  const opts = { root, folder: 'qa/miracle/registration' };
  assert.equal(validateAdapterDefinition(miracleAdapter(), opts).spec, 'tests/miracle/registration/cases.spec.ts');
  for (const spec of ['tests/augastam/registration/cases.spec.ts', 'tests/miracle/other/cases.spec.ts', 'tests/miracle/registration/sub/cases.spec.ts', 'tests/miracle/registration/../other/cases.spec.ts', 'tests/modules/miracle-registration/cases.spec.ts']) {
    assert.throws(() => validateAdapterDefinition(miracleAdapter({ spec }), opts), /relative tests\/miracle\/registration\//, spec);
  }
  assert.throws(() => validateAdapterDefinition(miracleAdapter({ product: '../x' }), opts), /product/);
  assert.throws(() => validateAdapterDefinition(miracleAdapter({ product: 'tools' }), opts), /product/);
});

test('the spec folder must exist for a scoped module', t => {
  const root = tempRoot(t);
  assert.throws(() => validateAdapterDefinition(miracleAdapter(), { root, folder: 'qa/miracle/registration' }), /does not exist/);
});

test('automation versions collect a product-scoped module (qa, tests and portal folders by product + module)', t => {
  const root = tempRoot(t);
  put(root, 'tests/miracle/registration/a.spec.ts', 'a');
  put(root, 'tests/miracle/registration/results/skip.json', '{}');
  put(root, 'qa/miracle/registration/adapter.json', '{}');
  put(root, 'qa/miracle/registration/rules.md', '# rules');
  put(root, 'qa/miracle/registration/cases/skip.json', '{}');
  put(root, 'qa/miracle/registration/versions/v.json', '{}');
  put(root, 'portal/modules/miracle/registration/index.mjs', 'export {};');
  put(root, 'tests/augastam/registration/other.ts', 'x');
  put(root, 'tests/fixtures/f.png', 'png');
  const files = automationFiles(root, 'miracle', 'miracle-registration');
  assert.deepEqual(files, [
    'portal/modules/miracle/registration/index.mjs', 'qa/miracle/registration/adapter.json', 'qa/miracle/registration/rules.md', 'qa/miracle/registration/versions/v.json',
    'tests/fixtures/f.png', 'tests/miracle/registration/a.spec.ts',
  ]);
  assert.equal(fingerprintAutomation(root, 'miracle', 'miracle-registration').files.length, files.length);
  // a different product with the same module name sees only its own folders
  assert.deepEqual(automationFiles(root, 'augastam', 'registration'), ['tests/augastam/registration/other.ts', 'tests/fixtures/f.png']);
});

test('automation versions do not collect the old flat layout any more', t => {
  const root = tempRoot(t);
  put(root, 'tests/modules/m1/a.spec.ts', 'a');
  put(root, 'qa/modules/m1/adapter.json', '{}');
  assert.deepEqual(automationFiles(root, 'augastam', 'm1'), []);
});

test('loadTree reads tree.json from the product-scoped qa folder only (the flat one is ignored)', t => {
  const root = tempRoot(t);
  const tree = { module: 'x', version: 1, nodes: [{ id: 'root', name: 'Root', kind: 'root' }] };
  put(root, 'qa/miracle/registration/tree.json', JSON.stringify(tree));
  put(root, 'qa/modules/old/tree.json', JSON.stringify(tree));
  assert.equal(loadTree(root, 'miracle', 'miracle-registration').nodes.length, 1);
  assert.equal(loadTree(root, 'augastam', 'old'), null);
  assert.equal(loadTree(root, 'augastam', 'nothing'), null);
});

test('discovery product comes from MODULE_PRODUCT, else PORTAL_PRODUCT_ID, else it is required', () => {
  assert.equal(discoveryProduct({ MODULE_PRODUCT: 'miracle', PORTAL_PRODUCT_ID: 'augastam' }), 'miracle');
  assert.equal(discoveryProduct({ PORTAL_PRODUCT_ID: 'augastam' }), 'augastam');
  assert.equal(discoveryProduct({ MODULE_PRODUCT: '', PORTAL_PRODUCT_ID: 'miracle' }), 'miracle');
  assert.throws(() => discoveryProduct({}), /MODULE_PRODUCT is not set/);
  assert.throws(() => discoveryProduct({ MODULE_PRODUCT: '', PORTAL_PRODUCT_ID: '' }), /MODULE_PRODUCT/);
});
