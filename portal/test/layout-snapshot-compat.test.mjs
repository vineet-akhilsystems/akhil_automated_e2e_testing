import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../store.mjs';
import { validateCase } from '../registry.mjs';

// A teammate's snapshot (or an existing .portal database) written before the product-scoped layout move holds the OLD ID-proof fixture path
// in REG-120. Importing it and validating the stored case must still work: the one compatibility mapping in the Registration plugin accepts it.
const OLD = 'qa/modules/registration/data/agent-test-id-proof.pdf';
const NEW = 'qa/augastam/registration/data/agent-test-id-proof.pdf';
const REPO_SNAPSHOT = new URL('../../portal-data/snapshot.json', import.meta.url);

function importOld(t, text) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-compat-'));
  const file = path.join(tmp, 'snapshot.json');
  fs.writeFileSync(file, text);
  const store = openStore(path.join(tmp, 'db'), { snapshotFile: file });
  t.after(() => { store.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  return store;
}

test('the committed snapshot holds the new path, and an old-path snapshot imports and still validates', t => {
  const current = fs.readFileSync(REPO_SNAPSHOT, 'utf8');
  assert.ok(current.includes(NEW) && !current.includes(OLD), 'the committed snapshot uses the product-scoped fixture path');
  const old = current.split(NEW).join(OLD);
  assert.ok(old.includes(OLD) && !old.includes(NEW));
  const store = importOld(t, old);
  const module = store.module('registration');
  assert.ok(module, 'module imported');
  const stored = store.cases('registration').find(c => c.id === 'REG-120');
  assert.equal(stored.input.id_proof_file, OLD, 'the imported row keeps the old string (nothing rewrites live data)');
  // the stored case (disabled: upload automation is pending) validates through the plugin
  assert.doesNotThrow(() => validateCase(structuredClone(stored), module));
  // the mapping is exact: a different old-layout path in the same row is refused
  const other = { ...structuredClone(stored), input: { id_proof_file: 'qa/modules/registration/data/other.pdf' } };
  assert.throws(() => validateCase(other, module), /synthetic ID-proof fixture/);
  // an enabled copy stays blocked because the upload is not automated, old path or new
  assert.throws(() => validateCase({ ...structuredClone(stored), enabled: true }, module), /pending/);
});
