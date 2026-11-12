#!/usr/bin/env node
// Convert registration test cases between JSON (source of truth in git) and Excel (for the BA team).
//
//   node qa/tools/cases-io.js to-xlsx   qa/modules/registration/cases/registration-cases.json  out.xlsx
//   node qa/tools/cases-io.js from-xlsx in.xlsx  qa/modules/registration/cases/from-excel.json
//
// Excel layout (sheet "cases"): one row per case.
//   id | title | category | priority | variant |   (legacy header registrationType is also accepted on import) action | enabled | notes |
//   in.<fieldKey> ...           (values to type/select, e.g. in.first_name, in.pin_code)
//   exp.outcome | exp.toastContains | exp.fieldErrors | exp.values | exp.persisted | exp.note
//   (exp.fieldErrors / exp.values / exp.persisted are "key=value; key=value" lists)

const ExcelJS = require('exceljs');
const fs = require('fs');

const BASE_COLS = ['id', 'title', 'category', 'priority', 'variant', 'action', 'base', 'target', 'enabled', 'notes', 'mode', 'preconditions', 'requirement', 'steps', 'sourceWorkbook', 'automationReadiness', 'automationBlocker', 'executionAdaptation'];
const EXP_SCALAR = ['outcome', 'toastContains', 'saveDisabled', 'assumed', 'note'];
const EXP_MAP = ['fieldErrors', 'values', 'persisted', 'hints'];

const toPairs = (obj) => Object.entries(obj || {}).map(([k, v]) => `${k}=${v}`).join('; ');
const fromPairs = (s) =>
  String(s || '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .reduce((acc, p) => {
      const i = p.indexOf('=');
      if (i > 0) acc[p.slice(0, i).trim()] = p.slice(i + 1).trim();
      return acc;
    }, {});

function loadJson(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(doc) ? doc : doc.cases;
}

async function toXlsx(cases, out) {
  const inputKeys = [...new Set(cases.flatMap((c) => Object.keys(c.input || {})))];
  const cols = [...BASE_COLS, ...inputKeys.map((k) => `in.${k}`), ...[...EXP_SCALAR, ...EXP_MAP].map((k) => `exp.${k}`)];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('cases', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c, key: c, width: c === 'title' ? 50 : c.startsWith('exp.') ? 36 : 18 }));
  for (const c of cases) {
    const row = { enabled: c.enabled === false ? 'no' : 'yes' };
    BASE_COLS.forEach((k) => k !== 'enabled' && (row[k] = k === 'steps' ? JSON.stringify(c.steps ?? []) : k === 'variant' ? c.registrationType ?? c.variant ?? '' : c[k] ?? ''));
    inputKeys.forEach((k) => (row[`in.${k}`] = c.input?.[k] === '' ? '<EMPTY>' : c.input?.[k] ?? ''));
    EXP_SCALAR.forEach((k) => (row[`exp.${k}`] = c.expected?.[k] ?? ''));
    EXP_MAP.forEach((k) => (row[`exp.${k}`] = toPairs(c.expected?.[k])));
    ws.addRow(row);
  }
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
  await wb.xlsx.writeFile(out);
}

async function fromXlsx(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('cases') || wb.worksheets[0];
  const headers = ws.getRow(1).values.slice(1).map((h) => String(h ?? '').trim());
  const cases = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const cell = (h) => {
      if (!headers.includes(h)) return '';
      const v = row.getCell(headers.indexOf(h) + 1).value;
      if (v === null || v === undefined) return '';
      return typeof v === 'object' && 'text' in v ? String(v.text) : String(v);
    };
    if (!cell('id')) return;
    const c = { input: {}, expected: {} };
    BASE_COLS.forEach((k) => {
      if (k === 'enabled') return;
      // The case field stays `registrationType`; the sheet header is the neutral `variant` (legacy `registrationType` still imports).
      const v = k === 'variant' ? cell('variant') || cell('registrationType') : cell(k);
      if (v) c[k === 'variant' ? 'registrationType' : k] = v;
    });
    if (c.steps) {
      try { c.steps = JSON.parse(c.steps); } catch { throw new Error(`Invalid steps JSON in Excel row ${n}.`); }
    }
    c.enabled = !/^(no|false|0)$/i.test(cell('enabled'));
    headers.filter((h) => h.startsWith('in.')).forEach((h) => {
      // Blank cells preserve the historical "not supplied" behavior; <EMPTY> explicitly clears a base value.
      const v = cell(h);
      if (v !== '') c.input[h.slice(3)] = v === '<EMPTY>' ? '' : /^(true|false)$/i.test(v) ? v.toLowerCase() === 'true' : v;
    });
    EXP_SCALAR.forEach((k) => {
      const v = cell(`exp.${k}`);
      if (v) c.expected[k] = /^(true|false)$/i.test(v) ? v.toLowerCase() === 'true' : v;
    });
    EXP_MAP.forEach((k) => {
      const m = fromPairs(cell(`exp.${k}`));
      if (Object.keys(m).length) c.expected[k] = m;
    });
    cases.push(c);
  });
  return cases;
}

/** Load cases from .json or .xlsx (used by the Playwright spec). */
async function loadCases(file) {
  return /\.xlsx$/i.test(file) ? fromXlsx(file) : loadJson(file);
}

module.exports = { loadCases, toXlsx, fromXlsx };

if (require.main === module) {
  const [cmd, src, out] = process.argv.slice(2);
  (async () => {
    if (cmd === 'to-xlsx') {
      await toXlsx(loadJson(src), out);
      console.log(`wrote ${out}`);
    } else if (cmd === 'print-xlsx') {
      process.stdout.write(JSON.stringify(await fromXlsx(src)));
    } else if (cmd === 'from-xlsx') {
      fs.writeFileSync(out, JSON.stringify({ cases: await fromXlsx(src) }, null, 2));
      console.log(`wrote ${out}`);
    } else {
      console.log('usage: cases-io.js to-xlsx <cases.json> <out.xlsx> | from-xlsx <in.xlsx> <out.json>');
      process.exit(1);
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
