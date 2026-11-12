import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateCase, registrationWorkflows, resolveCases } from '../registry.mjs';

const module = { adapter: 'registration', config: { bases: { valid: {} } } };
const flow = (workflow = 'new-reset', extra = {}) => ({ id: 'FLOW-1', title: 'Workflow check', action: 'workflow', input: { workflow }, expected: { outcome: 'verified' }, ...extra });
test('workflow validation rejects unknown keys, incompatible checks and missing saved-patient prerequisites', () => {
  assert.throws(() => validateCase(flow('arbitrary-code'), module), /supported registration workflow/);
  assert.throws(() => validateCase(flow('constructor'), module), /supported registration workflow/);
  assert.throws(() => validateCase(flow('update-remarks'), module), /Synthetic patient/);
  assert.throws(() => validateCase(flow('new-reset', { expected: { outcome: 'verified', persisted: { email: '*' } } }), module), /separate field\/toast checks/);
  assert.throws(() => validateCase(flow('new-reset', { base: 'valid' }), module), /manage their own data/);
  assert.throws(() => validateCase(flow('new-reset', { input: { workflow: 'new-reset', first_name: 'Agent' } }), module), /only workflow/);
  assert.throws(() => validateCase(flow('new-reset', { action: 'fill', expected: { outcome: 'field-state' } }), module), /only be used with a workflow/);
});
test('all shipped definitions validate and every synthetic prerequisite precedes its workflow', () => {
  const doc = JSON.parse(fs.readFileSync('qa/modules/registration/cases/registration-automation.json', 'utf8'));
  assert.equal(doc.cases.length, Object.keys(registrationWorkflows).length + 6);
  for (const c of doc.cases) validateCase(c, module);
  for (const c of doc.cases.filter(c => c.target)) {
    const resolved = resolveCases(doc.cases, [c.id]);
    assert.ok(resolved.slice(0, -1).some(c => c.id === 'REG-E2E-BASE'));
    if (c.input.workflow === 'partial-name-suggestions') assert.ok(resolved.slice(0, -1).some(c => c.id === 'REG-WB-022'));
    assert.equal(resolved.at(-1).id, c.id);
  }
  assert.equal(new Set(doc.cases.map(c => c.id)).size, doc.cases.length);
});
