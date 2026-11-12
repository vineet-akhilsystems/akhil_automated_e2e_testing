#!/usr/bin/env node
// Validate registration cases before running them.
//
//   node .claude/skills/designing-registration-cases/validate-cases.mjs [cases.json|cases.xlsx] [--ids REG-001,REG-002]
//
// Errors (exit 1): the portal's validateCase rules (portal/registry.mjs), duplicate ids, unknown
// requirement ids, unknown tokens, {{x@REF}} pointing at a missing / later / disabled case.
// Warnings: patterns that make a case flaky or misleading (hard-coded phones, digits in names, ...).
// Reads files only; never runs the browser or touches the database.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MASTER = path.join(ROOT, 'qa/modules/registration/cases/registration-cases.json');
const { validateCase, adapters } = await import(pathToFileURL(path.join(ROOT, 'portal/registry.mjs')).href);

const args = process.argv.slice(2);
const idsAt = args.indexOf('--ids');
const only = idsAt >= 0 ? new Set(String(args[idsAt + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)) : null;
const fileArg = args.find((a, i) => !a.startsWith('--') && !(idsAt >= 0 && i === idsAt + 1));
const file = fileArg ? path.resolve(fileArg) : MASTER;

const master = JSON.parse(fs.readFileSync(MASTER, 'utf8'));
const cases = /\.xlsx$/i.test(file)
  ? JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'qa/tools/cases-io.js'), 'print-xlsx', file], { cwd: ROOT }).toString())
  : (JSON.parse(fs.readFileSync(file, 'utf8')).cases ?? []);
const requirementIds = new Set((master.requirements ?? []).map(r => r.id));
const module = { adapter: 'registration', config: { bases: master.bases ?? {} } };
const PLAIN_TOKENS = new Set(['seq', 'seqWord', 'phone', 'phone2', 'today', 'first', 'second']);
const REF_TOKENS = new Set(['regId', 'phone']);
const NAME_FIELDS = ['first_name', 'middle_name', 'last_name', 'mother_name', 'father_name', 'emergency_name'];
const PHONE_FIELDS = ['mobile', 'whatsapp', 'emergency_mobile', 'emergency_alternate'];

const errors = [];
const warnings = [];
const seen = new Map();
cases.forEach((c, i) => { if (c?.id && !seen.has(c.id)) seen.set(c.id, i); });

cases.forEach((c, index) => {
  const id = c?.id ?? `<row ${index + 1}>`;
  if (only && !only.has(id)) return;
  const err = m => errors.push(`${id}: ${m}`);
  const warn = m => warnings.push(`${id}: ${m}`);

  if (seen.get(id) !== index) err(`duplicate id (first used at position ${seen.get(id) + 1})`);
  if (!/^REG-\d{3,}$/.test(id) && !/^TC_REG_\d+$/.test(id)) warn('id does not follow REG-nnn');

  try { validateCase(structuredClone(c), module); } catch (e) { err(e.message); }

  for (const r of String(c.requirement ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    if (!requirementIds.has(r)) err(`requirement ${r} is not in the requirements list`);
  }
  if (!c.requirement && c.mode !== 'manual') warn('no requirement link (coverage view cannot count it)');

  const text = JSON.stringify({ input: c.input, expected: c.expected, target: c.target });
  for (const [, name, ref] of text.matchAll(/\{\{(\w+)(?:@([\w-]+))?\}\}/g)) {
    if (!ref) {
      if (!PLAIN_TOKENS.has(name)) err(`unknown token {{${name}}}`);
      continue;
    }
    if (!REF_TOKENS.has(name)) err(`{{${name}@${ref}}}: only regId and phone are shared between cases`);
    if (!seen.has(ref)) err(`{{${name}@${ref}}}: case ${ref} does not exist`);
    else if (seen.get(ref) > index) err(`{{${name}@${ref}}}: ${ref} must come earlier in the file (cases run in file order)`);
    else if (cases[seen.get(ref)].enabled === false) err(`{{${name}@${ref}}}: ${ref} is disabled, so it never produces a value`);
    else if (!['save', 'saveTwice'].includes(cases[seen.get(ref)].action) || cases[seen.get(ref)].expected?.outcome !== 'created') {
      warn(`{{${name}@${ref}}}: ${ref} is not a save expected to be "created"; it may not produce ${name}`);
    }
  }
  if (/\{\{(first|second)\}\}/.test(JSON.stringify(c.expected ?? {}))) err('{{first}}/{{second}} are resolved only in input, not in expected');

  const input = { ...(c.base ? master.bases?.[c.base] ?? {} : {}), ...(c.input ?? {}) };
  const savesNew = ['save', 'saveTwice', 'saveDoubleClick'].includes(c.action);
  for (const k of PHONE_FIELDS) {
    if (savesNew && c.expected?.outcome?.startsWith('created') && /^\d{10}$/.test(String(input[k] ?? ''))) {
      warn(`${k} is a fixed number in a create case; use {{phone}}/{{phone2}} so reruns do not hit duplicate rules`);
    }
  }
  for (const k of NAME_FIELDS) {
    if (/\d/.test(String(c.input?.[k] ?? '').replace(/\{\{[^}]+\}\}/g, ''))) warn(`${k} contains digits; the page strips them (use {{seqWord}})`);
  }
  if (c.expected?.assumed && !c.expected?.note && !c.notes) warn('assumed case without a note citing where the expectation comes from');
  if (c.expected?.outcome === 'observe') warn('observe never passes or fails; prefer a verifiable outcome with assumed: true');
  if (savesNew && c.expected?.outcome !== 'created' && !c.base && Object.keys(c.input ?? {}).length) {
    warn('negative save without base "valid": other missing fields may be what blocks it');
  }
});

const checked = only ? [...only].filter(id => seen.has(id)).length : cases.length;
if (only) for (const id of only) if (!seen.has(id)) errors.push(`${id}: not found in ${path.relative(ROOT, file)}`);
for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`\n${path.relative(ROOT, file)}: ${checked} case(s) checked, ${errors.length} error(s), ${warnings.length} warning(s). Adapter outcomes: ${adapters.registration.outcomes.join(', ')}`);
process.exit(errors.length ? 1 : 0);
