import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, readFileSync, lstatSync, statSync, realpathSync } from 'node:fs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import './modules/registration/index.mjs';
import { plugins, pluginFor, reservedIds } from './modules/index.mjs';
import { registrationData, registrationWorkflows, workbookAutomation } from './modules/registration/adapter.mjs';
export { registrationData, registrationWorkflows, workbookAutomation };
// Live object (importers keep their reference); filled by reloadAdapters(): plugin adapters + valid adapter.json files.
export const adapters = {};

// ---- Dynamic adapters: qa/modules/<id>/adapter.json (declarative data only, never commands) ----
const ADAPTER_TOP_KEYS = new Set(['id', 'name', 'spec', 'prefix', 'actions', 'outcomes', 'variants', 'fields', 'bases', 'variantLabel', 'targetLabel', 'targetPlaceholder']);
const FIELD_KEYS = new Set(['card', 'label', 'kind', 'column', 'supported', 'required']);
const FIELD_KINDS = new Set(['text', 'textarea', 'select', 'date', 'datetime', 'checkbox', 'radio', 'number']);
const ADAPTER_ID = /^[a-z][a-z0-9-]*$/;
const SPEC_FILE_NAME = /^[A-Za-z0-9._-]+\.spec\.ts$/;
const SHELLISH =/[`;\r\n\0]|\$\(|&&|\|\|/;
const MAX_ADAPTER_BYTES = 256 * 1024;

function adapterText(v, name, max = 200) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || SHELLISH.test(v)) throw new Error(`${name} must be plain text (1-${max} characters, no shell syntax).`);
  return v;
}

// Returns a sanitized adapter or throws Error with a reason. `root` is the repo root (injectable for tests).
export function validateAdapterDefinition(raw, { root = ROOT, dirId } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('adapter.json must be an object.');
  for (const key of Object.keys(raw)) if (!ADAPTER_TOP_KEYS.has(key)) throw new Error(`Unknown top-level key: ${key}.`);
  if (typeof raw.id !== 'string' || !ADAPTER_ID.test(raw.id) || raw.id.length > 60) throw new Error('id must match /^[a-z][a-z0-9-]*$/.');
  if (reservedIds().has(raw.id)) throw new Error(`The built-in ${raw.id} adapter cannot be overridden.`);
  if (dirId !== undefined && dirId !== raw.id) throw new Error(`id "${raw.id}" must match its folder name "${dirId}".`);
  const a = { id: raw.id, name: adapterText(raw.name, 'name', 120) };
  if (typeof raw.spec !== 'string' || !raw.spec || raw.spec.includes('\\') || raw.spec.includes('\0') || path.isAbsolute(raw.spec) || !/^tests\/modules\/[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+\.spec\.ts$/.test(raw.spec) || !SPEC_FILE_NAME.test(raw.spec.split('/').pop())) throw new Error('spec must be a relative tests/modules/<id>/<file>.spec.ts path (file name: letters, digits, dot, dash, underscore).');
  const specDir = path.resolve(root, 'tests', 'modules', raw.id), specFile = path.resolve(root, raw.spec);
  const rel = path.relative(specDir, specFile);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) throw new Error(`spec must resolve inside tests/modules/${raw.id}/.`);
  let realSpec;
  try { realSpec = realpathSync(specFile); } catch { throw new Error(`spec file does not exist: ${raw.spec}.`); }
  let realDir; try { realDir = realpathSync(specDir); } catch { throw new Error(`tests/modules/${raw.id}/ does not exist.`); }
  const realRel = path.relative(realDir, realSpec);
  if (realRel.startsWith('..') || path.isAbsolute(realRel) || !statSync(realSpec).isFile()) throw new Error(`spec must be a file inside tests/modules/${raw.id}/.`);
  a.spec = raw.spec;
  if (raw.prefix !== undefined) { if (typeof raw.prefix !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(raw.prefix)) throw new Error('prefix must be 1-12 letters/digits starting with a letter.'); a.prefix = raw.prefix; }
  for (const k of ['variantLabel', 'targetLabel', 'targetPlaceholder']) if (raw[k] !== undefined) a[k] = adapterText(raw[k], k, 200);
  if (!raw.actions || typeof raw.actions !== 'object' || Array.isArray(raw.actions) || !Object.keys(raw.actions).length) throw new Error('actions must be a non-empty object.');
  a.actions = {};
  for (const [k, v] of Object.entries(raw.actions)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)) throw new Error(`Invalid action key: ${k}.`);
    a.actions[k] = adapterText(v, `actions.${k}`);
  }
  if (!Array.isArray(raw.outcomes) || !raw.outcomes.length || raw.outcomes.length > 60) throw new Error('outcomes must be a non-empty array.');
  a.outcomes = raw.outcomes.map((o, i) => { if (typeof o !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(o)) throw new Error(`Invalid outcome #${i + 1}.`); return o; });
  if (new Set(a.outcomes).size !== a.outcomes.length) throw new Error('outcomes must be unique.');
  if (!Array.isArray(raw.variants) || raw.variants.length > 50) throw new Error('variants must be an array.');
  a.variants = raw.variants.map((v, i) => adapterText(v, `variants[${i}]`, 120));
  if (!raw.fields || typeof raw.fields !== 'object' || Array.isArray(raw.fields) || !Object.keys(raw.fields).length || Object.keys(raw.fields).length > 300) throw new Error('fields must be a non-empty object.');
  a.fields = {};
  for (const [k, def] of Object.entries(raw.fields)) {
    if (!/^[a-z][a-z0-9_]{0,60}$/.test(k)) throw new Error(`Invalid field key: ${k}.`);
    if (!def || typeof def !== 'object' || Array.isArray(def)) throw new Error(`Field ${k} must be an object.`);
    for (const dk of Object.keys(def)) if (!FIELD_KEYS.has(dk)) throw new Error(`Field ${k} has unknown property: ${dk}.`);
    if (!FIELD_KINDS.has(def.kind)) throw new Error(`Field ${k} has unsupported kind.`);
    const f = { label: adapterText(def.label, `fields.${k}.label`), kind: def.kind };
    if (def.card !== undefined) f.card = adapterText(def.card, `fields.${k}.card`);
    if (def.column !== undefined) f.column = adapterText(def.column, `fields.${k}.column`);
    for (const b of ['supported', 'required']) if (def[b] !== undefined) { if (typeof def[b] !== 'boolean') throw new Error(`Field ${k}.${b} must be a boolean.`); f[b] = def[b]; }
    a.fields[k] = f;
  }
  if (raw.bases !== undefined) {
    if (!raw.bases || typeof raw.bases !== 'object' || Array.isArray(raw.bases)) throw new Error('bases must be an object.');
    a.bases = {};
    for (const [name, base] of Object.entries(raw.bases)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(name) || !base || typeof base !== 'object' || Array.isArray(base)) throw new Error(`Invalid base template: ${name}.`);
      for (const [fk, fv] of Object.entries(base)) {
        if (!Object.hasOwn(a.fields, fk)) throw new Error(`Base ${name} references unknown field ${fk}.`);
        if (!(typeof fv === 'string' || typeof fv === 'boolean') || String(fv).length > 10000) throw new Error(`Base ${name}.${fk} must be text or a boolean.`);
      }
      a.bases[name] = { ...base };
    }
  }
  return a;
}

// Reads every qa/modules/<id>/adapter.json under `root`. Invalid files are skipped with a warning; never throws.
export function loadModuleAdapters({ root = ROOT, warn = msg => console.warn(msg) } = {}) {
  const loaded = {};
  const base = path.join(root, 'qa', 'modules');
  let entries = [];
  try { entries = readdirSync(base, { withFileTypes: true }); } catch { return loaded; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(base, entry.name, 'adapter.json');
    try {
      if (!existsSync(file)) continue;
      const st = lstatSync(file);
      if (!st.isFile() || st.size > MAX_ADAPTER_BYTES) throw new Error('adapter.json must be a regular file under 256 KB.');
      const adapter = validateAdapterDefinition(JSON.parse(readFileSync(file, 'utf8')), { root, dirId: entry.name });
      if (Object.hasOwn(loaded, adapter.id)) throw new Error(`Duplicate adapter id ${adapter.id}.`);
      loaded[adapter.id] = adapter;
    } catch (error) {
      try { warn(`[registry] Skipped qa/modules/${entry.name}/adapter.json: ${error.message}`); } catch { /* ignore */ }
    }
  }
  return loaded;
}

// Rebuilds `adapters` in place (importers keep their live reference): built-in registration + valid adapter.json files.
export function reloadAdapters(options = {}) {
  const loaded = loadModuleAdapters(options);
  const reserved = reservedIds();
  for (const key of Object.keys(adapters)) delete adapters[key];
  for (const p of plugins()) adapters[p.id] = p.adapter;
  for (const [id, adapter] of Object.entries(loaded)) if (!reserved.has(id)) adapters[id] = adapter;
  return Object.keys(adapters);
}
reloadAdapters();

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const check = (condition, message, status = 400) => { if (!condition) throw new HttpError(status, message); };
export const textValue = (v, name, max = 200, required = false) => {
  check(typeof v === 'string' && v.length <= max && (!required || v.trim()), `${name} must be ${required ? 'non-empty ' : ''}text (up to ${max} characters).`);
  return v.trim();
};
export function validateCase(raw, module) {
  check(raw && typeof raw === 'object' && !Array.isArray(raw), 'A test case is required.');
  const c = structuredClone(raw);
  c.id = textValue(c.id, 'Case ID', 80, true);
  check(/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(c.id), 'Case ID can contain letters, numbers, dashes and underscores.');
  c.title = textValue(c.title, 'Title', 500, true);
  c.mode ??= module.adapter ? 'automated' : 'manual';
  check(['automated', 'manual'].includes(c.mode), 'Choose manual or automated execution.');
  c.priority ??= 'P2';
  check(['P0', 'P1', 'P2', 'P3'].includes(c.priority), 'Choose priority P0–P3.');
  c.category = textValue(c.category ?? 'General', 'Suite', 120, true);
  c.notes = textValue(c.notes ?? '', 'Notes', 10000);
  c.preconditions = textValue(c.preconditions ?? '', 'Preconditions', 10000);
  c.requirement = textValue(c.requirement ?? '', 'Requirement reference', 500);
  c.enabled = c.enabled !== false;
  c.steps ??= [];
  check(Array.isArray(c.steps) && c.steps.length <= 100, 'A case can have up to 100 manual steps.');
  c.steps = c.steps.map(s => {
    check(s && typeof s === 'object' && !Array.isArray(s), 'Each manual step needs an action and an expected result.');
    return { action: textValue(s.action, 'Step action', 2000, true), expected: textValue(s.expected, 'Step expectation', 2000, true) };
  });
  if (c.sourceWorkbook) check(c.mode === 'automated', 'Connected workbook cases use automatic execution; manual result entry is not supported.');
  if (c.mode === 'manual') {
    check(c.steps.length > 0, 'Add at least one step and its expected result.');
    return c;
  }
  const adapter = adapters[module.adapter];
  const modulePlugin = pluginFor(module), hooks = modulePlugin?.validate;
  const ctx = { module, adapter, check, textValue };
  check(adapter, 'Automation is not connected for this module. Choose manual execution.');
  check(Object.hasOwn(adapter.actions, c.action), 'Choose a supported module action.');
  check(c.expected && adapter.outcomes.includes(c.expected.outcome), 'Choose a supported expected outcome.');
  hooks?.afterOutcome?.(c, ctx);
  if (c.action === 'unavailable') {
    const source = hooks?.blockedSource?.(c, ctx);
    check(source?.action === 'unavailable' && c.automationBlocker === source.automationBlocker, 'Only reviewed workbook cases can carry a registered automation blocker.');
    check(c.expected.outcome === 'automation-blocked' && c.input && Object.keys(c.input).length === 0 && !c.base && !c.target && !c.registrationType, 'Blocked automation cannot submit inputs or include a patient prerequisite.');
    check(!['values', 'fieldErrors', 'hints', 'persisted'].some(k => Object.keys(c.expected[k] ?? {}).length) && !c.expected.toastContains && c.expected.saveDisabled === undefined, 'Blocked automation cannot claim application assertions.');
    c.automationReadiness = 'blocked';
    return c;
  }
  check(c.expected.outcome !== 'automation-blocked', 'Automation-blocked outcome requires a registered blocker.');
  if (c.sourceWorkbook) c.automationReadiness = 'ready';
  check(c.input && typeof c.input === 'object' && !Array.isArray(c.input), 'Inputs must be a field/value map.');
  for (const [key, value] of Object.entries(c.input)) {
    check(Object.hasOwn(adapter.fields, key), `Unknown input field: ${key}.`);
    check(typeof value === 'string' || typeof value === 'boolean', `Input ${key} must be text or a boolean.`);
    check(String(value).length <= 10000, `Input ${key} is too long.`);
    hooks?.checkInput?.(key, value, ctx);
  }
  for (const kind of ['values', 'fieldErrors', 'persisted', 'hints']) {
    const map = c.expected[kind] ?? {};
    check(map && typeof map === 'object' && !Array.isArray(map), `${kind} must be a field/value map.`);
    for (const [key, value] of Object.entries(map)) {
      check(Object.hasOwn(adapter.fields, key) && typeof value === 'string' && value.length <= 10000, `Invalid ${kind} check: ${key}.`);
    }
  }
  if (c.base) check(Object.hasOwn(module.config?.bases ?? {}, c.base), 'Starting data template does not exist.');
  if (hooks?.workflow?.(c, ctx)) return c;
  hooks?.afterWorkflow?.(c, ctx);
  if (c.action === 'search') {
    textValue(c.input.search, 'Search text', 10000, true);
    check(Object.keys(c.input).every(k => k === 'search') && !c.base, 'Search cases accept only search text and do not use a starting-data template.');
    check(!['values', 'fieldErrors', 'hints', 'persisted'].some(k => Object.keys(c.expected[k] ?? {}).length) && !c.expected.toastContains && c.expected.saveDisabled === undefined, 'Search cases support outcome checks only.');
  } else check(!Object.hasOwn(c.input, 'search'), 'Search text can only be used with the Search action.');
  if (Object.keys(c.expected.persisted ?? {}).length) check(['save', 'saveTwice', 'update'].includes(c.action), 'Saved-value checks require Save, Save twice or Update.');
  if (c.expected.saveDisabled !== undefined) check(c.action === 'update', 'Update button checks require the Update action.');
  if (c.expected.toastContains) check(c.action !== 'fill', 'Toast checks require an action that submits the form.');
  if (c.expected.outcome === 'observe') check(!['values', 'fieldErrors', 'hints', 'persisted'].some(k => Object.keys(c.expected[k] ?? {}).length) && !c.expected.toastContains && c.expected.saveDisabled === undefined, 'Observation-only cases cannot define pass/fail assertions. Choose a verifiable outcome.');
  if (c.registrationType) check(adapter.variants.includes(c.registrationType), 'Choose a supported variant.');
  if (c.action === 'update') textValue(c.target, modulePlugin?.updateTargetLabel ?? 'Target record or dependency token', 200, true);
  for (const k of ['toastContains', 'note']) if (c.expected[k] !== undefined) textValue(c.expected[k], `Expected ${k}`, 10000);
  for (const k of ['saveDisabled', 'assumed']) if (c.expected[k] !== undefined) check(typeof c.expected[k] === 'boolean', `${k} must be a boolean.`);
  return c;
}

// Resolve references before taking the snapshot, and preserve prerequisite order.
export function resolveCases(all, selectedIds) {
  const byId = new Map(all.map(c => [c.id, c]));
  const ordered = [], visiting = new Set(), done = new Set();
  function visit(id) {
    const c = byId.get(id);
    check(c && c.enabled !== false, `Case ${id} is missing or disabled.`);
    check(!visiting.has(id), `Dependency cycle includes ${id}.`);
    if (done.has(id)) return;
    visiting.add(id);
    const refs = [...JSON.stringify(c).matchAll(/\{\{\w+@([\w-]+)\}\}/g)].map(m => m[1]);
    refs.forEach(visit);
    visiting.delete(id); done.add(id); ordered.push(c);
  }
  selectedIds.forEach(visit);
  return ordered;
}
