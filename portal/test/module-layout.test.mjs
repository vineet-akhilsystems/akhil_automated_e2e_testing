import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { moduleFolder, productFolder, listProductFolders } from '../module-layout.mjs';

test('moduleFolder strips a leading product prefix from the module id', () => {
  assert.equal(moduleFolder('qa', 'miracle', 'miracle-registration'), 'qa/miracle/registration');
  assert.equal(moduleFolder('qa', 'augastam', 'registration'), 'qa/augastam/registration');
  assert.equal(moduleFolder('qa', 'miracle', 'miracle-registration-v2'), 'qa/miracle/registration-v2');
});

test('moduleFolder keeps the id when nothing would remain after stripping', () => {
  assert.equal(moduleFolder('qa', 'miracle', 'miracle-'), 'qa/miracle/miracle-');
  assert.equal(moduleFolder('qa', 'miracle', 'miracle'), 'qa/miracle/miracle');
});

test('moduleFolder resolves all three kinds', () => {
  assert.equal(moduleFolder('qa', 'miracle', 'miracle-registration'), 'qa/miracle/registration');
  assert.equal(moduleFolder('tests', 'miracle', 'miracle-registration'), 'tests/miracle/registration');
  assert.equal(moduleFolder('portal', 'miracle', 'miracle-registration'), 'portal/modules/miracle/registration');
  assert.equal(productFolder('qa', 'augastam'), 'qa/augastam');
  assert.equal(productFolder('tests', 'augastam'), 'tests/augastam');
  assert.equal(productFolder('portal', 'augastam'), 'portal/modules/augastam');
});

test('unknown kind is rejected', () => {
  assert.throws(() => moduleFolder('docs', 'a', 'b'), /folder kind "docs"/);
  assert.throws(() => productFolder('modules', 'a'), /folder kind/);
});

test('invalid ids are rejected with a message naming the value', () => {
  for (const bad of ['', '..', '.', 'a/b', 'a\b', 'Registration', '-x', 'a b', '../x', 'a..b', 'a.b', undefined, null, 5]) {
    assert.throws(() => moduleFolder('qa', 'augastam', bad), e => /Invalid module id/.test(e.message) && e.message.includes(JSON.stringify(bad) ?? 'undefined'), `module ${String(bad)}`);
    assert.throws(() => moduleFolder('qa', bad, 'registration'), /Invalid product id/, `product ${String(bad)}`);
    assert.throws(() => productFolder('tests', bad), /Invalid product id/, `productFolder ${String(bad)}`);
  }
});

test('reserved shared names cannot be product ids', () => {
  for (const name of ['knowledge', 'tools', 'shared', 'fixtures', 'discovery', 'smoke']) {
    assert.throws(() => moduleFolder('qa', name, 'registration'), e => /reserved/.test(e.message) && e.message.includes(name));
    assert.throws(() => productFolder('portal', name), /reserved/);
  }
});

test('listProductFolders reads product directories and skips files and shared folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-'));
  try {
    for (const d of ['qa/augastam/registration', 'qa/miracle', 'qa/knowledge', 'qa/tools', 'tests/augastam', 'tests/shared', 'tests/fixtures', 'tests/discovery', 'tests/smoke', 'portal/modules/miracle', 'portal/other']) {
      fs.mkdirSync(path.join(root, d), { recursive: true });
    }
    fs.writeFileSync(path.join(root, 'qa', 'impact-map.json'), '{}');
    fs.writeFileSync(path.join(root, 'tests', 'notes'), 'x');
    assert.deepEqual(listProductFolders(root, 'qa'), ['augastam', 'miracle']);
    assert.deepEqual(listProductFolders(root, 'tests'), ['augastam']);
    assert.deepEqual(listProductFolders(root, 'portal'), ['miracle']);
    assert.deepEqual(listProductFolders(path.join(root, 'nope'), 'qa'), []);
    assert.throws(() => listProductFolders(root, 'bogus'), /folder kind/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
