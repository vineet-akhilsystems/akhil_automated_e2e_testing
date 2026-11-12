import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../store.mjs';
import { loadPortalCases } from '../../qa/tools/registration-pipeline-source.mjs';

test('portal pipeline uses current edits and templates, includes prerequisites and excludes manual/disabled cases', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'registration-pipeline-'));
  const store = openStore(directory);
  try {
    const module = store.module('registration');
    module.config.bases.pipeline = { first_name: 'Synthetic' };
    store.saveModule(module, module.version);
    store.saveCase('registration', { id: 'PIPELINE-BASE', mode: 'automated', enabled: true, title: 'New portal patient', action: 'save', base: 'pipeline', input: {}, expected: { outcome: 'created' } });
    store.saveCase('registration', { id: 'PIPELINE-SEARCH', mode: 'automated', enabled: true, title: 'New portal search', action: 'search', input: { search: '{{regId@PIPELINE-BASE}}' }, expected: { outcome: 'found' } });
    store.saveCase('registration', { id: 'PIPELINE-MANUAL', mode: 'manual', title: 'Needs human verification', enabled: true });
    store.saveCase('registration', { id: 'PIPELINE-DISABLED', mode: 'automated', enabled: false });
    const snapshot = loadPortalCases(directory, ['PIPELINE-SEARCH']);
    assert.deepEqual(snapshot.cases.map(c => c.id), ['PIPELINE-BASE', 'PIPELINE-SEARCH']);
    assert.equal(snapshot.bases.pipeline.first_name, 'Synthetic');
    assert.equal(snapshot.excludedManualCases[0].id, 'PIPELINE-MANUAL');
    assert.throws(() => loadPortalCases(directory, ['PIPELINE-MANUAL']), /missing or disabled/);
    assert.throws(() => loadPortalCases(directory, ['PIPELINE-DISABLED']), /missing or disabled/);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
