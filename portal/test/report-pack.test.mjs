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

// ---- Task 4: renderers ----
import { safeCell, toCsv, jiraCsv } from '../reports/csv.mjs';
import { executionLogWorkbook, defectWorkbook } from '../reports/xlsx.mjs';
import { summaryMarkdown } from '../reports/markdown.mjs';

const rdr = async buf => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; };
const rendererFixture = (extra = {}) => {
  const run = mkRun(extra);
  run.cases.push(c('P-4'));
  run.results.push({ id: 'P-4', status: 'FAIL (assumed requirement)', expected: 'e4', actual: 'a4', attachments: [] });
  const model = reportModel(redactRun(run));
  return { model, listing: applyFilter(model, {}) };
};

test('safeCell neutralizes formula starters', () => {
  for (const v of ['=1+1', '+cmd', '-2', '@SUM(A1)', '\tx', '\rx']) assert.equal(safeCell(v), `'${v}`);
  assert.equal(safeCell('plain'), 'plain');
  assert.equal(safeCell(null), '');
  assert.equal(safeCell(5), '5');
  assert.equal(safeCell('a'.repeat(40000)).length, 32000);
});

test('toCsv quotes commas, quotes and newlines', () => {
  assert.equal(toCsv([['a', 'b,c', 'd"e', 'f\ng', 'h\ri'], ['1', '2']]), 'a,"b,c","d""e","f\ng","h\ri"\r\n1,2');
});

// Minimal RFC 4180 parser for tests: handles quoted fields with commas, quotes and CRLF.
const parseCsv = text => {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; }
    else f += ch;
  }
  row.push(f); rows.push(row);
  return rows;
};

test('jiraCsv maps priority, excludes quarantined, escapes quotes', () => {
  const { model, listing } = rendererFixture();
  model.findings.find(f => f.caseId === 'P-3').title = 'He said "hi", ok';
  const csv = jiraCsv(model, listing);
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], ['Summary', 'Description', 'Priority', 'Labels', 'Labels', 'Issue Type']);
  assert.equal(rows.length, 3);
  assert.ok(!csv.includes('P-2'));
  assert.equal(rows[1][0], '[P-3] He said "hi", ok');
  assert.deepEqual([rows[1][2], rows[1][3], rows[1][5]], ['High', 'test-studio', 'Bug']);
  assert.match(rows[1][4], /^[a-z0-9-]+$/);
  assert.equal(rows[2][0], '[P-4] Case P-4');
  assert.deepEqual([rows[2][2], rows[2][5]], ['High', 'Task']);
});

test('jiraCsv keeps a description with CRLF, comma and double quote in one field', () => {
  const { model, listing } = rendererFixture();
  model.findings.find(f => f.caseId === 'P-3').actual = 'line1\r\nsaid "x", then y';
  const rows = parseCsv(jiraCsv(model, listing));
  assert.equal(rows.length, 3);
  assert.equal(rows[1].length, 6);
  assert.ok(rows[1][1].includes('Actual: line1\r\nsaid "x", then y'));
});

test('jiraCsv falls back to test priority and uses Bug for failed assertions', () => {
  const { model, listing } = rendererFixture();
  const f = model.findings.find(x => x.caseId === 'P-3');
  f.severity = 'Not assessed'; f.priority = 'P0';
  const row = parseCsv(jiraCsv(model, listing))[1];
  assert.deepEqual([row[2], row[5]], ['Highest', 'Bug']);
});

test('safeCell caps by code points without splitting a surrogate pair', () => {
  const out = safeCell('a'.repeat(31999) + '\u{1F600}tail');
  assert.equal(out.length, 31999);
  assert.ok(!/[\uD800-\uDBFF]$/.test(out));
});

test('evidence links are an allowlist of plain relative paths', async () => {
  const { model, listing } = rendererFixture();
  const bad = ['javascript:alert(1)', 'java\tscript:x', 'file:///c:/x', 'http://x.test/a', '\\\\host\\share\\a.png', 'C:\\x.png', '/etc/passwd', '../up.png', 'a/../b.png', 'a\nb.png'];
  for (const link of bad) {
    const wb = await rdr(await executionLogWorkbook(model, listing, { evidenceLinks: { 'P-1': link } }));
    const v = wb.getWorksheet('Results').getRow(2).getCell(16).value;
    assert.equal(typeof v, 'string', `rejected as plain text: ${JSON.stringify(link)}`);
    assert.ok(!(v && v.hyperlink));
  }
  const ok = await rdr(await executionLogWorkbook(model, listing, { evidenceLinks: { 'P-1': 'evidence/REG-001/1-final.png' } }));
  assert.equal(ok.getWorksheet('Results').getRow(2).getCell(16).value.hyperlink, 'evidence/REG-001/1-final.png');
});

test('summary sheet keys and titles are formula-neutralized', async () => {
  const { model, listing } = rendererFixture();
  model.title = '=HYPERLINK("http://x","y")';
  model.cases[0].title = '@evil';
  const wb = await rdr(await executionLogWorkbook(model, listing, { summary: buildSummary(model, listing) }));
  const sum = wb.getWorksheet('Summary');
  assert.equal(sum.getRow(1).getCell(1).value, `'=HYPERLINK("http://x","y")`);
  sum.eachRow(r => r.eachCell(cl => {
    assert.equal(cl.formula, undefined);
    if (typeof cl.value === 'string') assert.ok(!/^[=+\-@\t\r]/.test(cl.value), cl.value);
  }));
  assert.equal(wb.getWorksheet('Results').getRow(2).getCell(2).value, "'@evil");
});

test('secrets in titles, risks and the filter note never reach any renderer output', async () => {
  const { model } = rendererFixture();
  const secret = 'Bearer abc.def.ghi and password=hunter2';
  model.cases[0].title = secret;
  model.findings.find(f => f.caseId === 'P-3').title = secret;
  const listing = applyFilter(model, { priorities: ['P1'] });
  const summary = buildSummary(model, listing);
  summary.risks.push(`risk ${secret}`);
  summary.filterNote = `filter ${secret}`;
  summary.scope = `scope ${secret}`;
  const wb = await rdr(await executionLogWorkbook(model, listing, { summary }));
  const dw = await rdr(await defectWorkbook(model, listing));
  const cells = [];
  for (const w of [wb, dw]) w.eachSheet(s => s.eachRow(r => r.eachCell(cl => cells.push(String(cl.value?.text ?? cl.value)))));
  const all = [cells.join('\n'), jiraCsv(model, listing), summaryMarkdown(summary)].join('\n');
  assert.ok(!all.includes('abc.def.ghi'));
  assert.ok(!all.includes('hunter2'));
  assert.ok(all.includes('[REDACTED]'));
});

test('execution log workbook has the four sheets, an autofilter, one row per listed case and a hyperlink cell when evidenceLinks has the case', async () => {
  const { model, listing } = rendererFixture();
  const summary = buildSummary(model, listing);
  const wb = await rdr(await executionLogWorkbook(model, listing, { evidenceLinks: { 'P-3': 'evidence/P-3.html' }, summary }));
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Results', 'Findings', 'Not executed']);
  const res = wb.getWorksheet('Results');
  assert.ok(res.autoFilter);
  assert.equal(res.views[0].state, 'frozen');
  assert.equal(res.rowCount, 1 + listing.cases.length);
  const header = res.getRow(1).values.slice(1);
  const linkCol = header.length;
  const p3 = res.getRow(4);
  assert.equal(p3.getCell(1).value, 'P-3');
  assert.equal(p3.getCell(linkCol).value.hyperlink, 'evidence/P-3.html');
  assert.equal(res.getRow(2).getCell(linkCol).value ?? '', '');
  for (const n of ['Findings', 'Not executed']) { assert.ok(wb.getWorksheet(n).autoFilter); assert.equal(wb.getWorksheet(n).views[0].state, 'frozen'); }
  const text = JSON.stringify(wb.getWorksheet('Summary').getSheetValues());
  assert.match(text, /Suggested verdict: /);
  assert.ok(!/approv(ed|al)/i.test(text.replace(/not an approval/gi, '')));
});

test('execution log summary shows not-tested counts right under the verdict and the filter note', async () => {
  const { model } = rendererFixture();
  model.cases.push({ ...model.cases[0], id: 'P-9', title: 'Never ran', rawStatus: 'NOT EXECUTED', status: 'NOT EXECUTED', executed: false, findingKind: null });
  model.totalsByClass['not-executed']++;
  const listing = applyFilter(model, { priorities: ['P1'] });
  const summary = buildSummary(model, listing);
  const wb = await rdr(await executionLogWorkbook(model, listing, { summary }));
  const rows = []; wb.getWorksheet('Summary').eachRow(r => rows.push(r.values.slice(1).join(' | ')));
  const vi = rows.findIndex(r => r.includes('Suggested verdict: '));
  assert.ok(vi >= 0);
  assert.match(rows[vi + 1], /not executed/);
  assert.ok(rows.some(r => r.includes('Filter')));
  const ne = wb.getWorksheet('Not executed');
  assert.equal(ne.getRow(2).getCell(1).value, 'P-9');
});

test('a title like =HYPERLINK(...) is stored as text', async () => {
  const { model } = rendererFixture();
  model.cases[0].title = '=HYPERLINK("http://evil","x")';
  model.cases[0].owner = '+cmd'; model.cases[0].requirement = '@SUM(1)';
  model.findings[0].title = '-2+3'; model.findings[0].owner = '=1+1';
  const listing = applyFilter(model, {});
  const wb = await rdr(await executionLogWorkbook(model, listing));
  const cell = wb.getWorksheet('Results').getRow(2).getCell(2);
  assert.equal(cell.value, `'=HYPERLINK("http://evil","x")`);
  assert.equal(cell.formula, undefined);
  for (const sheet of wb.worksheets) sheet.eachRow(r => r.eachCell(cl => {
    const v = cl.value;
    if (typeof v === 'string') assert.ok(!/^[=+\-@\t\r]/.test(v), `${sheet.name} ${cl.address}: ${v}`);
    assert.ok(!(v && typeof v === 'object' && 'formula' in v));
  }));
  const dw = await rdr(await defectWorkbook(model, listing));
  dw.eachSheet(sheet => sheet.eachRow(r => r.eachCell(cl => { if (typeof cl.value === 'string') assert.ok(!/^[=+\-@\t\r]/.test(cl.value)); })));
});

test('defect workbook splits bugs and needs-review', async () => {
  const { model, listing } = rendererFixture();
  const wb = await rdr(await defectWorkbook(model, listing));
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Bugs', 'Needs review']);
  const bugs = wb.getWorksheet('Bugs'), review = wb.getWorksheet('Needs review');
  const h = bugs.getRow(1).values.slice(1);
  for (const k of ['Steps', 'Expected', 'Actual', 'Mismatches', 'Severity', 'Owner', 'Ticket']) assert.ok(h.includes(k), k);
  const ids = s => { const o = []; s.eachRow((r, i) => { if (i > 1) o.push(r.getCell(1).value); }); return o; };
  assert.deepEqual(ids(bugs), ['BUG-P-2', 'BUG-P-3']);
  assert.deepEqual(ids(review), ['RULE-P-4']);
  assert.ok(bugs.autoFilter && review.autoFilter);
});

test('summaryMarkdown starts with the suggested verdict', () => {
  const { model, listing } = rendererFixture();
  const md = summaryMarkdown(buildSummary(model, listing));
  const lines = md.split('\n');
  assert.match(lines[0], /^\*\*Suggested verdict: /);
  assert.match(md, /not an approval/);
  assert.match(md, /Open bugs/i);
  assert.ok(md.indexOf('Suggested verdict') < md.indexOf('Open bugs'));
});

// ---- Task 5: PDF modes ----
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generatePdf } from '../pdf-report.mjs';

const pdfScript = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'report_pdf.py');
const py = process.env.PORTAL_PYTHON ?? 'python';
const pdfDeps = spawnSync(py, ['-c', 'import reportlab, PIL'], { stdio: 'ignore' }).status === 0;
const pdfPypdf = pdfDeps && spawnSync(py, ['-c', 'import pypdf'], { stdio: 'ignore' }).status === 0;
const pdfSkip = (!pdfDeps && 'reportlab/Pillow not installed') || (!pdfPypdf && 'pypdf not installed');

const pdfRun = () => mkRun({ cases: [c('P-1'), c('P-2'), c('P-3'), c('P-4')],
  results: [{ id: 'P-1', status: 'PASS', expected: 'ok', actual: 'ok', attachments: [] }, { id: 'P-2', status: 'FAIL', expected: 'r', actual: 'a', attachments: [] },
    { id: 'P-3', status: 'FAIL', expected: 'e', actual: 'a', attachments: [] }],
  triage: { 'P-2': { severity: 'Low' }, 'P-3': { severity: 'High' } } });
function packModel(run, mode, filter = {}) {
  const base = reportModel(redactRun(run)), listing = applyFilter(base, filter);
  const model = { ...base, cases: listing.cases, findings: listing.findings, report: { mode, filterNote: listing.active ? `Showing ${listing.shown} of ${listing.total} cases. Filter: ${listing.description}` : null } };
  return { ...model, summary: buildSummary(base, listing) };
}
function renderPack(model) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-pdf-')), output = path.join(dir, 'out.pdf');
  const r = spawnSync(py, [pdfScript, '--output', output, '--assets-dir', dir], { input: JSON.stringify(model), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const code = 'import sys, json, pypdf\nr = pypdf.PdfReader(sys.argv[1])\nprint(json.dumps({"pages": len(r.pages), "texts": [p.extract_text() for p in r.pages]}))';
  const o = spawnSync(py, ['-I', '-c', code, output], { encoding: 'utf8' });
  assert.equal(o.status, 0, o.stderr);
  return JSON.parse(o.stdout);
}

test('summary mode renders exactly one page with a suggested verdict and not-tested lines', { skip: pdfSkip }, () => {
  const info = renderPack(packModel(pdfRun(), 'summary'));
  assert.equal(info.pages, 1);
  const text = info.texts[0].replace(/\s+/g, ' ');
  assert.match(text, /Suggested verdict: Do not release/);
  assert.match(text, /person must confirm/);
  assert.match(text, /1 case\(s\) not executed/);
  assert.ok(text.indexOf('Suggested verdict') < text.indexOf('not executed'));
  assert.ok(!/complian/i.test(text));
});

test('summary mode stays on one page with very long lists and truncates with "and N more"', { skip: pdfSkip }, () => {
  const model = packModel(pdfRun(), 'summary');
  model.summary.risks = Array.from({ length: 60 }, (_, i) => `Risk number ${i} is quarantined and long ${'text '.repeat(30)}`);
  model.summary.notTested = Array.from({ length: 40 }, (_, i) => `${i + 1} case(s) not tested`);
  model.summary.openBugsBySeverity = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`Sev${i}`, i + 1]));
  const info = renderPack(model);
  assert.equal(info.pages, 1);
  assert.match(info.texts[0], /\.\.\.and \d+ more/);
});

test('bugs mode contains finding titles and no passed-case appendix', { skip: pdfSkip }, () => {
  const model = packModel(pdfRun(), 'bugs');
  const info = renderPack(model);
  const text = info.texts.join('\n');
  for (const f of model.findings) assert.ok(text.replace(/\s+/g, ' ').includes(f.title), `missing ${f.title}`);
  assert.ok(info.pages > 1);
  assert.ok(!text.includes('Appendix: all'));
  assert.ok(!text.includes('Passed and observed cases'));
  assert.match(text, /Suggested verdict/);
  const full = renderPack({ ...model, report: { mode: 'full', filterNote: null } });
  assert.ok(full.texts.join('\n').includes('Appendix'));
});

test('filter note appears on the first page in every mode', { skip: pdfSkip }, () => {
  for (const mode of ['full', 'bugs', 'summary']) {
    const model = packModel(pdfRun(), mode, { classes: ['failed'] });
    assert.ok(model.report.filterNote);
    const first = renderPack(model).texts[0].replace(/\s+/g, ' ');
    assert.ok(first.includes('Showing 2 of 4 cases'), `${mode}: ${first.slice(0, 300)}`);
  }
});

test('generatePdf options: mode-prefixed file, summary uses a one-page PDF, default name unchanged', { skip: pdfSkip }, async () => {
  const run = pdfRun(), runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-gen-'));
  const base = path.basename(await generatePdf(run, runDir));
  assert.match(base, /^bug-report-[0-9a-f]{16}\.pdf$/);
  const model = packModel(run, 'summary');
  const file = await generatePdf(run, runDir, { mode: 'summary', model, name: 'x' });
  assert.match(path.basename(file), /^summary-[0-9a-f]{16}\.pdf$/);
  const again = await generatePdf(run, runDir, { mode: 'summary', model, name: 'x' });
  assert.equal(again, file);
  const other = await generatePdf(run, runDir, { mode: 'summary', model, name: 'y' });
  assert.notEqual(other, file);
  const bugs = await generatePdf(run, runDir, { mode: 'bugs', model: packModel(run, 'bugs') });
  assert.match(path.basename(bugs), /^bugs-/);
});

// ---- Task 5 fixes: bounded summary, validated mode, loud failures ----
const pageCount = file => {
  const o = spawnSync(py, ['-I', '-c', 'import sys, pypdf; print(len(pypdf.PdfReader(sys.argv[1]).pages))', file], { encoding: 'utf8' });
  assert.equal(o.status, 0, o.stderr);
  return Number(o.stdout);
};

test('summary mode is one page even with 2,000-character title, filter note, scope and 300 long lines', { skip: pdfSkip }, () => {
  const long = 'W'.repeat(60) + ' lorem ipsum '.repeat(160);
  const model = packModel(pdfRun(), 'summary');
  model.title = long.slice(0, 2000);
  model.report.filterNote = long.slice(0, 2000);
  model.summary.scope = long.slice(0, 2000);
  model.summary.notTested = Array.from({ length: 300 }, () => long.slice(0, 600));
  model.summary.risks = Array.from({ length: 300 }, () => long.slice(0, 600));
  model.summary.verdict.reasons = Array.from({ length: 20 }, () => long.slice(0, 600));
  model.summary.comparison = { passRate: 50, newlyFailing: 3, fixed: 2 };
  assert.equal(renderPack(model).pages, 1);
});

test('summary mode fails loudly when the model has no summary', { skip: pdfSkip }, () => {
  const model = packModel(pdfRun(), 'summary');
  delete model.summary;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-nosum-'));
  const r = spawnSync(py, [pdfScript, '--output', path.join(dir, 'o.pdf'), '--assets-dir', dir], { input: JSON.stringify(model), encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /requires model\.summary/);
  assert.ok(!fs.existsSync(path.join(dir, 'o.pdf')));
});

test('generatePdf mode option: summary without a model is one page, bad modes rejected, option overrides model.report.mode', { skip: pdfSkip }, async () => {
  const run = pdfRun(), runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-mode-'));
  const summary = await generatePdf(run, runDir, { mode: 'summary' });
  assert.match(path.basename(summary), /^summary-/);
  assert.equal(pageCount(summary), 1);
  for (const bad of ['../x', 'Summary', '', 'full/../x']) await assert.rejects(async () => generatePdf(run, runDir, { mode: bad }), /Unknown report mode/);
  const conflicting = packModel(run, 'full');
  const overridden = await generatePdf(run, runDir, { mode: 'summary', model: conflicting });
  assert.equal(pageCount(overridden), 1);
  const noModelBugs = await generatePdf(run, runDir, { mode: 'bugs' });
  assert.match(path.basename(noModelBugs), /^bugs-/);
  assert.ok(pageCount(noModelBugs) > 1);
});

test('bugs mode still embeds finding screenshots', { skip: pdfSkip }, async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-shot-'));
  fs.mkdirSync(path.join(runDir, 'artifacts'));
  const draw = 'import sys\nfrom PIL import Image, ImageDraw\nim = Image.new("RGB", (1600, 900), "white"); g = ImageDraw.Draw(im)\nfor y in range(0, 900, 40): g.rectangle((40, y, 1500, y + 18), fill=(40, 60, 120))\nim.save(sys.argv[1] + "/artifacts/s.png")';
  assert.equal(spawnSync(py, ['-I', '-c', draw, runDir], { encoding: 'utf8' }).status, 0);
  const run = pdfRun();
  run.results[2].attachments = [{ name: 's.png', path: 'artifacts/s.png', contentType: 'image/png' }];
  const file = await generatePdf(run, runDir, { mode: 'bugs' });
  assert.ok((fs.readFileSync(file).toString('latin1').match(/\/Subtype \/Image/g) ?? []).length >= 1);
});

// ---- Task 6: pack builder and estimate ----
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { REPORTS, safeSegment, normalizeRequest, packFingerprint, estimatePack, buildPack } from '../reports/pack.mjs';
import { readZip } from '../zip.mjs';

const pngChunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
const makePng = (w, h, rgb) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), pngChunk('IEND', Buffer.alloc(0))]);
};
const sha = b => createHash('sha256').update(b).digest('hex');
const ALL_REPORTS = { reports: ['summary', 'bugs', 'log'], filter: {}, evidence: 'findings' };
const fixedNow = () => new Date('2026-11-14T08:30:00Z');

function packFixture(extra = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-build-'));
  fs.mkdirSync(path.join(runDir, 'artifacts'));
  let shade = 0;
  const img = (name, file) => { shade += 40; fs.writeFileSync(path.join(runDir, 'artifacts', file), makePng(40, 30, [shade % 256, 90, 200 - (shade % 200)])); return { name, path: `artifacts/${file}`, contentType: 'image/png' }; };
  const run = mkRun({ id: 'rp-pk-1x-abcdef', cases: [c('P-1'), c('P-2'), c('P-3'), c('P-4')],
    results: [
      { id: 'P-1', status: 'PASS', expected: 'ok', actual: 'ok', attachments: [img('Before submit', 'p1-a.png'), img('Final result', 'p1-b.png'), img('After toast', 'p1-c.png')] },
      { id: 'P-2', status: 'FAIL', expected: 'rejected', actual: 'Authorization: Bearer abc.def accepted', attachments: [img('Final result', 'p2-a.png')] },
      { id: 'P-3', status: 'FAIL', expected: 'e', actual: 'a', attachments: [img('Step one', 'p3-a.png'), img('Step two', 'p3-b.png'), { name: 'trace', path: 'artifacts/trace.zip', contentType: 'application/zip' }] },
    ], ...extra });
  return { run, runDir };
}
const openPack = file => readZip(fs.readFileSync(file));
const evidenceNames = zip => [...zip.keys()].filter(n => n.startsWith('evidence/'));

test('default pack contains README, selected reports and a manifest whose sha256 values match the files', { skip: !pdfDeps && 'reportlab/Pillow not installed' }, async () => {
  const { run, runDir } = packFixture();
  const progress = [];
  const out = await buildPack({ run, runDir, req: ALL_REPORTS, who: 'Tester', now: fixedNow, onProgress: t => progress.push(t) });
  assert.equal(path.dirname(out.file), path.join(runDir, 'packs'));
  assert.match(path.basename(out.file), /^Registration_2026-11-14_run-rp-pk-1x_[0-9a-f]{8}\.zip$/);
  assert.equal(path.basename(out.file).slice(-12, -4), packFingerprint(run, ALL_REPORTS).slice(0, 8));
  assert.equal(out.size, fs.statSync(out.file).size);
  assert.deepEqual(fs.readdirSync(path.join(runDir, 'packs')), [path.basename(out.file)], 'temp files are cleaned up');
  const zip = openPack(out.file), names = [...zip.keys()];
  assert.equal(names[0], '00-README.txt');
  assert.equal(names.at(-1), 'MANIFEST.json');
  for (const k of Object.keys(REPORTS)) for (const f of REPORTS[k].files) assert.ok(names.includes(f), f);
  for (const f of ['data/results.json', 'data/junit.xml']) assert.ok(names.includes(f), f);
  const manifest = JSON.parse(zip.get('MANIFEST.json')().toString('utf8'));
  assert.deepEqual(out.manifest, manifest);
  assert.deepEqual(manifest.files.map(f => f.path), names.slice(0, -1));
  for (const f of manifest.files) {
    const data = zip.get(f.path)();
    assert.equal(f.bytes, data.length, f.path); assert.equal(f.sha256, sha(data), f.path);
  }
  assert.deepEqual(manifest.run, { id: 'rp-pk-1x-abcdef', name: 'Pack', module: 'Registration', environment: 'UAT', status: 'failed' });
  assert.equal(manifest.generatedAt, '2026-11-14T08:30:00.000Z'); assert.equal(manifest.generatedBy, 'Tester');
  assert.deepEqual(manifest.reports, ['summary', 'bugs', 'log']); assert.deepEqual(manifest.filter, {});
  assert.equal(manifest.filterDescription, 'All cases'); assert.equal(manifest.evidence, 'findings');
  assert.equal(manifest.listed, 4); assert.equal(manifest.total, 4); assert.deepEqual(manifest.missingEvidence, []); assert.equal(manifest.modelVersion, 2);
  for (const f of ['01-Release-Summary.pdf', '02-Bug-Report.pdf']) assert.equal(zip.get(f)().subarray(0, 4).toString('latin1'), '%PDF');
  assert.match(zip.get('01-Release-Summary.md')().toString('utf8'), /^\*\*Suggested verdict: /);
  assert.match(zip.get('02-Bugs-for-Jira.csv')().toString('utf8'), /^Summary,Description/);
  assert.match(zip.get('data/junit.xml')().toString('utf8'), /^<\?xml/);
  const results = zip.get('data/results.json')().toString('utf8');
  assert.equal(JSON.parse(results).id, run.id); assert.ok(!results.includes('abc.def'));
  const readme = zip.get('00-README.txt')().toString('utf8');
  assert.match(readme, /Suggested verdict needs a person/);
  assert.match(readme, /Suggested verdict: Do not release/);
  assert.match(readme, /Filter: All cases/);
  for (const f of ['01-Release-Summary.pdf', '02-Bugs.xlsx', '03-Execution-Log.xlsx', 'MANIFEST.json']) assert.ok(readme.includes(f), f);
  assert.ok(!/complian/i.test(readme));
  const wb = await rdr(zip.get('03-Execution-Log.xlsx')());
  const res = wb.getWorksheet('Results');
  let link = null; res.eachRow(r => { if (r.getCell(1).value === 'P-3') link = r.getCell(16).value?.hyperlink; });
  assert.equal(link, 'evidence/P-3/1-step-one.png');
  assert.ok(names.includes(link));
  assert.ok(progress.includes('Building the execution log...'));
  assert.ok(progress.includes('Building the release summary...') && progress.includes('Building the bug report...'));
});

test('evidence level findings only includes screenshots of listed findings', async () => {
  const { run, runDir } = packFixture();
  const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'findings' }, who: 'T', now: fixedNow });
  const zip = openPack(out.file);
  assert.deepEqual(evidenceNames(zip).sort(), ['evidence/P-2/1-final-result.png', 'evidence/P-3/1-step-one.png', 'evidence/P-3/2-step-two.png']);
  assert.deepEqual(zip.get('evidence/P-3/2-step-two.png')(), fs.readFileSync(path.join(runDir, 'artifacts/p3-b.png')));
  const only3 = await buildPack({ run, runDir, req: { reports: ['log'], filter: { caseIds: ['P-1', 'P-3'] }, evidence: 'findings' }, who: 'T', now: fixedNow });
  assert.deepEqual(evidenceNames(openPack(only3.file)).sort(), ['evidence/P-3/1-step-one.png', 'evidence/P-3/2-step-two.png']);
  assert.equal(only3.manifest.listed, 2); assert.equal(only3.manifest.total, 4);
});

test('evidence level none includes no evidence folder', async () => {
  const { run, runDir } = packFixture();
  const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'none' }, who: 'T', now: fixedNow });
  const zip = openPack(out.file);
  assert.deepEqual(evidenceNames(zip), []);
  assert.equal(out.manifest.evidence, 'none');
  assert.ok(!out.manifest.files.some(f => f.path.startsWith('evidence')));
  const wb = await rdr(zip.get('03-Execution-Log.xlsx')());
  wb.getWorksheet('Results').eachRow((r, i) => { if (i > 1) assert.ok(!r.getCell(16).value?.hyperlink); });
});

test('final level picks the Final result screenshot', async () => {
  const { run, runDir } = packFixture();
  const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'final' }, who: 'T', now: fixedNow });
  const zip = openPack(out.file);
  assert.deepEqual(evidenceNames(zip).sort(), ['evidence/P-1/1-final-result.png', 'evidence/P-2/1-final-result.png', 'evidence/P-3/1-step-two.png']);
  assert.deepEqual(zip.get('evidence/P-1/1-final-result.png')(), fs.readFileSync(path.join(runDir, 'artifacts/p1-b.png')));
  const all = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'all' }, who: 'T', now: fixedNow });
  assert.equal(evidenceNames(openPack(all.file)).length, 6);
});

test('case ids with ../ and : become safe unique folder names', async () => {
  assert.equal(safeSegment('../etc/passwd'), 'etc-passwd');
  assert.equal(safeSegment('C:\\x'), 'C-x');
  assert.equal(safeSegment('...'), 'item');
  assert.equal(safeSegment('.hidden'), 'hidden');
  assert.equal(safeSegment('x'.repeat(100)).length, 60);
  assert.match(safeSegment('CON'), /^_CON$/i);
  const taken = new Set();
  assert.deepEqual(['a:b', 'a/b', 'A-B', 'a-b'].map(s => safeSegment(s, taken)), ['a-b', 'a-b-2', 'A-B-3', 'a-b-4']);
  assert.equal(safeSegment('y'.repeat(80), taken).length, 60); assert.equal(safeSegment('y'.repeat(80), taken), `${'y'.repeat(58)}-2`);

  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-ids-'));
  fs.mkdirSync(path.join(runDir, 'artifacts'));
  const ids = ['../evil', '..', 'a:b', 'a/b', '.hidden', 'C:\\Windows', 'x'.repeat(100), 'nul', '..\\..\\up'];
  const run = mkRun({ id: 'rp-ids-1', cases: ids.map(id => c(id)), triage: {},
    results: ids.map((id, i) => { fs.writeFileSync(path.join(runDir, 'artifacts', `${i}.png`), makePng(4, 4, [i, i, i])); return { id, status: 'FAIL', expected: 'e', actual: 'a', attachments: [{ name: '../../Final: result', path: `artifacts/${i}.png`, contentType: 'image/png' }] }; }) });
  const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'all' }, who: 'T', now: fixedNow });
  const zip = openPack(out.file), names = [...zip.keys()];
  for (const n of names) {
    assert.ok(!n.includes(':') && !n.includes('\\') && !n.startsWith('/'), n);
    assert.ok(!n.split('/').some(s => s === '..' || s === '.' || s.startsWith('.')), n);
  }
  const folders = evidenceNames(zip).map(n => n.split('/')[1]);
  assert.equal(folders.length, ids.length);
  assert.equal(new Set(folders.map(f => f.toLowerCase())).size, ids.length, 'unique even on case-insensitive disks');
  for (const f of folders) { assert.match(f, /^[A-Za-z0-9_][A-Za-z0-9._-]*$/); assert.ok(f.length <= 60, f); assert.ok(!/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(f), f); }
  assert.ok(evidenceNames(zip).every(n => /\/1-final-result\.png$/.test(n)));
});

test('a missing screenshot file is listed in manifest.missingEvidence and the pack still builds', async () => {
  const { run, runDir } = packFixture();
  const outside = path.join(path.dirname(runDir), `outside-${path.basename(runDir)}.png`);
  fs.writeFileSync(outside, Buffer.from('OUTSIDE-SECRET-CONTENT'));
  run.results[1].attachments = [{ name: 'Final result', path: 'artifacts/gone.png', contentType: 'image/png' }];
  run.results[2].attachments.push({ name: 'Escape', path: `../${path.basename(outside)}`, contentType: 'image/png' }, { name: 'Absolute', path: outside, contentType: 'image/png' });
  const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'findings' }, who: 'T', now: fixedNow });
  const zip = openPack(out.file);
  const miss = out.manifest.missingEvidence;
  assert.equal(miss.length, 3);
  assert.ok(miss.some(m => m.includes('P-2') && m.includes('gone.png')));
  assert.equal(miss.filter(m => m.includes('P-3')).length, 2);
  assert.deepEqual(evidenceNames(zip).sort(), ['evidence/P-3/1-step-one.png', 'evidence/P-3/2-step-two.png']);
  for (const [, read] of zip) assert.ok(!read().includes('OUTSIDE-SECRET-CONTENT'));
  assert.match(zip.get('00-README.txt')().toString('utf8'), /3 screenshot file\(s\) could not be included/);
  fs.unlinkSync(outside);
});

test('zero matching cases builds a pack whose README says No cases match this filter and whose totals are intact', { skip: !pdfDeps && 'reportlab/Pillow not installed' }, async () => {
  const { run, runDir } = packFixture();
  const out = await buildPack({ run, runDir, req: { reports: ['summary', 'log'], filter: { caseIds: ['NOPE'] }, evidence: 'all' }, who: 'T', now: fixedNow });
  const zip = openPack(out.file);
  const readme = zip.get('00-README.txt')().toString('utf8');
  assert.match(readme, /No cases match this filter/);
  assert.match(readme, /passed: 1/); assert.match(readme, /failed: 2/); assert.match(readme, /not-executed: 1/);
  assert.equal(out.manifest.listed, 0); assert.equal(out.manifest.total, 4);
  assert.equal(out.manifest.filterDescription, 'Cases: NOPE');
  assert.deepEqual(evidenceNames(zip), []);
  assert.equal(zip.get('01-Release-Summary.pdf')().subarray(0, 4).toString('latin1'), '%PDF');
  const wb = await rdr(zip.get('03-Execution-Log.xlsx')());
  assert.equal(wb.getWorksheet('Results').rowCount, 1);
  const rows = []; wb.getWorksheet('Summary').eachRow(r => rows.push(r.values.slice(1)));
  assert.ok(rows.some(([k, v]) => k === 'passed' && v === 1)); assert.ok(rows.some(([k, v]) => k === 'failed' && v === 2));
  assert.match(zip.get('01-Release-Summary.md')().toString('utf8'), /Showing 0 of 4 cases/);
});

test('estimatePack counts screenshots by level and returns 0 cases for an empty match', () => {
  const { run, runDir } = packFixture();
  const size = f => fs.statSync(path.join(runDir, 'artifacts', f)).size;
  const est = (evidence, extra = {}) => estimatePack(run, { reports: ['log'], filter: {}, evidence, ...extra }, { runDir });
  assert.deepEqual(est('none'), { cases: 4, findings: 2, screenshots: 0, bytes: 0, seconds: 5.04 });
  assert.deepEqual(est('findings'), { cases: 4, findings: 2, screenshots: 3, bytes: size('p2-a.png') + size('p3-a.png') + size('p3-b.png'), seconds: 5.04 });
  assert.equal(est('final').screenshots, 3); assert.equal(est('final').bytes, size('p1-b.png') + size('p2-a.png') + size('p3-b.png'));
  assert.equal(est('all').screenshots, 6);
  assert.equal(est('none', { reports: ['bugs', 'summary'] }).seconds, 6.54);
  const empty = est('all', { reports: ['bugs'], filter: { caseIds: ['NOPE'] } });
  assert.deepEqual(empty, { cases: 0, findings: 0, screenshots: 0, bytes: 0, seconds: 5 });
  run.results[1].attachments[0].path = 'artifacts/gone.png';
  const missing = est('findings');
  assert.equal(missing.screenshots, 3); assert.equal(missing.bytes, size('p3-a.png') + size('p3-b.png'));
  assert.throws(() => estimatePack(run, { reports: ['log'], filter: {}, evidence: 'most' }, { runDir }), e => e.status === 400);
});

test('unfinished and authentication runs are rejected', async () => {
  const { run, runDir } = packFixture();
  const req = { reports: ['log'], filter: {}, evidence: 'none' };
  for (const bad of [{ ...run, status: 'running' }, { ...run, status: 'queued' }, { ...run, kind: 'authentication' }, { ...run, results: [] }]) {
    await assert.rejects(buildPack({ run: bad, runDir, req, who: 'T' }), e => e.status === 409);
    assert.throws(() => estimatePack(bad, req, { runDir }), e => e.status === 409);
  }
  assert.ok(!fs.existsSync(path.join(runDir, 'packs')) || fs.readdirSync(path.join(runDir, 'packs')).length === 0);
});

test('normalizeRequest validates reports, evidence and filter; packFingerprint is stable and request-sensitive', () => {
  assert.deepEqual(normalizeRequest({ reports: ['log', 'summary', 'log'], filter: { classes: ['failed', 'bogus'], evil: 1 }, evidence: 'final' }), { reports: ['summary', 'log'], filter: { classes: ['failed'] }, evidence: 'final' });
  for (const bad of [null, 'x', [], {}, { reports: [], evidence: 'none' }, { reports: ['log', 'nope'], evidence: 'none' }, { reports: ['constructor'], evidence: 'none' }, { reports: 'log', evidence: 'none' }, { reports: ['log'] }, { reports: ['log'], evidence: 'ALL' }, { reports: ['log'], evidence: 'toString' }]) {
    assert.throws(() => normalizeRequest(bad), e => e.status === 400, JSON.stringify(bad));
  }
  const { run } = packFixture();
  const a = packFingerprint(run, { reports: ['log', 'bugs'], filter: {}, evidence: 'none' });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, packFingerprint(structuredClone(run), { reports: ['bugs', 'log'], filter: { evil: 1 }, evidence: 'none' }));
  assert.notEqual(a, packFingerprint(run, { reports: ['log', 'bugs'], filter: {}, evidence: 'all' }));
  const changed = structuredClone(run); changed.results[0].status = 'FAIL';
  assert.notEqual(a, packFingerprint(changed, { reports: ['log', 'bugs'], filter: {}, evidence: 'none' }));
});

test('newFailuresOnly uses the previous run document and the summary compares with it', { skip: !pdfDeps && 'reportlab/Pillow not installed' }, async () => {
  const { run, runDir } = packFixture();
  const previous = mkRun({ id: 'rp-prev', cases: [c('P-1'), c('P-2'), c('P-3')], results: [{ id: 'P-1', status: 'PASS', attachments: [] }, { id: 'P-2', status: 'FAIL', attachments: [] }, { id: 'P-3', status: 'PASS', attachments: [] }], triage: {} });
  const out = await buildPack({ run, runDir, previous, req: { reports: ['summary', 'log'], filter: { newFailuresOnly: true }, evidence: 'findings' }, who: 'T', now: fixedNow });
  assert.equal(out.manifest.listed, 1);
  const zip = openPack(out.file);
  assert.deepEqual(evidenceNames(zip).map(n => n.split('/')[1]), ['P-3', 'P-3']);
  const wb = await rdr(zip.get('03-Execution-Log.xlsx')());
  assert.equal(wb.getWorksheet('Results').getRow(2).getCell(1).value, 'P-3');
  assert.match(zip.get('01-Release-Summary.md')().toString('utf8'), /Compared with previous run[\s\S]*Newly failing: 1[\s\S]*Fixed: 0/);
  assert.equal(estimatePack(run, { reports: ['log'], filter: { newFailuresOnly: true }, evidence: 'findings' }, { runDir, previous }).cases, 1);
});

test('a 1000-case synthetic run builds with bounded memory', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-big-'));
  fs.mkdirSync(path.join(runDir, 'artifacts'));
  const N = 1000, cases = [], results = [];
  for (let i = 0; i < N; i++) {
    const id = `B-${String(i).padStart(4, '0')}`;
    fs.writeFileSync(path.join(runDir, 'artifacts', `${id}.png`), Buffer.alloc(64 * 1024, i % 251));
    cases.push(c(id, { title: `Big case ${i} ${'detail '.repeat(20)}` }));
    results.push({ id, status: i % 10 === 0 ? 'FAIL' : 'PASS', expected: 'e'.repeat(200), actual: 'a'.repeat(200), attachments: [{ name: 'Final result', path: `artifacts/${id}.png`, contentType: 'image/png' }] });
  }
  const run = mkRun({ id: 'rp-big-1', cases, results, triage: {} });
  const used = () => { const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };
  const base = used();
  let peak = base;
  const timer = setInterval(() => { peak = Math.max(peak, used()); }, 5);
  try {
    const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'all' }, who: 'T', now: fixedNow });
    peak = Math.max(peak, used());
    assert.equal(out.manifest.listed, N);
    assert.equal(out.manifest.files.filter(f => f.path.startsWith('evidence/')).length, N);
    assert.ok(out.size > N * 64 * 1024);
  } finally { clearInterval(timer); }
  assert.ok(peak - base < 200 * 1024 * 1024, `heap growth ${Math.round((peak - base) / 1048576)} MB`);
});
