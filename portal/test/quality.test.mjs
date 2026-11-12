import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { moduleCoverage, reportModel, summarizeRun } from '../quality.mjs';
import { generateAiCases } from '../ai-generator.mjs';
import { reloadAdapters } from '../registry.mjs';

const module = { id: 'registration', name: 'Registration', area: 'Patient Care', adapter: 'registration', config: { bases: { valid: { mobile: '{{phone}}', email: 'test@example.test' } }, requirements: [{ id: 'REQ-1', title: 'Mobile validation' }, { id: 'REQ-2', title: 'Permission checks' }] } };
const c = (id, extra = {}) => ({ id, version: 1, title: `Case ${id}`, mode: 'automated', enabled: true, priority: 'P1', category: 'Validation', action: 'fill', input: { mobile: '123' }, expected: { outcome: 'field-state', values: { mobile: '123' } }, requirement: 'REQ-1', ...extra });
const run = (cases, results, extra = {}) => ({ id: 'run-id', name: 'Acceptance', kind: 'tests', environmentId: 'uat', environmentName: 'UAT', environmentUrl: 'https://example.test', module: structuredClone(module), mode: 'automated', cases, results, status: 'failed', createdAt: '2026-11-01T10:00:00Z', finishedAt: '2026-11-01T10:01:00Z', ...extra });

test('report separates assertion failures, assumptions, execution errors, blocked, skipped and unexecuted cases', () => {
  const statuses = ['PASS', 'FAIL', 'FAIL (assumed requirement)', 'ERROR', 'BLOCKED', 'OBSERVED', 'SKIPPED'];
  const cases = statuses.map((_, i) => c(`REG-${i + 1}`)); cases.push(c('REG-8'));
  const r = run(cases, statuses.map((status, i) => ({ id: cases[i].id, status, expected: 'Expected', actual: 'Actual', attachments: [] })));
  assert.deepEqual(summarizeRun(r), { total: 8, recorded: 7, passed: 1, failed: 1, assumptions: 1, errors: 1, blocked: 1, observed: 1, skipped: 1, unexecuted: 1 });
  const model = reportModel(r);
  assert.deepEqual(model.findings.map(f => f.kind), ['failure', 'assumption', 'execution', 'blocked']);
  assert.equal(model.cases[7].status, 'NOT EXECUTED');
  assert.equal(model.findings[2].severity, 'Not applicable');
  assert.match(model.findings[2].classificationNote, /not established/);
});

test('report uses resolved inputs, independent triage severity, and excludes raw responses and login data', () => {
  const r = run([c('REG-1', { base: 'valid' })], [{ id: 'REG-1', status: 'FAIL', actual: 'Authorization: Bearer private-bearer-value', expected: 'Valid mobile', resolvedInput: { mobile: '9123456789', password: 'private-password-value', access_token: 'private-token-value' }, serverResponse: { internal_secret: 'never-export-this' }, attachments: [] }],
    { triage: { 'REG-1': { severity: 'High', owner: 'BA reviewer', reference: 'BUG-7', impact: 'Registration is blocked.' } }, reportDetails: { preparedBy: 'Quality team', build: '2026.11.01' } });
  const model = reportModel(r), serialized = JSON.stringify(model);
  assert.equal(model.findings[0].priority, 'P1'); assert.equal(model.findings[0].severity, 'High');
  assert.equal(model.findings[0].inputSource, 'Resolved execution inputs');
  assert.ok(serialized.includes('9123456789'));
  for (const secret of ['private-password-value', 'private-token-value', 'private-bearer-value', 'never-export-this']) assert.ok(!serialized.includes(secret));
});

test('coverage distinguishes input entry from explicit assertions and tracks missing requirements', () => {
  const cases = [c('REG-1', { base: 'valid' }), c('REG-2', { enabled: false })];
  const q = moduleCoverage(module, cases, [], 'uat');
  assert.equal(q.counts.enabled, 1); assert.equal(q.counts.disabled, 1); assert.equal(q.counts.neverRun, 1);
  const email = q.fields.find(f => f.key === 'email'); assert.deepEqual(email.exercisedBy, ['REG-1']); assert.equal(email.checkedBy.length, 0);
  assert.equal(q.requirements[0].caseIds.length, 1); assert.equal(q.requirements[1].status, 'No linked cases');
  assert.equal(q.counts.passed, 0);
});

test('coverage is environment-specific and edits or shared-data changes invalidate old results', () => {
  const cases = [c('REG-1', { base: 'valid' })];
  const passed = run(cases, [{ id: 'REG-1', status: 'PASS' }], { status: 'passed' });
  assert.equal(moduleCoverage(module, cases, [passed], 'uat').counts.passed, 1);
  assert.equal(moduleCoverage(module, cases, [passed], 'other').counts.passed, 0);
  assert.equal(moduleCoverage(module, [{ ...cases[0], version: 2 }], [passed], 'uat').counts.stale, 1);
  const changed = structuredClone(module); changed.config.bases.valid.email = 'changed@example.test';
  assert.equal(moduleCoverage(changed, cases, [passed], 'uat').counts.stale, 1);
  assert.equal(moduleCoverage(module, cases, [{ ...passed, status: 'manual' }], 'uat').counts.neverRun, 1);
});

test('passing an assumed business rule is not counted as a verified requirement', () => {
  const cases = [c('REG-1', { expected: { outcome: 'blocked', assumed: true } })];
  const passed = run(cases, [{ id: 'REG-1', status: 'PASS' }], { status: 'passed' });
  const q = moduleCoverage(module, cases, [passed], 'uat');
  assert.equal(q.counts.passed, 0); assert.equal(q.requirements[0].passedCaseIds.length, 0);
  const model = reportModel(passed);
  assert.equal(model.assumedCases, 1); assert.equal(model.cases[0].status, 'PASS (assumed rule)');
});

test('report model tracks screenshot evidence for passed, observed and failed cases and flags missing screenshots', () => {
  const cases = [
    c('REG-PASS'),
    c('REG-OBS', { expected: { outcome: 'observe' } }),
    c('REG-MISS'),
    c('REG-SKIP'),
  ];
  const results = [
    { id: 'REG-PASS', status: 'PASS', expected: 'field-state', actual: 'ok', attachments: [{ name: 'REG-PASS - Final result PASS', path: 'artifacts/pass.png', contentType: 'image/png' }] },
    { id: 'REG-OBS', status: 'OBSERVED', expected: 'observe', actual: 'observed state', attachments: [{ name: 'REG-OBS - Module opened', path: 'artifacts/obs.png', contentType: 'image/png' }], evidenceWarnings: ['Final result OBSERVED: screenshot unavailable (Target closed)'] },
    { id: 'REG-MISS', status: 'PASS', expected: 'field-state', actual: 'ok', attachments: [], evidenceWarnings: ['Inputs applied: screenshot unavailable (timeout)'] },
    { id: 'REG-SKIP', status: 'SKIPPED', expected: 'field-state', actual: 'skipped', attachments: [] },
  ];
  const r = run(cases, results, { status: 'passed' });
  const model = reportModel(r);
  assert.deepEqual(model.evidenceCounts, { executed: 3, withScreenshots: 2, missingScreenshots: 1, warnings: 2, totalScreenshots: 2 });
  assert.equal(model.cases[0].evidenceState, 'captured');
  assert.equal(model.cases[0].screenshotCount, 1);
  assert.equal(model.cases[1].evidenceState, 'partial');
  assert.match(model.cases[1].evidenceSummary, /1 screenshot captured \(1 capture warning\)/);
  assert.equal(model.cases[2].evidenceState, 'missing');
  assert.match(model.cases[2].evidenceSummary, /Screenshot could not be captured/);
  assert.equal(model.cases[3].evidenceState, 'skipped');
  const q = moduleCoverage(module, cases, [r], 'uat');
  assert.equal(q.counts.missingEvidence, 1);
  assert.equal(q.cases.find(x => x.id === 'REG-PASS').latest.screenshots, 1);
  assert.equal(q.cases.find(x => x.id === 'REG-MISS').latest.evidenceState, 'missing');
});

test('AI generator: non-registration automated modules get only adapter-driven cases', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ai-gen-'));
  mkdirSync(path.join(root, 'qa', 'modules', 'billing'), { recursive: true });
  mkdirSync(path.join(root, 'tests', 'modules', 'billing'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'modules', 'billing', 'cases.spec.ts'), '// spec\n');
  writeFileSync(path.join(root, 'qa', 'modules', 'billing', 'adapter.json'), JSON.stringify({
    id: 'billing', name: 'Billing', spec: 'tests/modules/billing/cases.spec.ts',
    actions: { fill: 'Fill', save: 'Save', search: 'Search' }, outcomes: ['created', 'blocked', 'no-errors', 'no-error'],
    variants: ['Cash Bill', 'Credit Bill'],
    fields: { bill_to: { label: 'Bill to', kind: 'text', required: true }, ward: { label: 'Ward', kind: 'select' }, search: { label: 'Search text', kind: 'text' } },
  }));
  try {
    reloadAdapters({ root, warn: () => {} });
    const mod = { id: 'billing', name: 'Billing', adapter: 'billing', config: { bases: {}, requirements: [] } };
    const out = await generateAiCases({ module: mod, existingCases: [], options: { count: 20 } });
    const titles = out.drafts.map(d => d.title).join('\n');
    assert.ok(out.drafts.length >= 7);
    assert.ok(out.drafts.every(d => d.mode === 'automated' && d.id.startsWith('TC-')));
    assert.match(titles, /Bill to containing only whitespace/);
    assert.match(titles, /Bill to rejects or safely handles a 500-character/);
    assert.match(titles, /Ward is retained and persisted/);
    assert.match(titles, /Cash Bill variant/); assert.match(titles, /Credit Bill variant/);
    assert.match(titles, /Agent\(test/); assert.match(titles, /Agent\+\+/);
    assert.ok(!/Diagnostic Registration|Ms\.|Mother UHID|Emergency/.test(titles), 'registration blueprints must not leak');
    const ws = out.drafts.find(d => /only whitespace/.test(d.title));
    assert.equal(ws.input.bill_to, '     ');
  } finally { reloadAdapters({ warn: () => {} }); rmSync(root, { recursive: true, force: true }); }
});

test('AI generator: every AI preset and a "workflow" prompt succeed for Registration', async () => {
  const { AI_PRESETS } = await import('../ai-generator.mjs');
  assert.ok(AI_PRESETS.length > 0);
  const prompts = [...AI_PRESETS.map(p => p.prompt ?? ''), 'test the registration workflow end to end', 'peer workflow'];
  for (const prompt of prompts) {
    const out = await generateAiCases({ module, existingCases: [], options: { count: 20, prompt } });
    assert.ok(out.drafts.length >= 1, `no drafts for prompt: ${prompt}`);
    assert.ok(out.drafts.every(d => !Object.hasOwn(d.input ?? {}, 'workflow') || d.action === 'workflow'), `internal field leaked for: ${prompt}`);
  }
});

test('AI generator: registration still receives its curated blueprints', async () => {
  const out = await generateAiCases({ module, existingCases: [], options: { count: 20, focus: 'ui' } });
  assert.ok(out.drafts.some(d => /Diagnostic Registration/.test(d.title)));
});

const DOMAIN_WORDS = /registration|uhid|patient|newborn|guardian|REG-/i;

test('AI presets are module-aware: neutral for other modules, curated for Registration, all with descriptions', async () => {
  const { presetsFor, AI_PRESETS } = await import('../ai-generator.mjs');
  const neutral = presetsFor({ id: 'billing', name: 'Billing' });
  assert.ok(neutral.length >= 5 && neutral.some(p => p.id === 'out-of-box'));
  assert.ok(neutral.every(p => p.description && p.label && p.prompt && !p.modules));
  assert.ok(!DOMAIN_WORDS.test(JSON.stringify(neutral)), 'neutral presets leak domain words');
  const reg = presetsFor(module);
  assert.ok(reg.every(p => p.description));
  assert.match(JSON.stringify(reg), /receptionists/); assert.match(JSON.stringify(reg), /UHID/);
  assert.ok(AI_PRESETS.every(p => p.description));
});

test('AI generator: module without adapter uses its own prefix from 001, never the prompt as subject, no domain words', async () => {
  const mod = { id: 'billing', name: 'Billing', prefix: 'BIL', config: { bases: {}, requirements: [] } };
  const { presetsFor } = await import('../ai-generator.mjs');
  const prompts = ['', 'Zebra crossing prompt text', ...presetsFor(mod).map(p => p.prompt)];
  for (const prompt of prompts) {
    const out = await generateAiCases({ module: mod, existingCases: [], options: { count: 5, prompt } });
    assert.deepEqual(out.drafts.map(d => d.id), ['BIL-001', 'BIL-002', 'BIL-003', 'BIL-004', 'BIL-005']);
    assert.ok(out.drafts.every(d => d.mode === 'manual' && !d.title.includes('Zebra')));
    assert.ok(!DOMAIN_WORDS.test(JSON.stringify(out.drafts.map(({ notes, ...d }) => d))), 'drafts leak domain words');
  }
  const withPrompt = await generateAiCases({ module: mod, existingCases: [], options: { count: 2, prompt: 'Zebra crossing prompt text' } });
  assert.ok(withPrompt.drafts.every(d => d.notes.includes('Zebra crossing prompt text')));
  const existing = [{ id: 'BIL-007', title: 'x' }, { id: 'REG-300', title: 'y' }];
  const next = await generateAiCases({ module: mod, existingCases: existing, options: { count: 2 } });
  assert.deepEqual(next.drafts.map(d => d.id), ['BIL-008', 'BIL-009']);
});

test('AI generator: adapter module numbers from its prefix and Registration continues from its own highest id', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ai-gen-'));
  mkdirSync(path.join(root, 'qa', 'modules', 'billing'), { recursive: true });
  mkdirSync(path.join(root, 'tests', 'modules', 'billing'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'modules', 'billing', 'cases.spec.ts'), '// spec\n');
  writeFileSync(path.join(root, 'qa', 'modules', 'billing', 'adapter.json'), JSON.stringify({
    id: 'billing', name: 'Billing', spec: 'tests/modules/billing/cases.spec.ts', prefix: 'BIL',
    actions: { fill: 'Fill', save: 'Save', search: 'Search' }, outcomes: ['created', 'blocked', 'no-errors', 'no-error'], variants: ['Cash Bill'],
    fields: { bill_to: { label: 'Bill to', kind: 'text', required: true }, search: { label: 'Search text', kind: 'text' } },
  }));
  try {
    reloadAdapters({ root, warn: () => {} });
    const mod = { id: 'billing', name: 'Billing', prefix: 'BIL', adapter: 'billing', config: { bases: {}, requirements: [] } };
    const out = await generateAiCases({ module: mod, existingCases: [], options: { count: 4 } });
    assert.deepEqual(out.drafts.map(d => d.id), ['BIL-001', 'BIL-002', 'BIL-003', 'BIL-004']);
    assert.ok(!DOMAIN_WORDS.test(JSON.stringify(out.drafts.map(({ notes, ...d }) => d)).replace(/registrationType/g, 'variantKey')), 'adapter drafts leak domain words');
    // explicit environment and environments list are accepted
    const env = await generateAiCases({ module: mod, existingCases: [], options: { count: 1 }, environments: [{ id: 'uat' }] });
    assert.equal(env.drafts[0].id, 'BIL-001');
  } finally { reloadAdapters({ warn: () => {} }); rmSync(root, { recursive: true, force: true }); }
  const regMod = { ...module, prefix: 'REG' };
  const reg = await generateAiCases({ module: regMod, existingCases: [{ id: 'REG-012', title: 'a' }], options: { count: 2 } });
  assert.deepEqual(reg.drafts.map(d => d.id), ['REG-013', 'REG-014']);
});
