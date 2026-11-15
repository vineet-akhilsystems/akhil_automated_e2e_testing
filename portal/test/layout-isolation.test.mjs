import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// check-module-isolation on temp trees (--root): product folders, including qa/<product>/** data files, must not refer to another product.
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude', 'skills', 'checking-module-isolation', 'check-module-isolation.mjs');

function world(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (rel, text) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  // both products have a module called "registration"
  put('qa/augastam/registration/adapter.json', '{}');
  put('qa/miracle/registration/adapter.json', '{}');
  put('tests/augastam/registration/a.ts', "export const a = 1;\n");
  put('tests/miracle/registration/m.ts', "export const m = 1;\n");
  for (const [rel, text] of Object.entries(files)) put(rel, text);
  const run = () => spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  return { root, put, run };
}
const errors = r => r.stdout.split('\n').filter(l => l.startsWith('ERROR'));

test('a clean two-product tree (both with a module called registration) passes', t => {
  const w = world(t, { 'qa/miracle/registration/cases/c.json': '{"path":"qa/miracle/registration/data/x.pdf"}', 'qa/miracle/registration/manifest.yaml': 'module: registration\nproduct: miracle\n' });
  const r = w.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Modules: augastam\/registration, miracle\/registration/);
});

test('a JSON file in qa/<product>/** that names another product is an ERROR', t => {
  const w = world(t, { 'qa/miracle/registration/workflows.json': '{"upload":"qa/augastam/registration/data/proof.pdf"}' });
  const r = w.run();
  assert.equal(r.status, 1, r.stdout);
  assert.ok(errors(r).some(l => /qa\/miracle\/registration\/workflows\.json:1/.test(l) && /product "miracle" refers to the folders of product "augastam"/.test(l)), r.stdout);
});

test('a YAML manifest in qa/<product>/** that names another product is an ERROR, a YAML comment is not', t => {
  const w = world(t, { 'qa/miracle/registration/manifest.yaml': '# copied from qa/augastam/registration\nmodule: registration\ncases: cases/c.json\n' });
  assert.equal(w.run().status, 0);
  w.put('qa/miracle/registration/manifest.yml', 'cases: ../../augastam/registration/cases/x.json\ndata: tests/augastam/registration/data\n');
  const r = w.run();
  assert.equal(r.status, 1, r.stdout);
  assert.ok(errors(r).some(l => /manifest\.yml:2/.test(l)), r.stdout);
});

test('same module name in both products: a Miracle file pointing at the Augastam registration folders is an ERROR, in code and in data', t => {
  const w = world(t);
  w.put('tests/miracle/registration/m.ts', "import data from '../../../qa/augastam/registration/cases/c.json';\n");
  let r = w.run();
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /module "miracle\/registration" refers to module "augastam\/registration"/);
  w.put('tests/miracle/registration/m.ts', 'export const m = 1;\n');
  w.put('qa/miracle/registration/rules.json', '{"see":"tests/augastam/registration/a.ts"}');
  r = w.run();
  assert.equal(r.status, 1, r.stdout);
  w.put('qa/miracle/registration/rules.json', '{"see":"tests/miracle/registration/m.ts"}');
  assert.equal(w.run().status, 0);
});

test('quoted path parts naming another product are caught (path.join and portal/modules)', t => {
  const w = world(t);
  const cases = [
    "const p = path.join(root, 'qa', 'augastam', 'registration', 'cases');",
    'const p = path.join(root, "tests", "augastam");',
    "const p = path.join(root, 'portal', 'modules', 'augastam', 'registration');",
    "const f = moduleFolder('qa', 'augastam', 'registration');",
  ];
  for (const line of cases) {
    w.put('tests/miracle/registration/m.ts', line + '\n');
    const r = w.run();
    assert.equal(r.status, 1, line + '\n' + r.stdout);
  }
  w.put('tests/miracle/registration/m.ts', "const p = path.join(root, 'qa', 'miracle', 'registration');\n");
  assert.equal(w.run().status, 0);
});

test('results folders under qa/<product>/** are historical outputs and are not scanned', t => {
  const w = world(t, { 'qa/miracle/registration/results/old/results.json': '{"x":"qa/augastam/registration/data/p.pdf"}' });
  assert.equal(w.run().status, 0);
});

test('shared code that names a module is still NEW unless baselined', t => {
  const w = world(t, { 'portal/shared.mjs': "export const id = 'registration';\n" });
  const r = w.run();
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /NEW\s+portal\/shared\.mjs:1/);
});
