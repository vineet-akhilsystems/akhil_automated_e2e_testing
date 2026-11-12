// Add reviewed automation definitions without replacing the source manual cases.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, registrationData, registrationWorkflows, validateCase } from '../../portal/registry.mjs';
import { openStore } from '../../portal/store.mjs';

const baseline = structuredClone(registrationData.cases.find(c => c.id === 'REG-001'));
baseline.id = 'REG-E2E-BASE';
baseline.title = 'Create synthetic Agent Testing patient for registration workflow checks';
baseline.mode = 'automated';
baseline.requirement = '';
const cases = [baseline];
for (const [key, flow] of Object.entries(registrationWorkflows)) {
  cases.push({
    id: `REG-FLOW-${key.toUpperCase()}`, title: flow.name,
    category: 'Registration workflows', mode: 'automated', priority: 'P1',
    action: 'workflow', input: { workflow: key, ...(key === 'partial-name-suggestions' ? { peer: '{{regId@REG-WB-022}}' } : {}) }, expected: { outcome: 'verified' },
    ...(flow.savedRecord ? { target: '{{regId@REG-E2E-BASE}}' } : {}),
    notes: `Source scenarios: ${flow.sourceCases.join(', ') || 'Registration UI source'}. ${flow.partial ? 'Partial business coverage: this test verifies only the behavior stated in its title.' : 'See workflow implementation for explicit checks.'} Check portal runs for live verification; a definition does not establish a passing result.`,
  });
}
for (const [number, legacy] of [[22, 'REG-001'], [23, 'REG-010'], [27, 'REG-004'], [34, 'REG-020']]) {
  const c = structuredClone(registrationData.cases.find(c => c.id === legacy));
  c.id = `REG-WB-${String(number).padStart(3, '0')}`;
  c.mode = 'automated'; c.requirement = '';
  c.notes = `Automated definition for TC_REG_${String(number).padStart(3, '0')}; source manual procedure retained. Live verification pending refreshed application login.`;
  cases.push(c);
}
cases.push({ id: 'REG-WB-042', title: 'Self-pay registration saves without insurance or corporate details',
  category: 'Workbook automation', priority: 'P1', mode: 'automated', action: 'save', base: 'valid',
  input: { payer_type: 'Self-Paid' },
  expected: { outcome: 'created', values: { payer: 'Cash', sponsor: 'Cash' }, persisted: { payer_type: 'Self-Paid', payer: 'Cash', sponsor: 'Cash' } },
  notes: 'TC_REG_042. Live verification pending refreshed application login.' });
const module = { adapter: 'registration', config: { bases: registrationData.bases } };
const validated = cases.map(c => validateCase(c, module));
const output = path.join(ROOT, 'qa/modules/registration/cases/registration-automation.json');
fs.writeFileSync(output, JSON.stringify({ module: 'registration', bases: registrationData.bases, cases: validated }, null, 2) + '\n');
if (process.argv.includes('--import')) {
  const store = openStore(path.resolve(process.env.PORTAL_DATA_DIR || path.join(ROOT, '.portal')));
  try {
    let added = 0;
    store.transaction(() => {
      const current = store.module('registration');
      if (!current) throw new Error('Registration module missing.');
      for (const c of validated) {
        validateCase(c, current);
        if (store.case('registration', c.id)) continue;
        store.saveCase('registration', c); added++;
      }
    });
    console.log(`Added ${added} automated cases; preserved existing case IDs and all historical results.`);
  } finally { store.close(); }
}
console.log(`Validated ${validated.length} automated cases and wrote ${output}`);
