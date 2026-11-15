// Registration adapter definition and data exports (moved verbatim from portal/registry.mjs).
// Must not import portal/registry.mjs (avoids import cycles).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolveModuleFolder } from '../../module-layout.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Folders come from the single layout resolver (Augastam owns the module id `registration`).
const QA_DIR = resolveModuleFolder(ROOT, 'qa', 'augastam', 'registration'), TESTS_DIR = resolveModuleFolder(ROOT, 'tests', 'augastam', 'registration');
const { FIELDS } = require(path.join(ROOT, TESTS_DIR, 'fields.ts'));
export const registrationData = require(path.join(ROOT, QA_DIR, 'cases/registration-cases.json'));
export const registrationWorkflows = require(path.join(ROOT, QA_DIR, 'workflows.json'));
const workbookFile = path.join(ROOT, QA_DIR, 'cases/registration-workbook-automation.json');
export const workbookAutomation = existsSync(workbookFile) ? require(workbookFile) : { cases: [] };
export const registrationAdapter = {
  id: 'registration', name: 'Registration · Playwright',
  spec: `${TESTS_DIR}/cases.spec.ts`,
  fields: { ...FIELDS, workflow: { label: 'Registration workflow key', kind: 'text' }, peer: { label: 'Second synthetic patient prerequisite', kind: 'text' }, search: { label: 'Search text', kind: 'text' }, id_proof_file: { label: 'ID proof (automation pending)', kind: 'text', supported: false } },
  actions: { fill: 'Fill and inspect fields', save: 'Save registration', saveTwice: 'Save the same patient twice', saveDoubleClick: 'Double-click Save', search: 'Search patients', update: 'Update a patient', workflow: 'Run a registration workflow', unavailable: 'Automation blocked — not implemented' },
  outcomes: ['created', 'blocked', 'field-state', 'observe', 'no-errors', 'duplicate-warning', 'found', 'no-error', 'not-found', 'updated', 'created-once', 'verified', 'automation-blocked'],
  variants: ['New Registration', 'New Born Registration', 'International Registration', 'Outside Registration', 'Staff Registration', 'Diagnostic Registration'],
  variantLabel: 'Registration type',
  targetLabel: 'Patient ID / previous-case reference (for updates)',
  targetPlaceholder: '{{regId@REG-001}}',
};
