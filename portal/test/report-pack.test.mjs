import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { reportModel } from '../quality.mjs';
import { redactRun } from '../reports/redact.mjs';
import { PRESETS, normalizeFilter, applyFilter } from '../reports/filter.mjs';
import { boot } from './support.mjs';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

const module = { id: 'registration', name: 'Registration', area: 'Patient Care', adapter: 'registration', config: { bases: {} } };
const c = (id, extra = {}) => ({ id, version: 1, title: `Case ${id}`, mode: 'automated', enabled: true, priority: 'P1', category: 'Validation', action: 'fill', input: { mobile: '123' }, expected: { outcome: 'field-state' }, requirement: 'REQ-1', ...extra });
const mkRun = (extra = {}) => ({ id: 'rp-run-1', name: 'Pack', kind: 'tests', mode: 'automated', status: 'failed', environmentId: 'local', environmentName: 'UAT', environmentUrl: 'https://example.test', productId: 'augastam', module: structuredClone(module),
  cases: [c('P-1'), c('P-2'), c('P-3', { expected: { outcome: 'x', assumed: true } })],
  results: [
    { id: 'P-1', status: 'PASS', expected: 'ok', actual: 'ok', flaky: true, attempts: 2, attachments: [] },
    { id: 'P-2', status: 'FAIL', expected: 'rejected', actual: 'Authorization: Bearer abc.def accepted', mismatches: ['accepted Bearer abc.def'], quarantined: true, attachments: [], resolvedInput: { password: 'x', mobile: '1' } },
    { id: 'P-3', status: 'FAIL', expected: 'e', actual: 'a', attachments: [] },
  ],
  triage: { 'P-3': { severity: 'High', owner: 'BA', reference: 'BUG-9', ticketUrl: 'https://tickets.test/BUG-9' } },
  createdAt: '2026-11-01T10:00:00Z', ...extra });

test('redactRun removes bearer tokens, JWTs and secret-keyed values from nested results', () => {
  const run = mkRun();
  run.results[1].resolvedInput = { password: 'x', nested: { apiKey: 'k' } };
  const before = structuredClone(run);
  const out = redactRun(run);
  const text = JSON.stringify(out);
  assert.ok(!text.includes('abc.def'));
  assert.ok(!text.includes('"password":"x"'));
  assert.ok(!text.includes('"apiKey":"k"'));
  assert.equal(out.results[1].resolvedInput.password, '[REDACTED]');
  assert.equal(out.results[1].resolvedInput.nested.apiKey, '[REDACTED]');
  assert.match(out.results[1].actual, /\[REDACTED\]/);
  assert.deepEqual(run, before);
});

test('reportModel rows carry flaky, attempts, quarantined, severity, owner, ticketUrl and totalsByClass', () => {
  const m = reportModel(mkRun());
  const [a, b, d] = m.cases;
  assert.deepEqual([a.flaky, a.attempts, a.quarantined, a.assumed, a.findingKind], [true, 2, false, false, null]);
  assert.deepEqual([b.flaky, b.attempts, b.quarantined, b.findingKind], [false, 1, true, 'failure']);
  assert.equal(d.severity, 'High'); assert.equal(d.owner, 'BA'); assert.equal(d.ticketUrl, 'https://tickets.test/BUG-9'); assert.equal(d.assumed, true);
  assert.equal(b.severity, 'Not assessed'); assert.equal(a.ticketUrl, '');
  const f = m.findings.find(x => x.caseId === 'P-3');
  assert.equal(f.ticketUrl, 'https://tickets.test/BUG-9'); assert.equal(m.findings.find(x => x.caseId === 'P-2').quarantined, true);
  assert.deepEqual(m.totalsByClass, { passed: 1, failed: 2, review: 0, execution: 0, blocked: 0, observed: 0, skipped: 0, 'not-executed': 0, flaky: 1, quarantined: 1 });
});

test('JSON, JUnit and Excel exports of a run containing a bearer token never contain it', async t => {
  const f = await boot(t);
  f.store.saveRun(mkRun());
  const json = await f.request('/api/runs/rp-run-1/export?format=json');
  assert.equal(json.status, 200); assert.ok(!JSON.stringify(json.value).includes('abc.def'));
  const rawJson = await (await fetch(`${f.base}/api/runs/rp-run-1/export?format=json`)).text();
  assert.ok(!rawJson.includes('abc.def'));
  assert.equal(json.value.results[1].resolvedInput.password, '[REDACTED]');
  assert.ok(!JSON.stringify(json.value).includes('"password":"x"'));
  const junit = await f.request('/api/runs/rp-run-1/export?format=junit');
  assert.equal(junit.status, 200); assert.ok(!junit.value.toString().includes('abc.def'));
  const x = await f.request('/api/runs/rp-run-1/export?format=xlsx');
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.value);
  const cells = []; wb.getWorksheet('Results').eachRow(r => r.eachCell(cell => cells.push(String(cell.value))));
  assert.ok(cells.length > 10); assert.ok(!cells.join('\n').includes('abc.def'));
});

test('JUnit names and headers never contain tokens placed in case titles, run, module or environment names', async t => {
  const f = await boot(t);
  const run = mkRun({ id: 'rp-run-2', name: 'Pack password=hunter2', environmentName: 'UAT Bearer abc.def', module: { ...structuredClone(module), name: 'Reg password=hunter2' } });
  run.cases[0].title = 'Title Bearer abc.def password=hunter2'; run.cases[0].category = 'Cat password=hunter2';
  f.store.saveRun(run);
  const junit = await f.request('/api/runs/rp-run-2/export?format=junit');
  assert.equal(junit.status, 200);
  const raw = junit.value.toString();
  assert.ok(!raw.includes('abc.def')); assert.ok(!raw.includes('hunter2'));
});

// ---- Task 2: report filters ----

const fr = (id, extra = {}) => ({ id, caseId: id, title: `Title ${id}`, suite: 'Validation', priority: 'P1', mode: 'automated', requirement: `REQ-${id}`, rawStatus: 'PASS', findingKind: null, flaky: false, quarantined: false, assumed: false, severity: 'Not applicable', owner: 'Unassigned', executed: true, screenshotCount: 1, ...extra });
const filterModel = () => ({
  counts: { total: 6, passed: 1 },
  totalsByClass: { failed: 2 },
  cases: [
    fr('A-1'),
    fr('A-2', { rawStatus: 'FAIL', findingKind: 'failure', priority: 'P0', severity: 'Not assessed', screenshotCount: 0 }),
    fr('A-3', { rawStatus: 'FAIL (assumed requirement)', findingKind: 'assumption', assumed: true, priority: 'P2', suite: 'Rules' }),
    fr('A-4', { rawStatus: 'ERROR', findingKind: 'execution', owner: 'BA' }),
    fr('A-5', { rawStatus: 'NOT EXECUTED', executed: false, screenshotCount: 0, flaky: true }),
    fr('A-6', { rawStatus: 'FAIL', findingKind: 'failure', priority: 'P0', severity: 'High', quarantined: true, title: 'Mobile Number rule' }),
  ],
  findings: [{ caseId: 'A-2' }, { caseId: 'A-3' }, { caseId: 'A-4' }, { caseId: 'A-6' }],
});
const ids = r => r.cases.map(x => x.id);

test('bugs preset keeps only failed and review rows', () => {
  const r = applyFilter(filterModel(), PRESETS.bugs.filter);
  assert.deepEqual(ids(r), ['A-2', 'A-3', 'A-6']);
  assert.deepEqual(r.findings.map(f => f.caseId), ['A-2', 'A-3', 'A-6']);
  assert.equal(r.shown, 3); assert.equal(r.total, 6); assert.equal(r.active, true);
});

test('dimensions combine with AND and values with OR', () => {
  const r = applyFilter(filterModel(), { classes: ['failed', 'review'], priorities: ['P0', 'P2'] });
  assert.deepEqual(ids(r), ['A-2', 'A-3', 'A-6']);
  const r2 = applyFilter(filterModel(), { classes: ['failed', 'review'], priorities: ['P0'] });
  assert.deepEqual(ids(r2), ['A-2', 'A-6']);
  assert.equal(r2.description, 'Result: failed, review; Priority: P0');
  assert.deepEqual(ids(applyFilter(filterModel(), { classes: ['quarantined', 'flaky'] })), ['A-5', 'A-6']);
  assert.deepEqual(ids(applyFilter(filterModel(), PRESETS['needs-triage'].filter)), ['A-2']);
});

test('text matches id, title and requirement case-insensitively', () => {
  assert.deepEqual(ids(applyFilter(filterModel(), { text: 'a-3' })), ['A-3']);
  assert.deepEqual(ids(applyFilter(filterModel(), { text: 'MOBILE number' })), ['A-6']);
  assert.deepEqual(ids(applyFilter(filterModel(), { text: 'req-a-4' })), ['A-4']);
});

test('newFailuresOnly uses previousFailedIds', () => {
  const r = applyFilter(filterModel(), { newFailuresOnly: true }, { previousFailedIds: new Set(['A-2']) });
  assert.deepEqual(ids(r), ['A-3', 'A-4', 'A-6']);
  assert.deepEqual(ids(applyFilter(filterModel(), { newFailuresOnly: true })), ['A-2', 'A-3', 'A-4', 'A-6']);
});

test('caseIds restricts to the list', () => {
  assert.deepEqual(ids(applyFilter(filterModel(), { caseIds: ['A-1', 'A-5', 'ZZ'] })), ['A-1', 'A-5']);
});

test('assumedOnly, missingEvidenceOnly and mode filters', () => {
  assert.deepEqual(ids(applyFilter(filterModel(), { assumedOnly: true })), ['A-3']);
  assert.deepEqual(ids(applyFilter(filterModel(), { missingEvidenceOnly: true })), ['A-2']);
  assert.deepEqual(ids(applyFilter(filterModel(), { mode: 'manual' })), []);
});

test('empty filter is inactive and returns every row with shown === total', () => {
  const r = applyFilter(filterModel(), {});
  assert.equal(r.active, false); assert.equal(r.shown, 6); assert.equal(r.total, 6);
  assert.equal(r.description, 'All cases'); assert.equal(r.cases.length, 6);
  assert.equal(applyFilter(filterModel(), PRESETS.everything.filter).active, false);
});

test('normalizeFilter drops unknown keys, unknown classes and non-strings', () => {
  const n = normalizeFilter({ classes: ['failed', 'bogus', 3], priorities: [' P0 ', null, ''], evil: 1, mode: 'weird', assumedOnly: 'yes', text: ` ${'x'.repeat(300)} `, owners: Array.from({ length: 300 }, (_, i) => `o${i}`) });
  assert.deepEqual(n.classes, ['failed']); assert.deepEqual(n.priorities, ['P0']);
  assert.ok(!('evil' in n)); assert.ok(!('mode' in n)); assert.ok(!('assumedOnly' in n));
  assert.equal(n.text.length, 200); assert.equal(n.owners.length, 200);
  assert.deepEqual(normalizeFilter(null), {}); assert.deepEqual(normalizeFilter('x'), {});
  assert.equal(normalizeFilter({ mode: 'manual', newFailuresOnly: true }).mode, 'manual');
});

test('totals are never filtered', () => {
  const m = filterModel(), before = structuredClone(m.counts);
  const r = applyFilter(m, { classes: ['passed'] });
  assert.equal(r.shown, 1); assert.equal(r.total, 6);
  assert.deepEqual(m.counts, before); assert.equal(m.cases.length, 6);
});

// ---- Task 3: summary and suggested verdict ----
import { DEFAULT_CRITERIA, suggestVerdict, buildSummary } from '../reports/summary.mjs';

const sumModel = (specs, triage = {}) => reportModel({ ...mkRun(), cases: specs.map(s => c(s.id, s.assumed ? { expected: { outcome: 'x', assumed: true } } : {})),
  results: specs.map(s => ({ id: s.id, status: s.status, expected: 'e', actual: 'a', attachments: [], ...(s.quarantined ? { quarantined: true } : {}) })), triage });
const pass = id => ({ id, status: 'PASS' });
const fail = (id, extra = {}) => ({ id, status: 'FAIL', ...extra });

test('verdict release when everything passes', () => {
  const v = suggestVerdict(sumModel([pass('S-1'), pass('S-2')]));
  assert.equal(v.value, 'release');
  assert.ok(v.reasons.join(' ').toLowerCase().includes('suggestion'));
});
test('verdict do-not-release for open Critical or High failure', () => {
  const m = sumModel([pass('S-1'), fail('S-2')], { 'S-2': { severity: 'High' } });
  assert.equal(suggestVerdict(m).value, 'do-not-release');
  assert.deepEqual(DEFAULT_CRITERIA.blockSeverities, ['Critical', 'High']);
});
test('verdict needs-triage for untriaged failure, execution issue or blocked case', () => {
  assert.equal(suggestVerdict(sumModel([fail('S-1')])).value, 'needs-triage');
  assert.equal(suggestVerdict(sumModel([{ id: 'S-1', status: 'ERROR' }])).value, 'needs-triage');
  assert.equal(suggestVerdict(sumModel([{ id: 'S-1', status: 'BLOCKED' }])).value, 'needs-triage');
});
test('verdict release-with-known-issues for triaged non-blocking failure', () => {
  const m = sumModel([pass('S-1'), fail('S-2')], { 'S-2': { severity: 'Low' } });
  assert.equal(suggestVerdict(m).value, 'release-with-known-issues');
});
test('quarantined failure does not block but appears in risks', () => {
  const m = sumModel([pass('S-1'), fail('S-2', { quarantined: true })], { 'S-2': { severity: 'Critical' } });
  const s = buildSummary(m, applyFilter(m, {}));
  assert.equal(s.verdict.value, 'release');
  assert.deepEqual(s.openBugsBySeverity, {});
  assert.ok(s.risks.some(r => r.includes('S-2')));
});
test('pass rate uses run totals when a filter is active', () => {
  const m = sumModel([pass('S-1'), pass('S-2'), pass('S-3'), fail('S-4')], { 'S-4': { severity: 'Low' } });
  const s = buildSummary(m, applyFilter(m, { classes: ['failed'] }));
  assert.equal(s.passRate, 75);
  assert.equal(s.filterNote, 'Showing 1 of 4 cases. Filter: Result: failed');
  assert.equal(s.counts, m.counts);
});
test('filterNote is null when inactive; passRate null with no executed rows', () => {
  const m = sumModel([{ id: 'S-1', status: 'NOT EXECUTED' }]);
  const s = buildSummary(m, applyFilter(m, {}));
  assert.equal(s.filterNote, null); assert.equal(s.passRate, null); assert.equal(s.comparison, null);
});
test('comparison counts newly failing and fixed versus previous model', () => {
  const prev = sumModel([fail('S-1'), fail('S-2'), pass('S-3'), pass('S-4')]);
  const cur = sumModel([pass('S-1'), fail('S-2'), fail('S-3'), pass('S-4')]);
  const s = buildSummary(cur, applyFilter(cur, {}), { previous: prev });
  assert.deepEqual(s.comparison, { passRate: 50, newlyFailing: 1, fixed: 1 });
});
test('a 100% pass run with 3 not-executed cases lists them in notTested', () => {
  const m = sumModel([pass('S-1'), pass('S-2'), { id: 'S-3', status: 'NOT EXECUTED' }, { id: 'S-4', status: 'NOT EXECUTED' }, { id: 'S-5', status: 'NOT EXECUTED' }]);
  const s = buildSummary(m, applyFilter(m, {}));
  assert.equal(s.passRate, 100);
  assert.ok(s.notTested.some(t => t.includes('3') && /not executed/i.test(t)));
});
