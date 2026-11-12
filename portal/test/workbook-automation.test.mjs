import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { validateCase, workbookAutomation, registrationData, registrationWorkflows, resolveCases } from '../registry.mjs';

const module = { adapter: 'registration', config: { bases: registrationData.bases } };
const { toXlsx, fromXlsx } = createRequire(import.meta.url)('../../qa/tools/cases-io.js');
test('all 80 source procedures are preserved and executable mappings are distinct from missing automation', () => {
  const original = JSON.parse(fs.readFileSync('qa/modules/registration/cases/registration-business-cases.json', 'utf8'));
  assert.equal(workbookAutomation.cases.length, 80);
  assert.equal(new Set(workbookAutomation.cases.map(c => c.id)).size, 80);
  assert.equal(workbookAutomation.cases.filter(c => c.action !== 'unavailable').length, 21);
  for (const c of workbookAutomation.cases) {
    validateCase(c, module);
    const source = original.cases.find(s => s.id === c.id);
    assert.deepEqual(c.steps, source.steps);
    assert.equal(c.mode, 'automated');
    assert.equal(c.expected.note, source.steps[0].expected);
    if (c.action === 'unavailable') {
      assert.equal(c.automationReadiness, 'blocked');
      assert.ok(c.automationBlocker.length > 30);
      assert.equal(c.expected.outcome, 'automation-blocked');
      assert.equal(c.target, undefined);
    } else if (c.action === 'workflow') assert.ok(registrationWorkflows[c.input.workflow]);
  }
  const baseline = { ...registrationData.cases[0], id: 'REG-E2E-BASE' };
  assert.equal(resolveCases([...workbookAutomation.cases, baseline], ['TC_REG_018'])[0].id, baseline.id);
});
test('unreviewed blockers, changed procedures and assertion claims on blocked cases are rejected', () => {
  const blocked = structuredClone(workbookAutomation.cases.find(c => c.id === 'TC_REG_066'));
  assert.throws(() => validateCase({ ...blocked, id: 'FAKE-1' }, module), /reviewed automation mapping/);
  assert.throws(() => validateCase({ ...blocked, automationBlocker: 'Pretend passed' }, module), /contract changed/);
  assert.throws(() => validateCase({ ...blocked, expected: { ...blocked.expected, values: { first_name: 'Agent' } } }, module), /contract changed/);
  blocked.steps[0].expected = 'A different business requirement';
  assert.throws(() => validateCase(blocked, module), /procedure changed/);
});
test('Excel export preserves workbook provenance and blocker reasons for re-import', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbook-roundtrip-'));
  const file = path.join(directory, 'cases.xlsx');
  try {
    const cases = workbookAutomation.cases.filter(c => ['TC_REG_025', 'TC_REG_066'].includes(c.id));
    await toXlsx(cases, file);
    const loaded = await fromXlsx(file);
    for (const c of loaded) validateCase(c, module);
    assert.deepEqual(loaded.map(c => c.sourceWorkbook), cases.map(c => c.sourceWorkbook));
    assert.equal(loaded.find(c => c.id === 'TC_REG_066').automationBlocker, cases.find(c => c.id === 'TC_REG_066').automationBlocker);
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(directory); }
});
