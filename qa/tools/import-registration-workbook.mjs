// Preserve the supplied business scenarios as manual procedures: the existing
// browser adapter cannot execute their configuration and integration checks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { ROOT, validateCase } from '../../portal/registry.mjs';
import { openStore } from '../../portal/store.mjs';

export async function readRegistrationWorkbook(filename) {
  const workbook = await new ExcelJS.Workbook().xlsx.readFile(filename);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.getRow(3).getCell(2).text.trim() !== 'Test Case ID') {
    throw new Error('Expected the supplied registration workbook layout (headers in row 3).');
  }
  const priorities = { Critical: 'P0', High: 'P1', Medium: 'P2', Low: 'P3' };
  let section = '';
  const cases = [];
  sheet.eachRow((row, rowNumber) => {
    const text = column => row.getCell(column).text.trim();
    if (text(1).includes('▶')) section = text(1).replace(/^.*▶\s*/, '').trim();
    if (!/^TC_REG_\d{3}$/.test(text(2))) return;
    if (!priorities[text(8)] || !section) throw new Error(`Invalid priority or section in row ${rowNumber}.`);
    cases.push(validateCase({
      id: text(2), title: text(5), category: section,
      priority: priorities[text(8)], mode: 'manual', enabled: true,
      notes: `Source: ${path.basename(filename)}, ${sheet.name}, row ${rowNumber}. Module: ${text(3)}. Feature: ${text(4)}. Test type: ${text(9)}. Source status: ${text(10)}. Manual execution required; this procedure is not connected to browser automation.`,
      preconditions: '', requirement: '',
      // Keep the complete ordered procedure with its original overall outcome.
      // Intermediate expected results were not specified by the source.
      steps: [{ action: text(6), expected: text(7) }],
    }, { adapter: 'registration' }));
  });
  if (cases.length !== 80 || new Set(cases.map(c => c.id)).size !== 80) {
    throw new Error('Expected 80 unique registration scenarios; no cases were imported.');
  }
  return { module: 'registration', source: path.basename(filename), cases };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || path.join(ROOT, 'Registration_Test_Cases 1.xlsx'));
  const document = await readRegistrationWorkbook(source);
  const output = path.join(ROOT, 'qa/modules/registration/cases/registration-business-cases.json');
  fs.writeFileSync(output, JSON.stringify(document, null, 2) + '\n');
  if (process.argv.includes('--import')) {
    const store = openStore(path.resolve(process.env.PORTAL_DATA_DIR || path.join(ROOT, '.portal')));
    try {
      if (!store.module('registration')) throw new Error('Registration module is missing.');
      let added = 0;
      store.transaction(() => {
        for (const c of document.cases) {
          if (store.case('registration', c.id)) continue;
          store.saveCase('registration', c); added++;
        }
      });
      console.log(`Imported ${added} new manual cases; preserved ${80 - added} existing IDs. Registration total: ${store.cases('registration').length}.`);
    } finally { store.close(); }
  }
  console.log(`Validated ${document.cases.length} cases. Saved ${output}`);
}
