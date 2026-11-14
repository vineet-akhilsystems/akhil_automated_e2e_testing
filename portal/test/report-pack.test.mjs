import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { reportModel } from '../quality.mjs';
import { redactRun } from '../reports/redact.mjs';
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
