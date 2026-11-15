import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveIdProofFixture, LEGACY_ID_PROOF_FIXTURE } from '../modules/augastam/registration/validate.mjs';
import { validateCase } from '../registry.mjs';
import { openStore } from '../store.mjs';

// Compatibility mapping for portal databases created before the product-scoped layout move (2026-11-15):
// a stored case may still hold the old fixture path. It is the ONLY old-layout string the runtime still understands.
const NEW_PROOF = 'qa/augastam/registration/data/agent-test-id-proof.pdf';

test('the legacy ID-proof fixture path maps to the current fixture path; anything else is refused', () => {
  assert.equal(LEGACY_ID_PROOF_FIXTURE, 'qa/modules/registration/data/agent-test-id-proof.pdf');
  assert.equal(resolveIdProofFixture(LEGACY_ID_PROOF_FIXTURE), NEW_PROOF);
  assert.equal(resolveIdProofFixture(NEW_PROOF), NEW_PROOF);
  for (const other of ['qa/modules/registration/data/other.pdf', 'qa/modules/billing/data/agent-test-id-proof.pdf', 'qa/augastam/registration/data/../x.pdf', '', null, undefined, 5]) {
    assert.equal(resolveIdProofFixture(other), null, String(other));
  }
});

test('a stored Registration case holding the old ID-proof path still validates (disabled), and a wrong path is still rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-compat-'));
  const store = openStore(dir);
  try {
    const module = store.module('registration');
    const base = proof => ({ id: 'ZZ-PROOF', title: 'ID proof', mode: 'automated', category: 'Validation', priority: 'P2', enabled: false, action: 'fill', input: { id_proof_file: proof }, expected: { outcome: 'no-errors' }, registrationType: 'New Registration', base: 'valid' });
    for (const proof of [LEGACY_ID_PROOF_FIXTURE, NEW_PROOF]) assert.doesNotThrow(() => validateCase(base(proof), module), proof);
    assert.throws(() => validateCase(base('qa/modules/registration/data/other.pdf'), module), /synthetic ID-proof fixture/);
    // an enabled case is still blocked because upload automation is pending, whichever path it holds
    assert.throws(() => validateCase({ ...base(LEGACY_ID_PROOF_FIXTURE), enabled: true }, module), /pending/);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
