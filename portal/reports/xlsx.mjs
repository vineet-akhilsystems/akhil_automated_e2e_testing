// Pure workbook builders. Every free-text cell goes through safeCell; numbers and fixed labels are written as-is.
import { createRequire } from 'node:module';
import { safeCell } from './csv.mjs';
import { VERDICT_LABEL } from './markdown.mjs';
import { FINDINGS } from '../quality.mjs';

const ExcelJS = createRequire(import.meta.url)('exceljs');
const UNSAFE_LINK = /^\s*(javascript|data|vbscript):/i;

function sheet(wb, name, headers, rows, widths = []) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  headers.forEach((_, i) => { ws.getColumn(i + 1).width = widths[i] ?? 18; });
  return ws;
}

const steps = f => (f.steps ?? []).map((s, i) => `${i + 1}. ${s.action}${s.expected ? ` (expect: ${s.expected})` : ''}`).join('\n');
const buffer = async wb => Buffer.from(await wb.xlsx.writeBuffer());

export async function executionLogWorkbook(model, listing, ctx = {}) {
  const wb = new ExcelJS.Workbook();
  const links = ctx.evidenceLinks ?? {};
  const summary = ctx.summary;
  const ws = wb.addWorksheet('Summary');
  ws.getColumn(1).width = 28; ws.getColumn(2).width = 90;
  const add = (k, v = '') => ws.addRow([k, typeof v === 'number' ? v : safeCell(v)]);
  add(model.title).font = { bold: true, size: 14 };
  if (summary) {
    add(`Suggested verdict: ${VERDICT_LABEL[summary.verdict.value] ?? summary.verdict.value}`).font = { bold: true };
    add('Not tested', summary.notTested.length ? summary.notTested.join('; ') : 'none recorded');
    for (const r of summary.verdict.reasons) add('', r);
  }
  add('Run', `${model.run.name} (${model.run.id})`); add('Module', model.run.module); add('Environment', model.run.environment);
  if (listing.active) add('Filter', `Showing ${listing.shown} of ${listing.total} cases. Filter: ${listing.description}`);
  add('Totals (whole run, unfiltered)');
  for (const [k, v] of Object.entries(model.totalsByClass ?? {})) add(k, v);
  add('Note', model.scopeNote);

  const cls = r => (r.findingKind ? FINDINGS[r.findingKind].label : r.rawStatus);
  const results = sheet(wb, 'Results',
    ['Case', 'Title', 'Suite', 'Priority', 'Requirement', 'Status', 'Class', 'Severity', 'Owner', 'Ticket', 'Attempts', 'Flaky', 'Quarantined', 'Duration (s)', 'Evidence count', 'Evidence link'],
    listing.cases.map(r => [safeCell(r.id), safeCell(r.title), safeCell(r.suite), safeCell(r.priority), safeCell(r.requirement), safeCell(r.status), safeCell(cls(r)), safeCell(r.severity), safeCell(r.owner), safeCell(r.ticketUrl),
      r.attempts, r.flaky ? 'Yes' : 'No', r.quarantined ? 'Yes' : 'No', Math.round((r.durationMs ?? 0) / 100) / 10, r.screenshotCount ?? 0, '']),
    [12, 40, 16, 9, 16, 18, 20, 12, 14, 24, 9, 8, 12, 12, 14, 18]);
  listing.cases.forEach((r, i) => {
    const link = links[r.id];
    if (typeof link === 'string' && link && !UNSAFE_LINK.test(link)) results.getRow(i + 2).getCell(16).value = { text: 'Open evidence', hyperlink: link };
  });

  sheet(wb, 'Findings', ['Finding', 'Case', 'Classification', 'Title', 'Priority', 'Severity', 'Owner', 'Reference', 'Ticket', 'Quarantined', 'Expected', 'Actual'],
    listing.findings.map(f => [safeCell(f.id), safeCell(f.caseId), safeCell(f.classification), safeCell(f.title), safeCell(f.priority), safeCell(f.severity), safeCell(f.owner), safeCell(f.reference), safeCell(f.ticketUrl), f.quarantined ? 'Yes' : 'No', safeCell(f.expected), safeCell(f.actual)]),
    [14, 12, 20, 40, 9, 12, 14, 14, 24, 12, 40, 40]);

  sheet(wb, 'Not executed', ['Case', 'Title', 'Suite', 'Priority', 'Requirement', 'Status'],
    listing.cases.filter(r => !r.executed).map(r => [safeCell(r.id), safeCell(r.title), safeCell(r.suite), safeCell(r.priority), safeCell(r.requirement), safeCell(r.status)]),
    [12, 40, 16, 9, 16, 18]);
  return buffer(wb);
}

export async function defectWorkbook(model, listing) {
  const wb = new ExcelJS.Workbook();
  const headers = ['Finding', 'Case', 'Title', 'Suite', 'Priority', 'Severity', 'Owner', 'Reference', 'Ticket', 'Quarantined', 'Requirement', 'Steps', 'Expected', 'Actual', 'Mismatches'];
  const rowOf = f => [safeCell(f.id), safeCell(f.caseId), safeCell(f.title), safeCell(f.suite), safeCell(f.priority), safeCell(f.severity), safeCell(f.owner), safeCell(f.reference), safeCell(f.ticketUrl), f.quarantined ? 'Yes' : 'No',
    safeCell(f.requirement), safeCell(steps(f)), safeCell(f.expected), safeCell(f.actual), safeCell((f.mismatches ?? []).join('\n'))];
  const widths = [14, 12, 40, 16, 9, 12, 14, 14, 24, 12, 16, 50, 40, 40, 40];
  const bugs = [], review = [];
  for (const f of listing.findings) { if (f.kind === 'failure') bugs.push(rowOf(f)); else if (f.kind === 'assumption') review.push(rowOf(f)); }
  for (const [name, rows] of [['Bugs', bugs], ['Needs review', review]]) {
    const ws = sheet(wb, name, headers, rows, widths);
    ws.getColumn(12).alignment = ws.getColumn(15).alignment = { wrapText: true, vertical: 'top' };
  }
  return buffer(wb);
}
