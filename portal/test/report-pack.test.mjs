import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { reportModel } from '../quality.mjs';
import { redactRun } from '../reports/redact.mjs';
import { PRESETS, normalizeFilter, applyFilter } from '../reports/filter.mjs';
import { boot, signedIn, makeUser, until } from './support.mjs';
import { createReportJobs } from '../reports/jobs.mjs';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { REPORTS, PACK_FORMAT, safeSegment, normalizeRequest, packFingerprint, estimatePack, buildPack } from '../reports/pack.mjs';
import { readZip } from '../zip.mjs';
import { generatePdf, pdfTimeoutMs, pdfScreenshotsFor, rendererFingerprint } from '../pdf-report.mjs';

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

test('newFailuresOnly uses previousFailedIds and counts only open failed and assumed-rule cases', () => {
  // A-4 (execution issue) and A-6 (quarantined) are not new failures: same definition as the summary comparison.
  const r = applyFilter(filterModel(), { newFailuresOnly: true }, { previousFailedIds: new Set(['A-2']) });
  assert.deepEqual(ids(r), ['A-3']);
  assert.deepEqual(ids(applyFilter(filterModel(), { newFailuresOnly: true })), ['A-2', 'A-3']);
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
const fixedNow = () => new Date(2026, 10, 14, 12, 30, 0); // local noon, so the local date is 2026-11-14 in any time zone
const tempDir = (t, prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

function packFixture(t, extra = {}) {
  const runDir = tempDir(t, 'pack-build-');
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
// Every entry sits under one root folder; returns entries keyed by their path inside it (root on .root).
function openPack(file) {
  const raw = readZip(fs.readFileSync(file)), names = [...raw.keys()];
  const root = names[0].split('/')[0];
  for (const n of names) assert.ok(n.startsWith(`${root}/`), `outside the root folder: ${n}`);
  const zip = new Map(names.map(n => [n.slice(root.length + 1), raw.get(n)]));
  zip.root = root;
  return zip;
}
const entryCount = file => { const b = fs.readFileSync(file); return b.readUInt16LE(b.length - 12); }; // EOCD record count (no comment)
const evidenceNames = zip => [...zip.keys()].filter(n => n.startsWith('evidence/'));

test('default pack contains README, selected reports and a manifest whose sha256 values match the files', { skip: !pdfDeps && 'reportlab/Pillow not installed' }, async t => {
  const { run, runDir } = packFixture(t);
  const progress = [];
  const out = await buildPack({ run, runDir, req: ALL_REPORTS, who: 'Tester', now: fixedNow, onProgress: s => progress.push(s) });
  assert.equal(path.dirname(out.file), path.join(runDir, 'packs'));
  assert.match(path.basename(out.file), /^registration_2026-11-14_run-rp-pk-1x_[0-9a-f]{8}\.zip$/);
  assert.equal(path.basename(out.file).slice(-12, -4), packFingerprint(run, ALL_REPORTS).slice(0, 8));
  assert.equal(out.size, fs.statSync(out.file).size);
  assert.deepEqual(fs.readdirSync(path.join(runDir, 'packs')), [path.basename(out.file)], 'temp files are cleaned up');
  const zip = openPack(out.file), names = [...zip.keys()];
  assert.equal(zip.root, 'registration_2026-11-14_run-rp-pk-1x');
  assert.equal(entryCount(out.file), names.length);
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
  assert.deepEqual(manifest.run, { id: 'rp-pk-1x-abcdef', name: 'Pack', module: 'Registration', environment: 'UAT', status: 'failed', version: 'version unknown' });
  assert.equal(manifest.generatedAt, fixedNow().toISOString()); assert.equal(manifest.generatedBy, 'Tester');
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
  assert.ok(names.includes(link), 'the link resolves from the workbook inside the root folder');
  assert.ok(progress.includes('Building the execution log...'));
  assert.ok(progress.includes('Building the release summary...') && progress.includes('Building the bug report...'));
});

test('evidence level findings only includes screenshots of listed findings', async t => {
  const { run, runDir } = packFixture(t);
  const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'findings' }, who: 'T', now: fixedNow });
  const zip = openPack(out.file);
  assert.deepEqual(evidenceNames(zip).sort(), ['evidence/P-2/1-final-result.png', 'evidence/P-3/1-step-one.png', 'evidence/P-3/2-step-two.png']);
  assert.deepEqual(zip.get('evidence/P-3/2-step-two.png')(), fs.readFileSync(path.join(runDir, 'artifacts/p3-b.png')));
  const only3 = await buildPack({ run, runDir, req: { reports: ['log'], filter: { caseIds: ['P-1', 'P-3'] }, evidence: 'findings' }, who: 'T', now: fixedNow });
  assert.deepEqual(evidenceNames(openPack(only3.file)).sort(), ['evidence/P-3/1-step-one.png', 'evidence/P-3/2-step-two.png']);
  assert.equal(only3.manifest.listed, 2); assert.equal(only3.manifest.total, 4);
});

test('evidence level none includes no evidence folder', async t => {
  const { run, runDir } = packFixture(t);
  const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'none' }, who: 'T', now: fixedNow });
  const zip = openPack(out.file);
  assert.deepEqual(evidenceNames(zip), []);
  assert.equal(out.manifest.evidence, 'none');
  assert.ok(!out.manifest.files.some(f => f.path.startsWith('evidence')));
  const wb = await rdr(zip.get('03-Execution-Log.xlsx')());
  wb.getWorksheet('Results').eachRow((r, i) => { if (i > 1) assert.ok(!r.getCell(16).value?.hyperlink); });
});

test('final level keeps every finding screenshot and picks the Final result screenshot for other cases', async t => {
  const { run, runDir } = packFixture(t);
  const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'final' }, who: 'T', now: fixedNow });
  const zip = openPack(out.file);
  assert.deepEqual(evidenceNames(zip).sort(), ['evidence/P-1/1-final-result.png', 'evidence/P-2/1-final-result.png', 'evidence/P-3/1-step-one.png', 'evidence/P-3/2-step-two.png']);
  assert.deepEqual(zip.get('evidence/P-1/1-final-result.png')(), fs.readFileSync(path.join(runDir, 'artifacts/p1-b.png')));
  assert.match(zip.get('00-README.txt')().toString('utf8'), /all screenshots of the listed findings, plus the final screenshot of every other listed case/);
  run.results[0].attachments[1].name = 'Middle'; // no "Final result": the last image of the passed case
  const last = await buildPack({ run, runDir, req: { reports: ['log'], filter: { caseIds: ['P-1'] }, evidence: 'final' }, who: 'T', now: fixedNow });
  const lastZip = openPack(last.file);
  assert.deepEqual(evidenceNames(lastZip), ['evidence/P-1/1-after-toast.png']);
  assert.deepEqual(lastZip.get('evidence/P-1/1-after-toast.png')(), fs.readFileSync(path.join(runDir, 'artifacts/p1-c.png')));
  const all = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'all' }, who: 'T', now: fixedNow });
  assert.equal(evidenceNames(openPack(all.file)).length, 6);
});

test('case ids with ../ and : become safe unique folder names', async t => {
  assert.equal(safeSegment('../etc/passwd'), 'etc-passwd');
  assert.equal(safeSegment('C:\\x'), 'C-x');
  assert.equal(safeSegment('...'), 'item');
  assert.equal(safeSegment('.hidden'), 'hidden');
  assert.equal(safeSegment('x'.repeat(100)).length, 60);
  assert.match(safeSegment('CON'), /^_CON$/i);
  const taken = new Set();
  assert.deepEqual(['a:b', 'a/b', 'A-B', 'a-b'].map(s => safeSegment(s, taken)), ['a-b', 'a-b-2', 'A-B-3', 'a-b-4']);
  assert.equal(safeSegment('y'.repeat(80), taken).length, 60); assert.equal(safeSegment('y'.repeat(80), taken), `${'y'.repeat(58)}-2`);

  const runDir = tempDir(t, 'pack-ids-');
  fs.mkdirSync(path.join(runDir, 'artifacts'));
  const ids = ['../evil', '..', 'a:b', 'a/b', '.hidden', 'C:\\Windows', 'x'.repeat(100), 'nul', '..\\..\\up'];
  const run = mkRun({ id: 'rp-ids-1', cases: ids.map(id => c(id)), triage: {},
    results: ids.map((id, i) => { fs.writeFileSync(path.join(runDir, 'artifacts', `${i}.png`), makePng(4, 4, [i, i, i])); return { id, status: 'FAIL', expected: 'e', actual: 'a', attachments: [{ name: '../../Final: result', path: `artifacts/${i}.png`, contentType: 'image/png' }] }; }) });
  const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'all' }, who: 'T', now: fixedNow });
  const zip = openPack(out.file), names = [...zip.keys()].map(n => `${zip.root}/${n}`);
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

test('case ids like constructor and __proto__ get their own folders and evidence links', async t => {
  const runDir = tempDir(t, 'pack-proto-');
  fs.mkdirSync(path.join(runDir, 'artifacts'));
  const ids = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];
  const run = mkRun({ id: 'rp-proto-1', cases: ids.map(id => c(id)), triage: {},
    results: ids.map((id, i) => { fs.writeFileSync(path.join(runDir, 'artifacts', `${i}.png`), makePng(4, 4, [i, 0, 0])); return { id, status: 'FAIL', expected: 'e', actual: 'a', attachments: [{ name: 'Final result', path: `artifacts/${i}.png`, contentType: 'image/png' }] }; }) });
  const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'final' }, who: 'T', now: fixedNow });
  const zip = openPack(out.file);
  assert.deepEqual(evidenceNames(zip).sort(), ids.map(id => `evidence/${id}/1-final-result.png`).sort());
  const links = {};
  (await rdr(zip.get('03-Execution-Log.xlsx')())).getWorksheet('Results').eachRow((r, i) => { if (i > 1) links[`id:${r.getCell(1).value}`] = r.getCell(16).value?.hyperlink; });
  for (const id of ids) { assert.equal(links[`id:${id}`], `evidence/${id}/1-final-result.png`, id); assert.ok(zip.has(links[`id:${id}`])); }
});

test('repeated case ids in a run never produce duplicate zip entry names', async t => {
  const runDir = tempDir(t, 'pack-dup-');
  fs.mkdirSync(path.join(runDir, 'artifacts'));
  fs.writeFileSync(path.join(runDir, 'artifacts', 'd.png'), makePng(4, 4, [9, 9, 9]));
  const run = mkRun({ id: 'rp-dup-1', cases: [c('D-1'), c('D-1'), c('d-1')], triage: {},
    results: [{ id: 'D-1', status: 'FAIL', expected: 'e', actual: 'a', attachments: [{ name: 'Final result', path: 'artifacts/d.png', contentType: 'image/png' }] },
      { id: 'd-1', status: 'PASS', expected: 'e', actual: 'e', attachments: [{ name: 'Final result', path: 'artifacts/d.png', contentType: 'image/png' }] }] });
  for (const evidence of ['findings', 'final', 'all']) {
    const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence }, who: 'T', now: fixedNow });
    const paths = out.manifest.files.map(f => f.path);
    assert.equal(new Set(paths.map(p => p.toLowerCase())).size, paths.length, evidence);
    assert.equal(entryCount(out.file), paths.length + 1, evidence);
    assert.equal(paths.filter(p => p.startsWith('evidence/')).length, evidence === 'findings' ? 2 : 3, evidence);
  }
});

test('a missing screenshot file is listed in manifest.missingEvidence and the pack still builds', async t => {
  const { run, runDir } = packFixture(t);
  const outside = path.join(path.dirname(runDir), `outside-${path.basename(runDir)}.png`);
  t.after(() => fs.rmSync(outside, { force: true }));
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
});

test('zero matching cases builds a pack whose README says No cases match this filter and whose totals are intact', { skip: !pdfDeps && 'reportlab/Pillow not installed' }, async t => {
  const { run, runDir } = packFixture(t);
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

test('estimatePack counts screenshots by level and returns 0 cases for an empty match', t => {
  const { run, runDir } = packFixture(t);
  const size = f => fs.statSync(path.join(runDir, 'artifacts', f)).size;
  const est = (evidence, extra = {}) => estimatePack(run, { reports: ['log'], filter: {}, evidence, ...extra }, { runDir });
  assert.deepEqual(est('none'), { cases: 4, findings: 2, screenshots: 0, bytes: 0, seconds: 5.04 });
  assert.deepEqual(est('findings'), { cases: 4, findings: 2, screenshots: 3, bytes: size('p2-a.png') + size('p3-a.png') + size('p3-b.png'), seconds: 5.04 });
  assert.equal(est('final').screenshots, 4); assert.equal(est('final').bytes, size('p1-b.png') + size('p2-a.png') + size('p3-a.png') + size('p3-b.png'));
  assert.equal(est('all').screenshots, 6);
  assert.equal(est('none', { reports: ['bugs', 'summary'] }).seconds, 6.54);
  const empty = est('all', { reports: ['bugs'], filter: { caseIds: ['NOPE'] } });
  assert.deepEqual(empty, { cases: 0, findings: 0, screenshots: 0, bytes: 0, seconds: 5 });
  run.results[1].attachments[0].path = 'artifacts/gone.png';
  const missing = est('findings');
  assert.equal(missing.screenshots, 3); assert.equal(missing.bytes, size('p3-a.png') + size('p3-b.png'));
  assert.throws(() => estimatePack(run, { reports: ['log'], filter: {}, evidence: 'most' }, { runDir }), e => e.status === 400);
});

test('estimatePack and buildPack reject a pack too large for one ZIP with 413 before writing anything', async t => {
  const { run, runDir } = packFixture(t);
  run.results[2].attachments = Array.from({ length: 65000 }, (_, i) => ({ name: `Shot ${i}`, path: 'artifacts/p3-a.png', contentType: 'image/png' }));
  const req = { reports: ['log'], filter: {}, evidence: 'all' };
  assert.throws(() => estimatePack(run, req, { runDir }), e => e.status === 413 && /too large/.test(e.message));
  await assert.rejects(buildPack({ run, runDir, req, who: 'T', now: fixedNow }), e => e.status === 413);
  assert.ok(!fs.existsSync(path.join(runDir, 'packs')));
});

test('unfinished and authentication runs are rejected', async t => {
  const { run, runDir } = packFixture(t);
  const req = { reports: ['log'], filter: {}, evidence: 'none' };
  for (const bad of [{ ...run, status: 'running' }, { ...run, status: 'queued' }, { ...run, kind: 'authentication' }, { ...run, results: [] }]) {
    await assert.rejects(buildPack({ run: bad, runDir, req, who: 'T' }), e => e.status === 409);
    assert.throws(() => estimatePack(bad, req, { runDir }), e => e.status === 409);
  }
  assert.ok(!fs.existsSync(path.join(runDir, 'packs')) || fs.readdirSync(path.join(runDir, 'packs')).length === 0);
});

test('normalizeRequest validates reports, evidence and filter; packFingerprint is stable and request-sensitive', t => {
  assert.deepEqual(normalizeRequest({ reports: ['log', 'summary', 'log'], filter: { classes: ['failed', 'bogus'], evil: 1 }, evidence: 'final' }), { reports: ['summary', 'log'], filter: { classes: ['failed'] }, evidence: 'final' });
  for (const bad of [null, 'x', [], {}, { reports: [], evidence: 'none' }, { reports: ['log', 'nope'], evidence: 'none' }, { reports: ['constructor'], evidence: 'none' }, { reports: 'log', evidence: 'none' }, { reports: ['log'] }, { reports: ['log'], evidence: 'ALL' }, { reports: ['log'], evidence: 'toString' }]) {
    assert.throws(() => normalizeRequest(bad), e => e.status === 400, JSON.stringify(bad));
  }
  const { run } = packFixture(t);
  const a = packFingerprint(run, { reports: ['log', 'bugs'], filter: {}, evidence: 'none' });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, packFingerprint(structuredClone(run), { reports: ['bugs', 'log'], filter: { evil: 1 }, evidence: 'none' }));
  assert.notEqual(a, packFingerprint(run, { reports: ['log', 'bugs'], filter: {}, evidence: 'all' }));
  const changed = structuredClone(run); changed.results[0].status = 'FAIL';
  assert.notEqual(a, packFingerprint(changed, { reports: ['log', 'bugs'], filter: {}, evidence: 'none' }));
});

test('newFailuresOnly uses the previous run document and the summary compares with it', { skip: !pdfDeps && 'reportlab/Pillow not installed' }, async t => {
  const { run, runDir } = packFixture(t);
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

test('a 1000-case synthetic run with 300 MB of evidence builds with bounded memory', async t => {
  const runDir = tempDir(t, 'pack-big-');
  fs.mkdirSync(path.join(runDir, 'artifacts'));
  const N = 1000, SHOT = 300 * 1024, cases = [], results = [];
  for (let i = 0; i < N; i++) {
    const id = `B-${String(i).padStart(4, '0')}`;
    fs.writeFileSync(path.join(runDir, 'artifacts', `${id}.png`), Buffer.alloc(SHOT, i % 251));
    cases.push(c(id, { title: `Big case ${i} ${'detail '.repeat(20)}` }));
    results.push({ id, status: i % 10 === 0 ? 'FAIL' : 'PASS', expected: 'e'.repeat(200), actual: 'a'.repeat(200), attachments: [{ name: 'Final result', path: `artifacts/${id}.png`, contentType: 'image/png' }] });
  }
  const run = mkRun({ id: 'rp-big-1', cases, results, triage: {} });
  const bound = 200 * 1024 * 1024;
  assert.ok(N * SHOT > bound * 1.4, 'the evidence is clearly larger than the memory bound');
  const used = () => { const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };
  const base = used();
  let peak = base;
  const timer = setInterval(() => { peak = Math.max(peak, used()); }, 5);
  try {
    const out = await buildPack({ run, runDir, req: { reports: ['log'], filter: {}, evidence: 'all' }, who: 'T', now: fixedNow });
    peak = Math.max(peak, used());
    assert.equal(out.manifest.listed, N);
    assert.equal(out.manifest.files.filter(f => f.path.startsWith('evidence/')).length, N);
    assert.ok(out.size > N * SHOT);
  } finally { clearInterval(timer); }
  assert.ok(peak - base < bound, `heap growth ${Math.round((peak - base) / 1048576)} MB`);
});

// ---- Report pack jobs and routes ----
const PACK_ADMIN = { username: 'root', password: 'correct-horse-battery' };
const LOG_ONLY = { reports: ['log'], filter: {}, evidence: 'findings' };
async function jobWorld(t, extra = {}) {
  const f = await boot(t, { bootstrap: PACK_ADMIN, ...extra });
  const admin = await signedIn(f, PACK_ADMIN.username, PACK_ADMIN.password);
  const run = mkRun({ id: 'rp-job-run', module: structuredClone(f.store.module('registration')), status: 'failed' });
  f.store.saveRun(run);
  return { f, admin, run, runDir: f.queue.dirFor('rp-job-run') };
}
const finished = (client, runId, id) => until(async () => { const r = await client.request(`/api/runs/${runId}/report-packs/${id}`); return !['running', 'queued'].includes(r.value.status) ? r.value : null; });

test('estimate returns counts and 400 for unknown report or evidence level', async t => {
  const { admin } = await jobWorld(t);
  const ok = await admin.request('/api/runs/rp-job-run/report-pack/estimate', 'POST', LOG_ONLY);
  assert.equal(ok.status, 200, JSON.stringify(ok.value));
  assert.deepEqual(Object.keys(ok.value).sort(), ['bytes', 'cases', 'findings', 'screenshots', 'seconds']);
  assert.equal(ok.value.cases, 3);
  assert.equal((await admin.request('/api/runs/rp-job-run/report-pack/estimate', 'POST', { ...LOG_ONLY, reports: ['nope'] })).status, 400);
  assert.equal((await admin.request('/api/runs/rp-job-run/report-pack/estimate', 'POST', { ...LOG_ONLY, evidence: 'lots' })).status, 400);
  assert.equal((await admin.request('/api/runs/missing-run/report-pack/estimate', 'POST', LOG_ONLY)).status, 404);
});

test('start returns 202, the job finishes done, download returns a ZIP with MANIFEST.json, and the audit event holds no paths', async t => {
  const { f, admin, runDir } = await jobWorld(t);
  const started = await admin.request('/api/runs/rp-job-run/report-pack', 'POST', LOG_ONLY);
  assert.equal(started.status, 202, JSON.stringify(started.value));
  const job = await finished(admin, 'rp-job-run', started.value.id);
  assert.equal(job.status, 'done', JSON.stringify(job));
  assert.ok(job.progress.length > 0);
  assert.ok(!JSON.stringify(job).includes(runDir), 'no server path is exposed');
  assert.deepEqual((await admin.request('/api/runs/rp-job-run/report-packs')).value.map(j => j.id), [started.value.id]);
  const dl = await admin.request(`/api/runs/rp-job-run/report-packs/${started.value.id}/download`);
  assert.equal(dl.status, 200);
  assert.match(dl.response.headers.get('content-disposition'), /^attachment; filename="[\w.-]+\.zip"$/);
  assert.ok([...readZip(dl.value).keys()].some(n => n.endsWith('/MANIFEST.json')));
  assert.ok(!fs.readdirSync(path.join(runDir, 'packs')).some(n => n.startsWith('.tmp-')), 'no partial files left');
  const events = f.store.auditLog({ scopeType: 'module', scopeId: 'registration' }).filter(e => e.action === 'run.report-pack');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail.reports, ['log']);
  assert.ok(!JSON.stringify(events[0]).includes(runDir));
});

test('identical concurrent requests return the same job id, and a finished identical pack is reused', async t => {
  const { admin } = await jobWorld(t);
  const [a, b] = await Promise.all([1, 2].map(() => admin.request('/api/runs/rp-job-run/report-pack', 'POST', LOG_ONLY)));
  assert.equal(a.value.id, b.value.id);
  await finished(admin, 'rp-job-run', a.value.id); // one active pack per user and run: a different request waits for this one
  const other = await admin.request('/api/runs/rp-job-run/report-pack', 'POST', { ...LOG_ONLY, evidence: 'none' });
  assert.notEqual(other.value.id, a.value.id);
  await finished(admin, 'rp-job-run', other.value.id);
  assert.equal((await admin.request('/api/runs/rp-job-run/report-pack', 'POST', LOG_ONLY)).value.id, a.value.id);
  assert.equal((await admin.request('/api/runs/rp-job-run/report-packs')).value.length, 2);
});

test('a finished pack whose ZIP is gone is built again', async t => {
  const { admin, runDir } = await jobWorld(t);
  const a = await admin.request('/api/runs/rp-job-run/report-pack', 'POST', LOG_ONLY);
  assert.equal((await finished(admin, 'rp-job-run', a.value.id)).status, 'done');
  for (const n of fs.readdirSync(path.join(runDir, 'packs')).filter(n => n.endsWith('.zip'))) fs.rmSync(path.join(runDir, 'packs', n));
  assert.equal((await admin.request(`/api/runs/rp-job-run/report-packs/${a.value.id}/download`)).status, 404);
  const b = await admin.request('/api/runs/rp-job-run/report-pack', 'POST', LOG_ONLY);
  assert.notEqual(b.value.id, a.value.id);
  assert.equal((await finished(admin, 'rp-job-run', b.value.id)).status, 'done');
});

test('a viewer can build and download but a user without access to the module gets 404', async t => {
  const { f, admin } = await jobWorld(t);
  const vic = await makeUser(admin, 'vic', 'viewer'), v = await signedIn(f, 'vic', vic.password);
  const mia = await makeUser(admin, 'mia', 'member'), m = await signedIn(f, 'mia', mia.password);
  const started = await v.request('/api/runs/rp-job-run/report-pack', 'POST', LOG_ONLY);
  assert.equal(started.status, 202, JSON.stringify(started.value));
  assert.equal((await finished(v, 'rp-job-run', started.value.id)).status, 'done');
  assert.equal((await v.request(`/api/runs/rp-job-run/report-packs/${started.value.id}/download`)).status, 200);
  for (const [method, route, body] of [['POST', '/report-pack/estimate', LOG_ONLY], ['POST', '/report-pack', LOG_ONLY], ['GET', '/report-packs'], ['GET', `/report-packs/${started.value.id}`], ['GET', `/report-packs/${started.value.id}/download`]]) {
    assert.equal((await m.request(`/api/runs/rp-job-run${route}`, method, body)).status, 404, `${method} ${route}`);
  }
});

test('a job id of another run is 404, and odd job ids never address files', async t => {
  const { f, admin, run } = await jobWorld(t);
  f.store.saveRun({ ...run, id: 'rp-job-run-b' });
  const a = await admin.request('/api/runs/rp-job-run/report-pack', 'POST', LOG_ONLY);
  await finished(admin, 'rp-job-run', a.value.id);
  assert.equal((await admin.request(`/api/runs/rp-job-run-b/report-packs/${a.value.id}`)).status, 404);
  assert.equal((await admin.request(`/api/runs/rp-job-run-b/report-packs/${a.value.id}/download`)).status, 404);
  assert.equal((await admin.request('/api/runs/rp-job-run/report-packs/..%2F..%2Fx/download')).status, 404);
  assert.equal((await admin.request('/api/runs/rp-job-run/report-packs/nope')).status, 404);
});

test('unfinished runs are rejected with 409', async t => {
  const { f, admin, run } = await jobWorld(t);
  f.store.saveRun({ ...run, id: 'rp-job-live', status: 'running' });
  assert.equal((await admin.request('/api/runs/rp-job-live/report-pack', 'POST', LOG_ONLY)).status, 409);
  assert.equal((await admin.request('/api/runs/rp-job-live/report-pack/estimate', 'POST', LOG_ONLY)).status, 409);
});

test('a stuck running job file becomes an error after restart, and the list never shows partial zips', async t => {
  const dir = tempDir(t, 'pack-jobs-');
  const dirFor = id => path.join(dir, id), packs = path.join(dirFor('r1'), 'packs');
  fs.mkdirSync(packs, { recursive: true });
  fs.writeFileSync(path.join(packs, 'stuck-1.json'), JSON.stringify({ id: 'stuck-1', runId: 'r1', status: 'running', startedAt: '2026-11-14T10:00:00.000Z', finishedAt: null, progress: ['Preparing...'], request: LOG_ONLY }));
  fs.writeFileSync(path.join(packs, '.tmp-abc.zip'), 'partial');
  const runs = [{ id: 'r1' }];
  const jobs = createReportJobs({ store: { runs: () => runs, run: id => runs.find(r => r.id === id) }, dirFor });
  const job = jobs.get('r1', 'stuck-1');
  assert.equal(job.status, 'error');
  assert.equal(job.error, 'The portal restarted while this was building.');
  assert.ok(job.finishedAt);
  assert.equal(JSON.parse(fs.readFileSync(path.join(packs, 'stuck-1.json'), 'utf8')).status, 'error');
  assert.deepEqual(jobs.list('r1').map(j => j.id), ['stuck-1']);
  assert.throws(() => jobs.filePath('r1', 'stuck-1'), e => e.status === 409);
  assert.throws(() => jobs.filePath('r1', '.tmp-abc'), e => e.status === 404);
  await jobs.stop();
});

test('download of an unfinished job is 409', async t => {
  const { admin, runDir } = await jobWorld(t);
  fs.mkdirSync(path.join(runDir, 'packs'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'packs', 'live-1.json'), JSON.stringify({ id: 'live-1', runId: 'rp-job-run', status: 'running', startedAt: new Date().toISOString(), finishedAt: null, progress: [], request: LOG_ONLY }));
  // A record written by another process is only trusted after a restart: here it is read from disk as it is.
  const r = await admin.request('/api/runs/rp-job-run/report-packs/live-1/download');
  assert.equal(r.status, 409, JSON.stringify(r.value));
});

// ---- Task 8: the dialog's pure request builder ----
const packUi = () => import("../public/report-pack-request.js");
const ALL_OFF = { reports: [], filter: {}, evidence: 'findings' };

test('buildPackRequest maps preset, ticked reports, filter fields and evidence level to the API body', async () => {
  const { buildPackRequest, PACK_PRESETS } = await packUi();
  assert.deepEqual(buildPackRequest({ preset: 'developers' }), { reports: ['bugs'], filter: { classes: ['failed', 'review'] }, evidence: 'findings' });
  assert.deepEqual(buildPackRequest({ preset: 'release' }), { reports: ['summary'], filter: {}, evidence: 'none' });
  assert.deepEqual(buildPackRequest({ preset: 'testlead' }), { reports: ['log'], filter: {}, evidence: 'none' });
  assert.deepEqual(buildPackRequest({ preset: 'default' }), { reports: ['summary', 'bugs', 'log'], filter: {}, evidence: 'findings' });
  assert.deepEqual(Object.keys(PACK_PRESETS), ['developers', 'release', 'testlead', 'default', 'custom']);
  const body = buildPackRequest({
    preset: 'custom', reports: ['log', 'bugs'], evidence: 'final',
    filter: { classes: ['failed', ''], priorities: ['P0'], suites: ' Login, Profile\nBilling ,, ', requirements: ' REQ-1 ', severities: ['High'], text: '  timeout  ', caseIds: ['A-1'] },
  });
  assert.deepEqual(body, {
    reports: ['bugs', 'log'], evidence: 'final',
    filter: { classes: ['failed'], priorities: ['P0'], suites: ['Login', 'Profile', 'Billing'], requirements: ['REQ-1'], severities: ['High'], caseIds: ['A-1'], text: 'timeout' },
  });
  assert.deepEqual(buildPackRequest({ preset: 'custom', reports: ['summary'], evidence: 'none', filter: { text: '   ', suites: '' } }).filter, {});
});

test('custom preset with nothing ticked is rejected client-side', async () => {
  const { buildPackRequest } = await packUi();
  assert.throws(() => buildPackRequest({ preset: 'custom', ...ALL_OFF }), /Choose at least one report\./);
  assert.throws(() => buildPackRequest({ preset: 'custom', reports: ['nope'], evidence: 'none' }), /Choose at least one report\./);
});

test('every preset and a custom request validate against the server normalizeRequest', async () => {
  const { buildPackRequest, PACK_PRESETS } = await packUi();
  for (const preset of Object.keys(PACK_PRESETS).filter(k => k !== 'custom')) {
    const body = buildPackRequest({ preset });
    assert.deepEqual(normalizeRequest(body), body, preset);
  }
  const custom = buildPackRequest({ preset: 'custom', reports: ['summary', 'log'], evidence: 'all', filter: { classes: ['passed'], suites: 'a,b', text: 'x' } });
  assert.deepEqual(normalizeRequest(custom), custom);
});

test('an estimate response only counts while the form still produces the request it answered', async () => {
  const { estimateIsCurrent, buildPackRequest } = await packUi();
  const a = buildPackRequest({ preset: 'developers' }), b = buildPackRequest({ preset: 'default' });
  assert.equal(estimateIsCurrent(a, buildPackRequest({ preset: 'developers' })), true);
  assert.equal(estimateIsCurrent(a, b), false);
  assert.equal(estimateIsCurrent(a, null), false, 'an invalid current form is never current');
});

test('describeEstimate prints the run total only when it is known and humanizes size and time', async () => {
  const { describeEstimate } = await packUi();
  assert.equal(describeEstimate({ cases: 37, screenshots: 61, bytes: 14.2 * 1048576, seconds: 40 }, 1000), '37 of 1,000 cases, 61 screenshots, about 14.2 MB, about 40 seconds');
  assert.equal(describeEstimate({ cases: 5, screenshots: 1, bytes: 10, seconds: 130 }, undefined), '5 cases, 1 screenshot, under 1 KB, about 2 minutes');
  assert.equal(describeEstimate({ cases: 1, screenshots: 0, bytes: 2048, seconds: 1 }, 0), '1 case, 0 screenshots, about 2 KB, about 1 second');
});

test('the portal serves the dialog request module as JavaScript', async t => {
  const f = await boot(t);
  const res = await fetch(`${f.base}/report-pack-request.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
  assert.match(await res.text(), /export function buildPackRequest/);
});

// ---- Scale check: 1,000 cases, 3,600 screenshot entries, default log + bugs pack, no evidence ----
// 40 findings (every 25th case); 100 passing cases also have real image files, so embedding them would be caught.
function scaleRun(runDir) {
  fs.mkdirSync(path.join(runDir, 'artifacts'));
  const cases = [], results = [], png = makePng(4, 4, [30, 90, 200]);
  let entries = 0, findingShots = 0;
  for (let i = 0; i < 1000; i++) {
    const id = `S-${String(i).padStart(4, '0')}`, finding = i % 25 === 0, real = finding || i % 10 === 1; // i%10===1: 100 passing cases with files
    const shots = i % 5 < 3 ? 4 : 3; // 600 cases x 4 + 400 cases x 3 = 3,600
    const attachments = [];
    for (let s = 0; s < shots; s++) {
      const rel = `artifacts/${id}-${s}.png`;
      if (real) fs.writeFileSync(path.join(runDir, rel), png);
      if (finding) findingShots++;
      attachments.push({ name: s === shots - 1 ? 'Final result' : `Stage ${s}`, path: rel, contentType: 'image/png' });
      entries++;
    }
    cases.push(c(id, { title: `Scale case ${i}` }));
    results.push({ id, status: finding ? 'FAIL' : 'PASS', expected: 'e', actual: finding ? 'wrong' : 'e', attachments });
  }
  assert.equal(entries, 3600);
  return { run: mkRun({ id: 'rp-scale-1', cases, results, triage: {} }), findingShots };
}
async function scaleLog(t) {
  const runDir = tempDir(t, 'pack-scale-'), { run, findingShots } = scaleRun(runDir);
  const req = { reports: ['log'], filter: {}, evidence: 'none' };
  const estimate = estimatePack(run, req, { runDir });
  assert.equal(estimate.cases, 1000); assert.equal(estimate.findings, 40); assert.equal(estimate.screenshots, 0);
  const started = Date.now();
  const out = await buildPack({ run, runDir, req, who: 'T', now: fixedNow });
  const seconds = (Date.now() - started) / 1000;
  assert.ok(seconds < 90, `build took ${seconds} s`);
  assert.ok(out.size < 25 * 1048576, `ZIP is ${out.size} bytes (built in ${seconds} s)`);
  assert.equal(out.manifest.listed, 1000);
  return { run, runDir, findingShots, zip: openPack(out.file), req };
}
test('a 1000-case run with 3,600 screenshot entries builds the log pack within bounds', async t => {
  const { zip } = await scaleLog(t);
  const sheet = (await rdr(zip.get('03-Execution-Log.xlsx')())).getWorksheet('Results');
  let rows = 0; sheet.eachRow((row, n) => { if (n > 1 && row.getCell(1).value) rows++; });
  assert.equal(rows, 1000);
  assert.ok(!evidenceNames(zip).length, 'evidence none adds no screenshots');
});
test('the bugs PDF of a 1000-case run embeds exactly the screenshots of its findings', { skip: pdfSkip }, async t => {
  const runDir = tempDir(t, 'pack-scale-pdf-'), { run, findingShots } = scaleRun(runDir);
  const out = await buildPack({ run, runDir, req: { reports: ['bugs'], filter: {}, evidence: 'none' }, who: 'T', now: fixedNow });
  const file = path.join(runDir, 'scale-bugs.pdf'); fs.writeFileSync(file, openPack(out.file).get('02-Bug-Report.pdf')());
  const code = ['import sys, pypdf', 'r = pypdf.PdfReader(sys.argv[1])', 'print(sum(len(p.images) for p in r.pages))'].join('\n');
  const o = spawnSync(py, ['-I', '-c', code, file], { encoding: 'utf8' });
  assert.equal(o.status, 0, o.stderr);
  assert.equal(Number(o.stdout.trim()), findingShots, 'one embedded image per finding screenshot, none for the 100 passing cases that also have files');
});

const tempDirSync = t => tempDir(t, 'pack-limit-');
test('generatePdf bases the time limit on the listed rows\' screenshots and gives the effective summary mode the base limit', async t => {
  const shots = n => Array.from({ length: n }, (_, i) => ({ name: `s${i}`, path: `artifacts/s${i}.png`, contentType: 'image/png' }));
  const run = pdfRun(), seen = {};
  run.results[0].attachments = shots(30); run.results[1].attachments = shots(2); run.results[2].attachments = shots(5); // P-1 passed, P-2 and P-3 failed
  const whole = reportModel(run);
  // The whole run's count must not drive the limit: a narrowed model keeps evidenceCounts from the whole run.
  const model = { ...whole, evidenceCounts: { ...whole.evidenceCounts, totalScreenshots: 2000 } };
  const only3 = applyFilter(whole, { caseIds: ['P-3'] }), narrowed = { ...model, cases: only3.cases, findings: only3.findings };
  const saved = process.env.PORTAL_PYTHON;
  process.env.PORTAL_PYTHON = 'no-such-interpreter-for-limit-test'; // spawn fails right after the limit is computed
  try {
    const limit = async options => { let ms; await assert.rejects(generatePdf(run, tempDirSync(t), { model, ...options, onLimit: v => { ms = v; } })); return ms; };
    seen.summaryOption = await limit({ mode: 'summary' });
    seen.summaryFromModel = await limit({ model: { ...model, report: { mode: 'summary' } } });
    seen.bugs = await limit({ mode: 'bugs' });
    seen.full = await limit({ mode: 'full' });
    seen.narrowedBugs = await limit({ mode: 'bugs', model: narrowed });
    seen.default = await limit({ model: undefined });
  } finally { if (saved === undefined) delete process.env.PORTAL_PYTHON; else process.env.PORTAL_PYTHON = saved; }
  assert.equal(seen.summaryOption, 90000);
  assert.equal(seen.summaryFromModel, 90000);
  assert.equal(seen.bugs, pdfTimeoutMs(7), 'the findings\' screenshots');
  assert.equal(seen.full, pdfTimeoutMs(37), 'every listed case\'s screenshots');
  assert.equal(seen.narrowedBugs, pdfTimeoutMs(5));
  assert.equal(seen.default, pdfTimeoutMs(37), 'the default PDF (no mode) is the full report');
  assert.equal(pdfScreenshotsFor('bugs', narrowed), 5);
  assert.equal(pdfScreenshotsFor('summary', model), 0);
});

// ---- Final fix wave: verdict, filters, new failures, plain-word counts, previous run ----
import { previousRun } from '../compare.mjs';

// statuses: one recorded result per entry; notRun: extra cases with no result at all.
const vModel = (statuses, runStatus = 'failed', notRun = 0) => reportModel({ ...mkRun({ status: runStatus }), triage: {},
  cases: [...statuses.map((_, i) => c(`V-${i}`)), ...Array.from({ length: notRun }, (_, i) => c(`N-${i}`))],
  results: statuses.map((s, i) => ({ id: `V-${i}`, status: s, expected: 'e', actual: 'a', attachments: [] })) });

test('a cancelled, interrupted or error run is never a suggested Release', () => {
  for (const status of ['cancelled', 'interrupted', 'error']) {
    const v = suggestVerdict(vModel(Array(5).fill('PASS'), status, 995));
    assert.equal(v.value, 'needs-triage', status);
    assert.ok(v.reasons.some(r => r.includes(status) && /not every case/i.test(r)), `${status}: ${v.reasons.join(' | ')}`);
    assert.ok(v.reasons.join(' ').includes('suggestion'));
  }
  assert.equal(suggestVerdict(vModel(['PASS'], 'passed')).value, 'release');
});

test('a run where no counted case was executed needs triage', () => {
  for (const statuses of [['OBSERVED', 'SKIPPED'], ['SKIPPED'], ['OBSERVED']]) {
    const v = suggestVerdict(vModel(statuses, 'passed'));
    assert.equal(v.value, 'needs-triage', statuses.join());
    assert.ok(v.reasons.some(r => /no case was executed and verified/i.test(r)), v.reasons.join(' | '));
  }
  assert.equal(suggestVerdict(vModel([], 'passed', 3)).value, 'needs-triage');
});

test('a blocking failure in a cancelled run is still Do not release', () => {
  const m = reportModel({ ...mkRun({ status: 'cancelled' }), cases: [c('V-0')], results: [{ id: 'V-0', status: 'FAIL', expected: 'e', actual: 'a', attachments: [] }], triage: { 'V-0': { severity: 'Critical' } } });
  assert.equal(suggestVerdict(m).value, 'do-not-release');
});

test('a Release reason points to cases that were not executed or not verified', () => {
  const v = suggestVerdict(vModel(['PASS', 'PASS', 'OBSERVED'], 'passed', 2));
  assert.equal(v.value, 'release');
  assert.ok(v.reasons.some(r => r.includes('3 cases were not executed or not verified; see Not tested')), v.reasons.join(' | '));
  const clean = suggestVerdict(vModel(['PASS', 'PASS'], 'passed'));
  assert.ok(!clean.reasons.some(r => /not executed or not verified/.test(r)));
});

test('requirement filter matches any id of a multi-id requirement', () => {
  const m = { cases: [fr('R-1', { requirement: 'REQ-1, REQ-2;REQ-3\nREQ-4' }), fr('R-2', { requirement: 'REQ-30' }), fr('R-3', { requirement: '' })], findings: [] };
  assert.deepEqual(ids(applyFilter(m, { requirements: ['REQ-3'] })), ['R-1']);
  assert.deepEqual(ids(applyFilter(m, { requirements: ['req-4', 'REQ-30'] })), ['R-1', 'R-2']);
  assert.deepEqual(ids(applyFilter(m, { requirements: ['REQ-1, REQ-2'] })), []);
});

test('text filter dimensions compare case-insensitively', () => {
  assert.deepEqual(ids(applyFilter(filterModel(), { severities: ['high'] })), ['A-6']);
  assert.deepEqual(ids(applyFilter(filterModel(), { severities: ['NOT ASSESSED'] })), ['A-2']);
  assert.deepEqual(ids(applyFilter(filterModel(), { suites: ['rules'] })), ['A-3']);
  assert.deepEqual(ids(applyFilter(filterModel(), { owners: ['ba'] })), ['A-4']);
  assert.deepEqual(ids(applyFilter(filterModel(), { priorities: ['p2'] })), ['A-3']);
});

test('variants filter matches the case variant and is described', () => {
  const m = { cases: [fr('V-1', { variant: 'Adult' }), fr('V-2', { variant: 'Newborn' }), fr('V-3', { variant: '' })], findings: [] };
  assert.deepEqual(normalizeFilter({ variants: [' Adult ', 3] }), { variants: ['Adult'] });
  const r = applyFilter(m, { variants: ['adult', 'NEWBORN'] });
  assert.deepEqual(ids(r), ['V-1', 'V-2']);
  assert.equal(r.description, 'Variant: adult, NEWBORN');
  const model = reportModel({ ...mkRun(), cases: [c('V-1', { registrationType: 'Adult' }), c('V-2')], results: [], triage: {} });
  assert.deepEqual(ids(applyFilter(model, { variants: ['Adult'] })), ['V-1']);
});

test('normalizeFilter caps every list item at 200 characters', () => {
  const huge = 'x'.repeat(10 * 1024 * 1024);
  const n = normalizeFilter({ suites: [huge], requirements: [huge], owners: [huge], caseIds: [huge], variants: [huge] });
  for (const k of ['suites', 'requirements', 'owners', 'caseIds', 'variants']) assert.equal(n[k][0].length, 200, k);
});

test('newFailuresOnly in a pack uses the summary definition of a failure for the previous run', async t => {
  const { run, runDir } = packFixture(t);
  // P-3 was an execution issue before and is a failed assertion now: it is a new failure (the summary also counts it).
  const previous = mkRun({ id: 'rp-prev', cases: [c('P-2'), c('P-3')], results: [{ id: 'P-2', status: 'FAIL', attachments: [] }, { id: 'P-3', status: 'ERROR', attachments: [] }], triage: {} });
  const req = { reports: ['log'], filter: { newFailuresOnly: true }, evidence: 'none' };
  assert.equal(estimatePack(run, req, { runDir, previous }).cases, 1);
  const out = await buildPack({ run, runDir, previous, req, who: 'T', now: fixedNow });
  const wb = await rdr(openPack(out.file).get('03-Execution-Log.xlsx')());
  assert.equal(wb.getWorksheet('Results').getRow(2).getCell(1).value, 'P-3');
  assert.equal(estimatePack(run, req, { runDir, previous }).note, undefined);
});

test('newFailuresOnly without a previous run says every failure counts as new', async t => {
  const { run, runDir } = packFixture(t);
  const req = { reports: ['log'], filter: { newFailuresOnly: true }, evidence: 'none' };
  const est = estimatePack(run, req, { runDir });
  assert.equal(est.cases, 2);
  assert.equal(est.note, 'No previous run to compare with; every failure counts as new.');
  const out = await buildPack({ run, runDir, req, who: 'T', now: fixedNow });
  assert.match(openPack(out.file).get('00-README.txt')().toString('utf8'), /No previous run to compare with; every failure counts as new\./);
  assert.equal(estimatePack(run, { ...req, filter: {} }, { runDir }).note, undefined);
});

test('Markdown counts use plain words, not internal key names', () => {
  const { model, listing } = rendererFixture();
  const md = summaryMarkdown(buildSummary(model, listing));
  assert.match(md, /- Not executed: \d+/);
  assert.match(md, /- Assumed-rule failures: 1/);
  assert.match(md, /- Execution issues: 0/);
  assert.match(md, /- Total cases: 4/);
  assert.ok(!/- (unexecuted|assumptions|errors|recorded|total):/.test(md), md);
});

test('previousRun only compares runs of the same mode', () => {
  const r = (id, mode, at) => ({ id, kind: 'tests', mode, status: 'failed', module: { id: 'reg' }, environmentId: 'uat', createdAt: at, finishedAt: at });
  const runs = [r('a1', 'automated', '2026-11-01'), r('m1', 'manual', '2026-11-02'), r('a2', 'automated', '2026-11-03'), r('m2', 'manual', '2026-11-04'), r('a3', 'automated', '2026-11-05')];
  assert.equal(previousRun(runs, runs[4]).id, 'a2');
  assert.equal(previousRun(runs, runs[3]).id, 'm1');
  assert.equal(previousRun(runs, runs[1]), null);
});

// ---- Final fix wave: build queue, bounded stop, startup cleanup, fingerprint, files route ----
const tick = () => new Promise(resolve => setImmediate(resolve));
const BUSY = 'A report pack is already being built for this run. Wait for it to finish.';
// Jobs whose builds wait until the test releases them (builds[i].resolve()).
function heldJobs(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-queue-'));
  const runs = [mkRun({ id: 'q-run-1' }), mkRun({ id: 'q-run-2' })];
  const builds = [];
  const build = ({ run, req, onProgress }) => new Promise((resolve, reject) => {
    onProgress?.('Building...');
    builds.push({ runId: run.id, req, resolve: () => resolve({ file: path.join(dir, run.id, 'packs', 'x.zip'), size: 1, manifest: {} }), reject });
  });
  const jobs = createReportJobs({ store: { runs: () => runs, run: id => runs.find(r => r.id === id) }, dirFor: id => path.join(dir, id), build, ...options });
  t.after(async () => { // release every build, including queued ones that start while releasing
    for (let i = 0; i < 6; i++) { for (const b of builds) b.resolve(); await tick(); }
    await jobs.stop({ waitMs: 2000 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { jobs, runs, builds, dir };
}
const NONE = { ...LOG_ONLY, evidence: 'none' }, ALL = { ...LOG_ONLY, evidence: 'all' };

test('at most two packs build at once; a third waits as queued, is listed, and starts when one finishes', async t => {
  const { jobs, runs, builds } = heldJobs(t);
  const a = jobs.start(runs[0], LOG_ONLY, 'Ann', 'ann'), b = jobs.start(runs[0], NONE, 'Bob', 'bob'), c3 = jobs.start(runs[1], ALL, 'Cat', 'cat');
  await tick();
  assert.deepEqual([a.status, b.status, c3.status], ['running', 'running', 'queued']);
  assert.deepEqual(c3.progress, ['Waiting for another report to finish']);
  assert.equal(builds.length, 2);
  assert.equal(jobs.list('q-run-2').find(j => j.id === c3.id).status, 'queued');
  assert.equal(jobs.get('q-run-2', c3.id).status, 'queued');
  builds[1].resolve();
  await until(() => c3.status === 'running' && builds.length === 3);
  assert.equal(jobs.get('q-run-1', b.id).status, 'done');
  assert.equal(a.status, 'running', 'the first build is still going');
  assert.equal(builds[2].runId, 'q-run-2');
  builds[0].resolve(); builds[2].resolve();
  await until(() => a.status === 'done' && c3.status === 'done');
});

test('queued builds start in the order they were requested', async t => {
  const { jobs, runs, builds } = heldJobs(t, { maxRunning: 1 });
  const order = [jobs.start(runs[0], LOG_ONLY, 'A', 'a'), jobs.start(runs[0], NONE, 'B', 'b'), jobs.start(runs[0], ALL, 'C', 'c')];
  await tick();
  assert.deepEqual(order.map(j => j.status), ['running', 'queued', 'queued']);
  for (let i = 0; i < 3; i++) {
    await until(() => builds.length === i + 1);
    assert.equal(builds[i].req.evidence, order[i].request.evidence);
    builds[i].resolve();
  }
  await until(() => order.every(j => j.status === 'done'));
});

test('two identical requests while the first is still running return the same job id', async t => {
  const { jobs, runs, builds } = heldJobs(t);
  const a = jobs.start(runs[0], LOG_ONLY, 'Ann', 'ann');
  await tick();
  assert.equal(a.status, 'running');
  const again = jobs.start(runs[0], structuredClone(LOG_ONLY), 'Ann', 'ann'), other = jobs.start(runs[0], LOG_ONLY, 'Bob', 'bob');
  assert.equal(again.id, a.id); assert.equal(other.id, a.id);
  assert.equal(builds.length, 1, 'one build, and nothing was finished to reuse');
  assert.equal(jobs.list('q-run-1').length, 1);
});

test('one active pack per user and run: a different request is refused with 409', async t => {
  const { jobs, runs, builds } = heldJobs(t);
  const a = jobs.start(runs[0], LOG_ONLY, 'Ann', 'ann');
  assert.throws(() => jobs.start(runs[0], NONE, 'Ann', 'ann'), e => e.status === 409 && e.message === BUSY);
  assert.notEqual(jobs.start(runs[1], NONE, 'Ann', 'ann').id, a.id, 'another run is fine');
  const bob = jobs.start(runs[0], NONE, 'Bob', 'bob');
  assert.notEqual(bob.id, a.id, 'another user is fine');
  await tick();
  // A queued job counts as active too.
  const queued = jobs.start(runs[0], ALL, 'Cat', 'cat');
  assert.equal(queued.status, 'queued');
  assert.throws(() => jobs.start(runs[0], { ...LOG_ONLY, reports: ['bugs'] }, 'Cat', 'cat'), e => e.status === 409);
  builds[0].resolve();
  await until(() => a.status === 'done');
  const next = jobs.start(runs[0], { ...LOG_ONLY, reports: ['summary'] }, 'Ann', 'ann');
  assert.ok(next.id !== a.id && next.id !== queued.id, 'after it finished the user can build another');
});

test('stop waits at most the given time for a hung build', async t => {
  const dir = tempDir(t, 'pack-hung-'), runs = [mkRun({ id: 'h-run' })];
  const jobs = createReportJobs({ store: { runs: () => runs, run: id => runs.find(r => r.id === id) }, dirFor: id => path.join(dir, id), build: () => new Promise(() => {}) });
  const job = jobs.start(runs[0], LOG_ONLY, 'T', 't');
  await tick();
  assert.equal(job.status, 'running');
  const started = Date.now();
  await jobs.stop({ waitMs: 150 });
  assert.ok(Date.now() - started < 2000, `stop took ${Date.now() - started} ms`);
  // The abandoned record is still 'running' on disk; the next start turns it into an error.
  const again = createReportJobs({ store: { runs: () => runs, run: id => runs.find(r => r.id === id) }, dirFor: id => path.join(dir, id) });
  assert.equal(again.get('h-run', job.id).status, 'error');
});

test('startup removes partial pack files and work folders, keeps finished packs, and fails queued jobs', t => {
  const dir = tempDir(t, 'pack-clean-'), packs = path.join(dir, 'r1', 'packs');
  fs.mkdirSync(path.join(packs, '.tmp-0b1c', 'data'), { recursive: true });
  fs.writeFileSync(path.join(packs, '.tmp-0b1c', 'data', 'results.json'), '{}');
  fs.writeFileSync(path.join(packs, '.tmp-9f8e.zip'), 'partial');
  fs.writeFileSync(path.join(packs, 'registration_2026-11-14_run-r1_abcdef12.zip'), 'zip');
  fs.writeFileSync(path.join(packs, 'q-1.json'), JSON.stringify({ id: 'q-1', runId: 'r1', status: 'queued', startedAt: '2026-11-14T10:00:00.000Z', finishedAt: null, progress: ['Waiting for another report to finish'], request: LOG_ONLY }));
  const runs = [{ id: 'r1' }];
  const jobs = createReportJobs({ store: { runs: () => runs, run: id => runs.find(r => r.id === id) }, dirFor: id => path.join(dir, id) });
  assert.deepEqual(fs.readdirSync(packs).sort(), ['q-1.json', 'registration_2026-11-14_run-r1_abcdef12.zip']);
  const job = jobs.get('r1', 'q-1');
  assert.equal(job.status, 'error'); assert.match(job.error, /restarted/); assert.ok(job.finishedAt);
});

test('the pack fingerprint covers the pack format and the PDF renderer', t => {
  const { run } = packFixture(t);
  const req = { reports: ['log'], filter: {}, evidence: 'none' };
  const a = packFingerprint(run, req);
  assert.equal(PACK_FORMAT, 1);
  assert.match(rendererFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(a, packFingerprint(structuredClone(run), req));
  assert.equal(a, packFingerprint(run, req, { format: PACK_FORMAT, renderer: rendererFingerprint }));
  assert.notEqual(a, packFingerprint(run, req, { format: PACK_FORMAT + 1 }));
  assert.notEqual(a, packFingerprint(run, req, { renderer: 'another renderer' }));
});

test('the route answers 409 for a second different pack by the same user while one is building', async t => {
  const holds = [];
  const build = ({ onProgress }) => new Promise(resolve => { onProgress('Building...'); holds.push(resolve); });
  const { admin } = await jobWorld(t, { reportJobOptions: { build } });
  const a = await admin.request('/api/runs/rp-job-run/report-pack', 'POST', LOG_ONLY);
  assert.equal(a.status, 202, JSON.stringify(a.value));
  assert.equal((await admin.request('/api/runs/rp-job-run/report-pack', 'POST', LOG_ONLY)).value.id, a.value.id);
  const b = await admin.request('/api/runs/rp-job-run/report-pack', 'POST', NONE);
  assert.equal(b.status, 409); assert.equal(b.value.error, BUSY);
  assert.equal((await admin.request('/api/runs/rp-job-run/report-packs')).value.length, 1);
  await until(() => holds.length === 1);
  holds[0]({ file: 'gone.zip', size: 0, manifest: {} });
  assert.equal((await finished(admin, 'rp-job-run', a.value.id)).status, 'done');
  assert.equal((await admin.request('/api/runs/rp-job-run/report-pack', 'POST', NONE)).status, 202);
  await until(() => holds.length === 2);
  holds[1]({ file: 'gone.zip', size: 0, manifest: {} });
});

test('the run files route never serves anything under packs/', async t => {
  const { admin, runDir } = await jobWorld(t);
  fs.mkdirSync(path.join(runDir, 'packs'), { recursive: true }); fs.mkdirSync(path.join(runDir, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'packs', 'job-1.json'), JSON.stringify({ result: { file: 'C:/server/path.zip' } }));
  fs.writeFileSync(path.join(runDir, 'packs', '.tmp-1.zip'), 'partial');
  fs.writeFileSync(path.join(runDir, 'artifacts', 'ok.json'), '{}');
  assert.equal((await admin.request('/api/runs/rp-job-run/files/artifacts/ok.json')).status, 200);
  for (const p of ['packs/job-1.json', 'packs/.tmp-1.zip', 'packs%2Fjob-1.json', 'artifacts%2F..%2Fpacks%2Fjob-1.json', 'PACKS/job-1.json', './packs/job-1.json',
    // NTFS stream-syntax aliases of the packs folder (Windows): the same directory under another spelling.
    'packs::$INDEX_ALLOCATION/job-1.json', 'packs:$I30:$INDEX_ALLOCATION/job-1.json', 'artifacts/..%5Cpacks%5Cjob-1.json']) {
    const r = await admin.request(`/api/runs/rp-job-run/files/${p}`);
    assert.ok([403, 404].includes(r.status), `${p}: ${r.status}`);
  }
});

// ---- Final fix wave: bug files agree, can reproduce a bug, dialog helpers, xlsx export ----
import { bugReportOrder } from '../reports/pack.mjs';

// Every finding kind: P-2 quarantined failure, P-3 failure, P-4 assumed-rule failure, P-5 execution issue, P-6 blocked.
const allKinds = () => {
  const run = mkRun();
  run.cases.push(c('P-4'), c('P-5'), c('P-6'));
  run.results.push({ id: 'P-4', status: 'FAIL (assumed requirement)', expected: 'e4', actual: 'a4', attachments: [] },
    { id: 'P-5', status: 'ERROR', expected: 'e5', actual: 'runner timed out', attachments: [] }, { id: 'P-6', status: 'BLOCKED', expected: 'e6', actual: 'no data', attachments: [] });
  run.results[2].resolvedInput = { mobile: '=1+1', password: 'hunter2', firstName: 'Asha' };
  return run;
};

test('the Jira CSV holds only failed assertions and business-rule reviews, like the defect register', async () => {
  const model = reportModel(redactRun(allKinds())), listing = applyFilter(model, {});
  const rows = parseCsv(jiraCsv(model, listing));
  assert.deepEqual(rows.slice(1).map(r => r[0].slice(0, 5)), ['[P-3]', '[P-4]']);
  assert.deepEqual(rows.slice(1).map(r => r[5]), ['Bug', 'Task']);
  const wb = await rdr(await defectWorkbook(model, listing));
  const ids = s => { const o = []; wb.getWorksheet(s).eachRow((r, i) => { if (i > 1) o.push(r.getCell(2).value); }); return o; };
  assert.deepEqual([...ids('Bugs'), ...ids('Needs review')].filter(id => id !== 'P-2'), ['P-3', 'P-4']);
});

test('the Jira CSV description lists the captured inputs after the steps, redacted and neutralized', () => {
  const model = reportModel(allKinds()), listing = applyFilter(model, {});
  const f = model.findings.find(x => x.caseId === 'P-3');
  const desc = parseCsv(jiraCsv(model, listing))[1][1];
  assert.ok(desc.indexOf('Steps:') < desc.indexOf('Inputs:') && desc.indexOf('Inputs:') < desc.indexOf('Expected:'), desc);
  for (const { key, value } of f.input) assert.ok(desc.includes(`- ${key}: ${value}`), `${key} in ${desc}`);
  assert.ok(desc.includes(': [REDACTED]')); assert.ok(!desc.includes('hunter2'));
  assert.ok(desc.includes(': =1+1'), 'inside the cell the value is plain text; the cell itself does not start with a formula');
  assert.ok(!/^[=+\-@]/.test(desc));
});

test('the defect register has Inputs and Evidence columns; evidence links go through the allowlist', async () => {
  const model = reportModel(allKinds()), listing = applyFilter(model, {});
  const wb = await rdr(await defectWorkbook(model, listing, { evidenceLinks: { 'P-3': 'evidence/P-3/1-final.png', 'P-4': 'javascript:alert(1)' } }));
  const bugs = wb.getWorksheet('Bugs'), review = wb.getWorksheet('Needs review');
  const header = bugs.getRow(1).values.slice(1), col = name => header.indexOf(name) + 1;
  assert.ok(col('Inputs') > 0 && col('Evidence') > 0, header.join());
  let p3 = null; bugs.eachRow((r, i) => { if (i > 1 && r.getCell(2).value === 'P-3') p3 = r; });
  assert.equal(p3.getCell(col('Evidence')).value.hyperlink, 'evidence/P-3/1-final.png');
  const inputs = String(p3.getCell(col('Inputs')).value);
  assert.match(inputs, /: =1\+1/); assert.match(inputs, /: \[REDACTED\]/); assert.ok(!inputs.includes('hunter2'));
  const p4 = review.getRow(2).getCell(col('Evidence')).value;
  assert.equal(typeof p4, 'string'); assert.ok(!(p4 && p4.hyperlink));
  wb.eachSheet(s => s.eachRow(r => r.eachCell(cl => { if (typeof cl.value === 'string') assert.ok(!/^[=+\-@\t\r]/.test(cl.value), cl.value); })));
  assert.equal(String(review.getRow(2).getCell(1).value), 'RULE-P-4');
  const none = await rdr(await defectWorkbook(model, listing));
  assert.equal(none.getWorksheet('Bugs').getRow(2).getCell(col('Evidence')).value ?? '', '');
});

test('the bugs PDF lists findings by kind: failures, assumed rules, execution issues, then blocked', () => {
  const f = (caseId, kind) => ({ caseId, kind });
  const order = bugReportOrder([f('X-10', 'execution'), f('X-2', 'failure'), f('X-1', 'blocked'), f('X-3', 'assumption'), f('X-1', 'failure'), f('X-10', 'failure'), f('X-0', 'execution')]);
  assert.deepEqual(order.map(x => `${x.kind}:${x.caseId}`), ['failure:X-1', 'failure:X-2', 'failure:X-10', 'assumption:X-3', 'execution:X-0', 'execution:X-10', 'blocked:X-1']);
});

test('a bugs pack groups the PDF by kind and links evidence in 02-Bugs.xlsx', { skip: pdfSkip }, async t => {
  const runDir = tempDir(t, 'pack-bugs-');
  fs.mkdirSync(path.join(runDir, 'artifacts'));
  fs.writeFileSync(path.join(runDir, 'artifacts', 'f.png'), makePng(8, 8, [200, 30, 30]));
  const run = mkRun({ id: 'rp-bugs-1', triage: {}, cases: [c('K-1', { title: 'Blocked first' }), c('K-2', { title: 'Execution second' }), c('K-3', { title: 'Rule third' }), c('K-4', { title: 'Failure fourth' })],
    results: [{ id: 'K-1', status: 'BLOCKED', expected: 'e', actual: 'a', attachments: [] }, { id: 'K-2', status: 'ERROR', expected: 'e', actual: 'a', attachments: [] },
      { id: 'K-3', status: 'FAIL (assumed requirement)', expected: 'e', actual: 'a', attachments: [] }, { id: 'K-4', status: 'FAIL', expected: 'e', actual: 'a', attachments: [{ name: 'Final result', path: 'artifacts/f.png', contentType: 'image/png' }] }] });
  const out = await buildPack({ run, runDir, req: { reports: ['bugs'], filter: {}, evidence: 'findings' }, who: 'T', now: fixedNow });
  const zip = openPack(out.file);
  const pdf = path.join(runDir, 'bugs.pdf'); fs.writeFileSync(pdf, zip.get('02-Bug-Report.pdf')());
  const o = spawnSync(py, ['-I', '-c', 'import sys, pypdf\nprint("\\n".join(p.extract_text() for p in pypdf.PdfReader(sys.argv[1]).pages))', pdf], { encoding: 'utf8' });
  assert.equal(o.status, 0, o.stderr);
  const text = o.stdout.replace(/\s+/g, ' ');
  const at = title => text.indexOf(title);
  for (const title of ['Failure fourth', 'Rule third', 'Execution second', 'Blocked first']) assert.ok(at(title) >= 0, title);
  assert.ok(at('Failure fourth') < at('Rule third') && at('Rule third') < at('Execution second') && at('Execution second') < at('Blocked first'), text.slice(0, 600));
  const wb = await rdr(zip.get('02-Bugs.xlsx')());
  const bugs = wb.getWorksheet('Bugs'), header = bugs.getRow(1).values.slice(1);
  const link = bugs.getRow(2).getCell(header.indexOf('Evidence') + 1).value?.hyperlink;
  assert.equal(link, 'evidence/K-4/1-final-result.png');
  assert.ok(zip.has(link));
  assert.match(zip.get('00-README.txt')().toString('utf8'), /02-Bugs-for-Jira\.csv: Failed assertions and business-rule reviews/);
});

test('QUICK_FILTERS are the server presets, validate, and only use filters the dialog can show', async () => {
  const { QUICK_FILTERS, buildPackRequest } = await packUi();
  assert.deepEqual(QUICK_FILTERS.map(q => q.key), Object.keys(PRESETS));
  assert.deepEqual(QUICK_FILTERS.map(q => q.label), ['Bugs only', 'Failures and blocked', 'Needs triage', 'P0 and P1', 'Everything']);
  for (const q of QUICK_FILTERS) {
    assert.deepEqual(q.filter, PRESETS[q.key].filter, q.key);
    assert.deepEqual(normalizeFilter(q.filter), q.filter, q.key);
    const body = buildPackRequest({ preset: 'custom', reports: ['log'], evidence: 'none', filter: q.filter });
    assert.deepEqual(normalizeRequest(body), body, q.key);
    assert.deepEqual(body.filter, q.filter, q.key);
    for (const k of Object.keys(q.filter)) assert.ok(['classes', 'priorities', 'suites', 'requirements', 'severities', 'text'].includes(k), `${q.key}: ${k} has no control in the dialog`);
  }
});

test('the dialog treats queued and running jobs as pending and labels every job status', async () => {
  const { jobPhase, jobStatusText, PACK_CLASSES } = await packUi();
  assert.equal(jobPhase('queued'), 'pending'); assert.equal(jobPhase('running'), 'pending');
  assert.equal(jobPhase('done'), 'done'); assert.equal(jobPhase('error'), 'failed'); assert.equal(jobPhase(undefined), 'failed');
  assert.equal(jobStatusText({ status: 'queued' }), 'Waiting for another report to finish');
  assert.equal(jobStatusText({ status: 'running' }), 'Building');
  assert.equal(jobStatusText({ status: 'error', error: 'Boom' }), 'Failed: Boom');
  assert.equal(jobStatusText({ status: 'error' }), 'Failed');
  assert.equal(jobStatusText({ status: 'done' }), 'Ready');
  assert.equal(PACK_CLASSES.find(([k]) => k === 'execution')[1], 'Execution issue');
});

test('the Excel export of a run stores formula-like text as text', async t => {
  const f = await boot(t);
  const run = mkRun({ id: 'rp-xlsx-1' });
  run.cases[0].title = '=HYPERLINK("http://evil.test","x")'; run.cases[0].category = '+cmd';
  run.results[0].actual = '@SUM(A1)'; run.triage = { 'P-1': { owner: '-2+3' } };
  f.store.saveRun(run);
  const x = await f.request('/api/runs/rp-xlsx-1/export?format=xlsx');
  assert.equal(x.status, 200);
  const ws = (await rdr(x.value)).getWorksheet('Results');
  assert.deepEqual(ws.getRow(1).values.slice(1, 4), ['id', 'title', 'status'], 'layout unchanged');
  const row = ws.getRow(2);
  assert.equal(row.getCell(2).value, `'=HYPERLINK("http://evil.test","x")`);
  ws.eachRow(r => r.eachCell(cl => {
    assert.equal(cl.formula, undefined);
    if (typeof cl.value === 'string') assert.ok(!/^[=+\-@\t\r]/.test(cl.value), cl.value);
  }));
  assert.equal(typeof row.getCell(9).value, 'number', 'durationMs stays a number');
});
