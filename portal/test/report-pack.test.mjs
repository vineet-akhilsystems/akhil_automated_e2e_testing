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
