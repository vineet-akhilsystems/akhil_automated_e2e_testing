import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { adapters, reloadAdapters, validateCase, workbookAutomation } from '../registry.mjs';
import { openStore } from '../store.mjs';
import { generateAiCases, presetsFor, AI_PRESETS } from '../ai-generator.mjs';
import { readiness } from '../readiness.mjs';
import { instructions, createAgentRunner } from '../agent.mjs';
import { assertPlugin } from '../modules/contract.mjs';
import { createPluginRegistry } from '../modules/index.mjs';

// Characterization snapshot of everything Registration-specific in shared portal code (Plan 2, Task 0).
// Later tasks move that behavior into portal/modules/registration/; this golden must stay identical.
// Regenerate deliberately with UPDATE_GOLDEN=1 (only ever against pre-refactor code).
//
// Determinism: generateAiCases takes no clock and no randomness (ids continue from the existing cases, every
// blueprint is a literal or derived from the adapter), so full draft content is compared via a SHA-256 plus the
// readable fields (ids, titles, categories, count). Nothing needs stubbing.
const GOLDEN = fileURLToPath(new URL('./module-plugins.golden.json', import.meta.url));
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const golden = UPDATE || !fs.existsSync(GOLDEN) ? {} : JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
const collected = {};
const clean = v => JSON.parse(JSON.stringify(v));
const sha = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function snap(key, value) {
  const actual = clean(value);
  collected[key] = actual;
  if (!UPDATE) assert.deepEqual(actual, golden[key], `golden mismatch for ${key}`);
}
after(() => { if (UPDATE) fs.writeFileSync(GOLDEN, JSON.stringify(collected, null, 2) + '\n'); });

// ---- dynamic (adapter.json) module fixture, as in registry-dynamic.test.mjs ----
const billing = () => ({
  id: 'billing', name: 'Billing - Playwright', spec: 'tests/modules/billing/cases.spec.ts', prefix: 'BIL',
  actions: { fill: 'Fill and inspect fields', save: 'Save', search: 'Search', update: 'Update', unavailable: 'Blocked' },
  outcomes: ['created', 'blocked', 'no-errors', 'no-error', 'found', 'updated', 'verified'],
  variants: ['Cash Bill', 'Credit Bill'],
  fields: { bill_to: { label: 'Bill to', kind: 'text', required: true }, amount: { label: 'Amount', kind: 'number' }, search: { label: 'Search text', kind: 'text' } },
  bases: { valid: { bill_to: 'Agent Testing', amount: '10' } },
});
const billingModule = { id: 'billing', productId: 'augastam', name: 'Billing', area: 'Finance', prefix: 'BIL', adapter: 'billing', config: { bases: { valid: { bill_to: 'Agent Testing', amount: '10' } }, requirements: [] } };
function withBilling(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-plugins-'));
  fs.mkdirSync(path.join(root, 'qa', 'modules', 'billing'), { recursive: true });
  fs.writeFileSync(path.join(root, 'qa', 'modules', 'billing', 'adapter.json'), JSON.stringify(billing()));
  fs.mkdirSync(path.join(root, 'tests', 'modules', 'billing'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'modules', 'billing', 'cases.spec.ts'), '// spec\n');
  try {
    reloadAdapters({ root, warn: () => {} });
    return fn();
  } finally { reloadAdapters({ warn: () => {} }); fs.rmSync(root, { recursive: true, force: true }); }
}
async function withBillingAsync(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-plugins-'));
  fs.mkdirSync(path.join(root, 'qa', 'modules', 'billing'), { recursive: true });
  fs.writeFileSync(path.join(root, 'qa', 'modules', 'billing', 'adapter.json'), JSON.stringify(billing()));
  fs.mkdirSync(path.join(root, 'tests', 'modules', 'billing'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'modules', 'billing', 'cases.spec.ts'), '// spec\n');
  try {
    reloadAdapters({ root, warn: () => {} });
    return await fn();
  } finally { reloadAdapters({ warn: () => {} }); fs.rmSync(root, { recursive: true, force: true }); }
}

function seededStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-plugins-store-'));
  const store = openStore(dir);
  return { store, dir, done: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const outcomeOf = (module, raw) => {
  try { const c = validateCase(raw, module); return { ok: true, automationReadiness: c.automationReadiness ?? null, action: c.action ?? null }; }
  catch (e) { return { error: e.message, status: e.status ?? null }; }
};

// (a) adapters.registration -----------------------------------------------------------------------------------
test('(a) adapters.registration is byte-identical', () => {
  const json = JSON.stringify(adapters.registration);
  snap('a.adapterRegistration', { sha256: sha(json), length: json.length, json: adapters.registration });
});

// (b) validateCase ----------------------------------------------------------------------------------------------
test('(b) validateCase messages for Registration branches and dynamic adapters', async () => {
  const { store, done } = seededStore();
  try {
    const regModule = store.module('registration');
    const src = id => structuredClone(workbookAutomation.cases.find(c => c.id === id));
    const base = (extra = {}) => ({ id: 'ZZ-1', title: 'T', action: 'fill', base: 'valid', input: { first_name: 'Agent' }, expected: { outcome: 'no-errors' }, registrationType: 'New Registration', ...extra });
    const wf = (input, extra = {}) => ({ id: 'ZZ-WF', title: 'Workflow', action: 'workflow', input, expected: { outcome: 'verified' }, ...extra });
    const proof = 'qa/modules/registration/data/agent-test-id-proof.pdf';
    const reg = {
      'fill valid': base(),
      'save valid': base({ action: 'save', expected: { outcome: 'created', persisted: { first_name: 'Agent' }, toastContains: 'Registration' } }),
      'search valid': base({ action: 'search', base: undefined, registrationType: undefined, input: { search: 'Agent' }, expected: { outcome: 'found' } }),
      'search with other inputs': base({ action: 'search', base: undefined, input: { search: 'Agent', first_name: 'x' }, expected: { outcome: 'found' } }),
      'search without text': base({ action: 'search', base: undefined, input: {}, expected: { outcome: 'found' } }),
      'update valid': base({ action: 'update', target: '{{regId@REG-001}}', expected: { outcome: 'updated', saveDisabled: false } }),
      'update without target': base({ action: 'update', expected: { outcome: 'updated' } }),
      'workbook id without source mapping': base({ id: 'TC_REG_022' }),
      'workbook source procedure changed': { ...src('TC_REG_022'), steps: [{ action: 'x', expected: 'y' }] },
      'workbook source contract changed': { ...src('TC_REG_022'), input: { first_name: 'Other' } },
      'workbook source exact copy': src('TC_REG_022'),
      'workbook source on unknown id': { ...src('TC_REG_022'), id: 'TC_REG_NOPE' },
      'workbook source on manual mode': { ...src('TC_REG_022'), mode: 'manual' },
      'blocked workbook exact copy': src('TC_REG_001'),
      'workbook workflow exact copy': src('TC_REG_014'),
      'workbook workflow changed input': { ...src('TC_REG_014'), input: { workflow: 'new-reset' } },
      'workbook save-blocked exact copy': src('TC_REG_023'),
      'blocked workbook changed blocker': { ...src('TC_REG_001'), automationBlocker: 'changed' },
      'blocked workbook with input added': { ...src('TC_REG_001'), input: { first_name: 'x' } },
      'blocked workbook disabled exact copy': { ...src('TC_REG_001'), enabled: false },
      'blocked with unregistered id': base({ action: 'unavailable', input: {}, base: undefined, registrationType: undefined, expected: { outcome: 'automation-blocked' } }),
      'blocked with wrong blocker text': { ...base({ action: 'unavailable', input: {}, base: undefined, registrationType: undefined, expected: { outcome: 'automation-blocked' }, automationBlocker: 'nope' }), id: 'TC_REG_001', sourceWorkbook: undefined },
      'automation-blocked outcome on fill': base({ expected: { outcome: 'automation-blocked' } }),
      'unsupported action': base({ action: 'nope' }),
      'unsupported outcome': base({ expected: { outcome: 'nope' } }),
      'unknown input field': base({ input: { nope: 'x' } }),
      'input wrong type': base({ input: { first_name: 5 } }),
      'bad values map': base({ expected: { outcome: 'no-errors', values: { nope: 'x' } } }),
      'unknown base': base({ base: 'nope' }),
      'unsupported variant': base({ registrationType: 'Bogus Registration' }),
      'id proof wrong path': base({ input: { id_proof_file: 'somewhere/else.pdf' } }),
      'id proof enabled': base({ input: { id_proof_file: proof } }),
      'id proof disabled': base({ input: { id_proof_file: proof }, enabled: false }),
      'workflow ok not-saved': wf({ workflow: 'new-reset' }),
      'workflow ok saved record': wf({ workflow: 'search-identity' }, { target: '{{regId@REG-001}}' }),
      'workflow ok update email': wf({ workflow: 'update-remarks', email: 'a@b.co' }, { target: '{{regId@REG-001}}' }),
      'workflow ok partial peer': wf({ workflow: 'partial-name-suggestions', peer: '{{peer@REG-002}}' }, { target: '{{regId@REG-001}}' }),
      'workflow missing key': wf({}),
      'workflow unknown key': wf({ workflow: 'nope' }),
      'workflow wrong outcome': wf({ workflow: 'new-reset' }, { expected: { outcome: 'no-errors' } }),
      'workflow with base': wf({ workflow: 'new-reset' }, { base: 'valid' }),
      'workflow with variant': wf({ workflow: 'new-reset' }, { registrationType: 'New Registration' }),
      'workflow extra input': wf({ workflow: 'new-reset', first_name: 'x' }),
      'workflow partial without peer': wf({ workflow: 'partial-name-suggestions' }, { target: '{{regId@REG-001}}' }),
      'workflow peer on other workflow': wf({ workflow: 'new-reset', peer: 'x' }),
      'workflow email on other workflow': wf({ workflow: 'new-reset', email: 'a@b.co' }),
      'workflow with field checks': wf({ workflow: 'new-reset' }, { expected: { outcome: 'verified', values: { first_name: 'x' } } }),
      'workflow with toast check': wf({ workflow: 'new-reset' }, { expected: { outcome: 'verified', toastContains: 'x' } }),
      'workflow assumed': wf({ workflow: 'new-reset' }, { expected: { outcome: 'verified', assumed: true } }),
      'workflow saved record without target': wf({ workflow: 'search-identity' }),
      'workflow blank start with target': wf({ workflow: 'new-reset' }, { target: '{{regId@REG-001}}' }),
      'workflow key on fill': base({ input: { workflow: 'new-reset' } }),
      'peer on fill': base({ input: { peer: 'x' } }),
      'verified outcome on fill': base({ expected: { outcome: 'verified' } }),
      'search text on fill': base({ input: { search: 'x' } }),
      'persisted on fill': base({ expected: { outcome: 'no-errors', persisted: { first_name: 'x' } } }),
      'saveDisabled on save': base({ action: 'save', expected: { outcome: 'created', saveDisabled: true } }),
      'toast on fill': base({ expected: { outcome: 'no-errors', toastContains: 'x' } }),
      'observe with assertions': base({ expected: { outcome: 'observe', values: { first_name: 'x' } } }),
      'registration by adapter only': { ...base(), id: 'ZZ-2' },
    };
    const regAdapterOnly = { id: 'other-id', adapter: 'registration', config: regModule.config };
    const out = {};
    for (const [name, raw] of Object.entries(reg)) out[name] = outcomeOf(regModule, raw);
    out['registration by adapter only'] = outcomeOf(regAdapterOnly, base({ id: 'ZZ-3' }));
    out['manual valid'] = outcomeOf(regModule, { id: 'M-1', title: 'T', mode: 'manual', steps: [{ action: 'a', expected: 'b' }] });
    out['manual without steps'] = outcomeOf(regModule, { id: 'M-2', title: 'T', mode: 'manual' });
    out['no adapter'] = outcomeOf({ id: 'plain', config: {} }, { id: 'P-1', title: 'T', mode: 'automated', action: 'fill', input: {}, expected: { outcome: 'x' } });

    const dyn = withBilling(() => {
      const d = {};
      const bb = (extra = {}) => ({ id: 'BIL-1', title: 'T', action: 'fill', base: 'valid', input: { bill_to: 'x' }, expected: { outcome: 'no-errors' }, registrationType: 'Cash Bill', ...extra });
      d['dynamic fill ok'] = outcomeOf(billingModule, bb());
      d['dynamic update without target'] = outcomeOf(billingModule, bb({ action: 'update', expected: { outcome: 'updated' } }));
      d['dynamic update with target'] = outcomeOf(billingModule, bb({ action: 'update', target: 'BIL-000', expected: { outcome: 'updated' } }));
      d['dynamic workflow key is just an unsupported action'] = outcomeOf(billingModule, bb({ action: 'workflow' }));
      d['dynamic id_proof_file is an unknown field'] = outcomeOf(billingModule, bb({ input: { id_proof_file: 'x' } }));
      d['dynamic verified outcome allowed on fill'] = outcomeOf(billingModule, bb({ expected: { outcome: 'verified' } }));
      d['dynamic workflow input field unknown'] = outcomeOf(billingModule, bb({ input: { workflow: 'new-reset' } }));
      d['dynamic registration workbook id has no special meaning'] = outcomeOf(billingModule, bb({ id: 'TC_REG_022' }));
      d['dynamic sourceWorkbook does not unlock workbook mapping'] = outcomeOf(billingModule, bb({ sourceWorkbook: 'x.xlsx' }));
      d['dynamic unavailable needs reviewed source'] = outcomeOf(billingModule, bb({ action: 'unavailable', input: {}, expected: { outcome: 'automation-blocked' } }));
      d['dynamic automation-blocked on fill'] = outcomeOf(billingModule, bb({ expected: { outcome: 'automation-blocked' } }));
      d['dynamic unsupported variant'] = outcomeOf(billingModule, bb({ registrationType: 'Nope' }));
      d['dynamic search ok'] = outcomeOf(billingModule, bb({ action: 'search', base: undefined, input: { search: 'x' }, expected: { outcome: 'found' } }));
      d['module id registration with a dynamic adapter takes registration branches'] = outcomeOf({ ...billingModule, id: 'registration' }, bb({ expected: { outcome: 'verified' } }));
      d['module id registration with a dynamic adapter, plain fill'] = outcomeOf({ ...billingModule, id: 'registration' }, bb());
      return d;
    });
    snap('b.validateCase', { registration: out, dynamic: dyn });
    assert.ok(Object.keys(out).length >= 25);
    assert.equal(Object.keys(dyn).length >= 3, true);
  } finally { done(); }
});

// (c) generateAiCases -------------------------------------------------------------------------------------------
const aiSummary = r => ({
  moduleId: r.moduleId, engine: r.engine, prompt: r.prompt, focus: r.focus, count: r.count, coverageInsights: r.coverageInsights,
  ids: r.drafts.map(d => d.id), titles: r.drafts.map(d => d.title), categories: r.drafts.map(d => d.category),
  sortedIds: r.drafts.map(d => d.id).sort(), draftsSha256: sha(r.drafts),
});
test('(c) generateAiCases and presets for registration and a dynamic module', async () => {
  const { store, done } = seededStore();
  try {
    const regModule = store.module('registration');
    const existing = store.cases('registration');
    const result = {};
    result.registrationEmpty20 = aiSummary(await generateAiCases({ module: regModule, existingCases: [], options: { count: 20 } }));
    result.registrationSeeded5 = aiSummary(await generateAiCases({ module: regModule, existingCases: existing, options: { count: 5 } }));
    result.registrationSeeded20 = aiSummary(await generateAiCases({ module: regModule, existingCases: existing, options: { count: 20 } }));
    result.registrationFocus = aiSummary(await generateAiCases({ module: regModule, existingCases: existing, options: { count: 8, focus: 'validation', prompt: 'mobile number edge cases' } }));
    result.registrationVariant = aiSummary(await generateAiCases({ module: regModule, existingCases: existing, options: { count: 8, targetVariant: 'New Born Registration' } }));
    // Same call twice: proves the output is a pure function of its inputs.
    assert.deepEqual(aiSummary(await generateAiCases({ module: regModule, existingCases: [], options: { count: 20 } })), result.registrationEmpty20);
    result.dynamic = await withBillingAsync(async () => {
      const d = {};
      d.empty8 = aiSummary(await generateAiCases({ module: billingModule, existingCases: [], options: { count: 8 } }));
      d.empty20 = aiSummary(await generateAiCases({ module: billingModule, existingCases: [], options: { count: 20 } }));
      d.focus = aiSummary(await generateAiCases({ module: billingModule, existingCases: [], options: { count: 6, focus: 'validation', prompt: 'amount limits' } }));
      assert.deepEqual(aiSummary(await generateAiCases({ module: billingModule, existingCases: [], options: { count: 8 } })), d.empty8);
      return d;
    });
    result.presets = {
      all: { count: AI_PRESETS.length, sha256: sha(AI_PRESETS) },
      registration: { sha256: sha(presetsFor({ id: 'registration' })), count: presetsFor({ id: 'registration' }).length },
      billing: { sha256: sha(presetsFor({ id: 'billing' })), count: presetsFor({ id: 'billing' }).length },
    };
    snap('c.ai', result);
  } finally { done(); }
});

// (d) fresh store seed ------------------------------------------------------------------------------------------
test('(d) a fresh openStore seeds the registration module and its cases once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-plugins-seed-'));
  try {
    const first = openStore(dir);
    const mods = first.modules(), cases = first.cases('registration');
    const summary = {
      modules: mods.map(m => ({ id: m.id, productId: m.productId, name: m.name, area: m.area, prefix: m.prefix, description: m.description, adapter: m.adapter, basesKeys: Object.keys(m.config?.bases ?? {}), requirementsCount: (m.config?.requirements ?? []).length })),
      registrationModuleConfigSha256: sha(mods.find(m => m.id === 'registration')?.config),
      caseCount: cases.length, firstCaseId: cases[0]?.id, lastCaseId: cases.at(-1)?.id,
      caseIds: cases.map(c => c.id),
      caseModes: [...new Set(cases.map(c => c.mode))],
      casesSha256: sha(cases.map(({ id, title, category, priority, mode, action, input, expected, base, registrationType, target, steps, requirement, preconditions }) => ({ id, title, category, priority, mode, action, input, expected, base, registrationType, target, steps, requirement, preconditions }))),
    };
    first.close();
    // Reopening an existing database must not re-seed or duplicate anything.
    const again = openStore(dir);
    assert.equal(again.modules().length, mods.length);
    assert.equal(again.cases('registration').length, cases.length);
    again.close();
    snap('d.seed', summary);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// (e) agent constants + readiness -------------------------------------------------------------------------------
const probe = async id => ({ id, label: id, available: true, version: '9.9.9' });
async function agentRun(module, kind) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'module-plugins-agent-'));
  try {
    const referenceDir = path.join(tmp, 'reference');
    fs.mkdirSync(referenceDir, { recursive: true });
    // More than 10 candidates, so the reference-first ordering (REFERENCE_FIRST) decides which 10 are copied.
    for (const n of ['workflow-runner.ts', 'zz-last.ts', 'cases.spec.ts', 'aa-first.md', 'case-runner.ts', 'bb.ts', 'registration.page.ts', 'cc.ts', 'fields.ts', 'dd.ts', 'ee.ts', 'ff.ts', 'gg.ts']) fs.writeFileSync(path.join(referenceDir, n), '// ref\n');
    const file = { id: 'f1', name: 'rules.txt', kind: 'text', extract: 'ok' };
    const cases = [{ id: 'X-1', title: 'T', category: 'c', priority: 'P1', steps: [{ action: 'a', expected: 'b' }], reviewStatus: 'approved' }];
    const store = { intakeFiles: () => [file], cases: () => cases, module: () => module };
    const intake = { ensureExtracted: async files => files.map(f => ({ file: f, content: { text: 'Total must be at least 1.' } })) };
    let ws;
    const spawn = (bin, args, opts) => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
      child.kill = () => { setImmediate(() => child.emit('exit', null)); return true; };
      ws = opts.cwd;
      setImmediate(() => { fs.writeFileSync(path.join(opts.cwd, 'output', 'automation', 'NOTES.md'), 'x'); child.stdout.end(); child.stderr.end(); child.emit('exit', 0); });
      return child;
    };
    const runner = createAgentRunner({ dataDir: path.join(tmp, 'data'), store, intake, ingest: () => ({ id: 'x', draftCases: 0 }), referenceDir, discoveryRoot: path.join(tmp, 'qa'), spawn, probe });
    const job = await runner.start({ module, agent: 'claude', kind, user: { username: 'u' } });
    for (let i = 0; i < 400 && runner.get(module.id, job.id).status === 'running'; i++) await new Promise(r => setTimeout(r, 25));
    const done = runner.get(module.id, job.id);
    return { status: done.status, message: done.message, referenceCopied: fs.readdirSync(path.join(ws, 'reference')).sort() };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const crossLine = text => text.split('\n').filter(l => /Cross-field contradictions/.test(l));
const referenceLine = text => text.split('\n').filter(l => /`reference\/`|reference\//.test(l));

test('(e) agent reference ordering, cross-field examples and readiness', async () => {
  const { store, done } = seededStore();
  try {
    const regModule = store.module('registration');
    const other = { id: 'billing', name: 'Billing', area: 'Finance', config: {} };
    const out = {};
    out.registrationAutomationJob = await agentRun(regModule, 'automation');
    out.billingAutomationJob = await agentRun(other, 'automation');
    out.crossFieldRegistration = crossLine(instructions({ kind: 'analyze', module: regModule }));
    out.crossFieldBilling = crossLine(instructions({ kind: 'analyze', module: other }));
    out.crossFieldRegistrationUpperId = crossLine(instructions({ kind: 'analyze', module: { ...regModule, id: 'Registration' } }));
    out.referenceLines = referenceLine(instructions({ kind: 'automation', module: regModule }));
    out.registrationBriefSha256 = sha(instructions({ kind: 'analyze', module: regModule, hasAdapterSchema: true }));
    out.billingBriefSha256 = sha(instructions({ kind: 'analyze', module: other }));
    out.registrationAutomationBriefSha256 = sha(instructions({ kind: 'automation', module: regModule, hasDiscovery: true }));
    out.readinessRegistrationEmpty = readiness({ module: regModule });
    out.readinessRegistrationCases = readiness({ module: regModule, cases: store.cases('registration'), adapterConnected: true, specExists: true });
    out.readinessBillingEmpty = readiness({ module: { ...other, productId: 'augastam' } });
    snap('e.agentAndReadiness', out);
  } finally { done(); }
});

// ---- Plugin contract and loader (Plan 2, Task 1). Uses isolated registries; the shared one is never touched. ----
const miniAdapter = (id = 'demo') => ({ id, name: 'Demo', spec: `tests/modules/${id}/cases.spec.ts`, fields: {}, actions: { fill: 'Fill' }, outcomes: ['created'], variants: ['Standard'] });
const miniPlugin = (id = 'demo') => ({ id, adapter: miniAdapter(id), builtIn: true });

test('assertPlugin accepts a minimal valid plugin and optional hooks', () => {
  assert.doesNotThrow(() => assertPlugin(miniPlugin()));
  assert.doesNotThrow(() => assertPlugin({ ...miniPlugin(), seed() {}, ai: {}, agent: {} }));
});

test('assertPlugin rejects bad id, missing adapter, non-function hooks and builtIn not true', () => {
  for (const id of ['', 'Demo', '1demo', 'de mo', undefined, 5]) assert.throws(() => assertPlugin({ ...miniPlugin(), id }), /id/);
  assert.throws(() => assertPlugin({ id: 'demo', builtIn: true }), /adapter/);
  assert.throws(() => assertPlugin({ ...miniPlugin(), adapter: 'x' }), /adapter/);
  assert.throws(() => assertPlugin({ ...miniPlugin(), adapter: { ...miniAdapter(), spec: undefined } }), /adapter/);
  assert.throws(() => assertPlugin({ ...miniPlugin(), seed: {} }), /seed/);
  assert.throws(() => assertPlugin({ ...miniPlugin(), ai: () => {} }), /ai/);
  assert.throws(() => assertPlugin({ ...miniPlugin(), agent: 'x' }), /agent/);
  assert.throws(() => assertPlugin({ ...miniPlugin(), builtIn: false }), /builtIn/);
  assert.throws(() => assertPlugin({ id: 'demo', adapter: miniAdapter() }), /builtIn/);
  assert.throws(() => assertPlugin(null), /plugin/);
});

test('pluginFor resolves by id string, module.adapter, module.id and returns undefined otherwise', () => {
  const reg = createPluginRegistry();
  const p = miniPlugin('demo');
  reg.registerPlugin(p);
  assert.equal(reg.pluginFor('demo'), p);
  assert.equal(reg.pluginFor({ id: 'other', adapter: 'demo' }), p);
  assert.equal(reg.pluginFor({ id: 'demo' }), p);
  assert.equal(reg.pluginFor('nope'), undefined);
  assert.equal(reg.pluginFor({ id: 'nope', adapter: 'nope2' }), undefined);
  assert.equal(reg.pluginFor(undefined), undefined);
  assert.equal(reg.pluginFor(null), undefined);
});

test('registerPlugin rejects duplicate ids and invalid plugins; reservedIds/plugins reflect registrations', () => {
  const reg = createPluginRegistry();
  assert.equal(reg.reservedIds().size, 0);
  reg.registerPlugin(miniPlugin('a'));
  reg.registerPlugin(miniPlugin('b'));
  assert.throws(() => reg.registerPlugin(miniPlugin('a')), /already registered/);
  assert.throws(() => reg.registerPlugin({ id: 'c' }), /adapter/);
  assert.deepEqual([...reg.reservedIds()].sort(), ['a', 'b']);
  assert.deepEqual(reg.plugins().map(p => p.id), ['a', 'b']);
  assert.ok(reg.reservedIds() instanceof Set);
  assert.equal(createPluginRegistry().plugins().length, 0);
});
