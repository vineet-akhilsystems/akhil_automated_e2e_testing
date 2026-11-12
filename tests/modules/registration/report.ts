import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import type { CaseResult } from './case-runner';

const COLORS: Record<string, string> = {
  PASS: 'FFC6EFCE',
  FAIL: 'FFFFC7CE',
  'FAIL (assumed requirement)': 'FFFFEB9C',
  OBSERVED: 'FFDDEBF7',
  SKIPPED: 'FFEDEDED',
  ERROR: 'FFF4B183',
  BLOCKED: 'FFFFEB9C',
};

/** Write results.json, results.xlsx (Expected vs Actual) and summary.md; returns the run folder. */
export async function writeReport(results: CaseResult[], casesFile: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = process.env.PORTAL_REPORT_DIR ?? path.join('qa/modules/registration/results', stamp);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ casesFile, runAt: new Date().toISOString(), results }, null, 2));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Expected vs Actual', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  ws.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Priority', key: 'priority', width: 8 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Test case', key: 'title', width: 55 },
    { header: 'Expected', key: 'expected', width: 55 },
    { header: 'Actual', key: 'actual', width: 70 },
    { header: 'Mismatches', key: 'mismatches', width: 60 },
    { header: 'UHID', key: 'registrationId', width: 18 },
    { header: 'Note', key: 'note', width: 50 },
    { header: 'Seconds', key: 'sec', width: 8 },
  ];
  for (const r of results) {
    const row = ws.addRow({ ...r, mismatches: r.mismatches.join('\n'), sec: Math.round(r.durationMs / 1000) });
    row.alignment = { wrapText: true, vertical: 'top' };
    row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS[r.status] ?? 'FFFFFFFF' } };
  }
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };
  await wb.xlsx.writeFile(path.join(dir, 'results.xlsx'));

  const count = (s: string) => results.filter((r) => r.status === s).length;
  const lines = [
    `# Registration run ${stamp}`,
    '',
    `Cases: ${results.length} | PASS ${count('PASS')} | FAIL ${count('FAIL')} | FAIL (assumed) ${count('FAIL (assumed requirement)')} | OBSERVED ${count('OBSERVED')} | ERROR ${count('ERROR')} | BLOCKED ${count('BLOCKED')} | SKIPPED ${count('SKIPPED')}`,
    '',
    '| ID | Status | Test case | Expected | Actual |',
    '|---|---|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${r.status} | ${r.title} | ${r.expected.replace(/\|/g, '/')} | ${r.actual.replace(/\|/g, '/').slice(0, 300)} |`),
  ];
  fs.writeFileSync(path.join(dir, 'summary.md'), lines.join('\n'));
  if (!process.env.PORTAL_REPORT_DIR) {
    for (const f of ['results.json', 'results.xlsx', 'summary.md']) {
      fs.copyFileSync(path.join(dir, f), path.join('qa/modules/registration/results', `latest-${f}`));
    }
  }
  return dir;
}
