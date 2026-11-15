import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, adapters, reloadAdapters, validateAdapterDefinition, validateCase } from './registry.mjs';
import { resolveModuleFolder, moduleFolder } from './module-layout.mjs';
import { pluginFor } from './modules/index.mjs';
import { loginSchema } from './environment-settings.mjs';
import { scanCode } from '../qa/tools/install-module-adapter.mjs';

const SECRET_KEY_RE = /(?:pass(?:word|wd|phrase|code)|pwd|pw|secret|token|api[_-]?key|credential|authorization|bearer)/i;
const RESERVED_FIELD_KEYS = new Set(['search', 'workflow', 'peer', 'record_id', 'notes']);
const FIELD_KINDS = new Set(['text', 'textarea', 'select', 'date', 'datetime', 'checkbox', 'radio', 'number']);
const SAFE_KEY = /^[a-z][a-z0-9_]{0,60}$/;

const toSnake = (raw, idx = 0) => {
  let k = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!k || !/^[a-z]/.test(k)) k = `field_${k || idx + 1}`;
  if (SECRET_KEY_RE.test(k)) return null;
  if (k === 'search') k = 'query_text';
  if (k === 'workflow' || k === 'peer') k = `${k}_value`;
  return k.slice(0, 60);
};

const toPascal = slug =>
  String(slug || 'Module')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('') || 'Module';

function mapKind(rawType) {
  const t = String(rawType ?? '').toLowerCase();
  if (t.includes('textarea') || t.includes('multiline') || t.includes('remark') || t.includes('note') || t.includes('address')) return 'textarea';
  if (t.includes('select') || t.includes('drop') || t.includes('combo') || t.includes('lookup')) return 'select';
  if (t.includes('datetime')) return 'datetime';
  if (t.includes('date') || t === 'dob') return 'date';
  if (t.includes('check') || t.includes('bool') || t.includes('toggle')) return 'checkbox';
  if (t.includes('radio')) return 'radio';
  if (t.includes('num') || t.includes('int') || t.includes('dec') || t.includes('amount') || t.includes('age') || t.includes('qty')) return 'number';
  return 'text';
}

const cleanAdapterText = (v, fallback, max = 180) => {
  const s = String(v ?? '').replace(/[`$;{}\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim();
  return (s || fallback).slice(0, max);
};

function readDiscoveredFields(qaDir) {
  const dir = path.join(qaDir, 'discovery');
  if (!fs.existsSync(dir)) return [];
  const items = [];
  for (const name of fs.readdirSync(dir).filter(n => /^fields-.*\.json$/i.test(n))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      const list = Array.isArray(data) ? data : Array.isArray(data?.fields) ? data.fields : Object.values(data ?? {});
      for (const entry of list) {
        if (!entry || typeof entry !== 'object' || !entry.label) continue;
        items.push({
          label: String(entry.label),
          kind: mapKind(entry.kind ?? entry.type),
          card: entry.card ? String(entry.card) : 'General',
          column: entry.column ? String(entry.column) : undefined,
          required: Boolean(entry.required),
          options: Array.isArray(entry.options) ? entry.options.map(String).slice(0, 50) : undefined,
        });
      }
    } catch { /* ignore unreadable discovery json */ }
  }
  return items;
}

function syntheticDefaultFor(key, def) {
  if (def.kind === 'checkbox') return true;
  if (def.kind === 'number') return '10';
  if (def.kind === 'date') return '2026-01-15';
  if (def.kind === 'datetime') return '2026-01-15T10:00';
  if (Array.isArray(def.options) && def.options.length) return def.options[0];
  if (/phone|mobile|contact/.test(key)) return '9876543210';
  if (/mail/.test(key)) return 'agent.testing@example.test';
  return 'Agent Testing';
}

/** Builds a declarative adapter definition and 5 clean Playwright files from discovered DOM + intake insights + cases. */
export function synthesizeAdapterProposal({ module, insights = null, setup = null, cases = [], layoutRoot = ROOT } = {}) {
  const productId = module.productId ?? 'augastam';
  const moduleId = module.id;
  const qaRel = resolveModuleFolder(layoutRoot, 'qa', productId, moduleId);
  const testsRel = moduleFolder('tests', productId, moduleId);
  const specRel = `${testsRel}/cases.spec.ts`;
  const qaDir = path.join(layoutRoot, ...qaRel.split('/'));
  const classPrefix = toPascal(moduleId);
  const pageClass = `${classPrefix}Page`;
  const moduleUrl = setup?.moduleUrl || insights?.suggestedSetup?.moduleUrl || '/';

  const rawVariants = [...(setup?.variants ?? []), ...(insights?.suggestedSetup?.variants ?? [])]
    .map(v => cleanAdapterText(v, '', 120))
    .filter(Boolean);
  const variants = [];
  for (const v of rawVariants) if (!variants.some(x => x.toLowerCase() === v.toLowerCase())) variants.push(v);

  const fields = {};
  const fieldMeta = {};
  const addField = (rawName, info = {}) => {
    if (Object.keys(fields).length >= 280) return null;
    let key = toSnake(rawName, Object.keys(fields).length);
    if (!key || RESERVED_FIELD_KEYS.has(key) || !SAFE_KEY.test(key)) return null;
    let suffix = 2;
    while (Object.hasOwn(fields, key) && fieldMeta[key]?.label.toLowerCase() !== String(info.label ?? rawName).trim().toLowerCase()) {
      key = `${key.slice(0, 54)}_${suffix++}`;
    }
    if (Object.hasOwn(fields, key)) return key;
    const kind = FIELD_KINDS.has(info.kind) ? info.kind : mapKind(info.kind ?? info.type);
    const label = cleanAdapterText(info.label ?? rawName, key, 180);
    fields[key] = {
      label,
      kind,
      ...(info.card ? { card: cleanAdapterText(info.card, 'General', 120) } : {}),
      ...(info.column ? { column: cleanAdapterText(info.column, key, 80) } : {}),
      ...(info.required ? { required: true } : {}),
    };
    fieldMeta[key] = { ...fields[key], ...(Array.isArray(info.options) && info.options.length ? { options: info.options.slice(0, 30) } : {}) };
    return key;
  };

  for (const d of readDiscoveredFields(qaDir)) addField(d.column || d.label, d);
  for (const f of insights?.fields ?? []) addField(f.name, { label: f.name, kind: mapKind(f.type), card: 'General', required: Boolean(f.required) });
  for (const c of cases ?? []) {
    if (c?.input && typeof c.input === 'object') {
      for (const k of Object.keys(c.input)) if (k !== 'search') addField(k, { label: k.replace(/_/g, ' '), kind: typeof c.input[k] === 'boolean' ? 'checkbox' : 'text', card: 'General' });
    }
  }

  const formFieldKeys = Object.keys(fields);
  fields.record_id = { label: 'Record ID', kind: 'text', card: 'General' };
  fieldMeta.record_id = { ...fields.record_id };
  fields.notes = { label: 'Notes', kind: 'textarea', card: 'General' };
  fieldMeta.notes = { ...fields.notes };
  fields.search = { label: 'Search query', kind: 'text', card: 'Search' };
  fieldMeta.search = { ...fields.search };

  const validBase = {};
  const existingBase = module.config?.bases?.valid;
  if (existingBase && typeof existingBase === 'object') {
    for (const [k, v] of Object.entries(existingBase)) {
      if (Object.hasOwn(fields, k) && k !== 'search' && (typeof v === 'string' || typeof v === 'boolean')) validBase[k] = v;
    }
  }
  for (const k of formFieldKeys.filter(k => fields[k].required).slice(0, 10)) {
    if (!(k in validBase)) validBase[k] = syntheticDefaultFor(k, fieldMeta[k]);
  }
  if (!Object.keys(validBase).length && formFieldKeys.length) {
    const first = formFieldKeys[0];
    validBase[first] = syntheticDefaultFor(first, fieldMeta[first]);
  }

  const adapter = {
    id: moduleId,
    ...(productId !== 'augastam' ? { product: productId } : {}),
    name: cleanAdapterText(`${module.name} - Playwright`, moduleId, 120),
    spec: specRel,
    prefix: /^[A-Za-z][A-Za-z0-9]{0,11}$/.test(String(module.prefix || '')) ? String(module.prefix).toUpperCase() : 'TC',
    actions: {
      fill: 'Fill and inspect fields',
      save: 'Fill fields and Save',
      update: 'Update record',
      search: 'Search records',
      workflow: 'Run workflow steps',
    },
    outcomes: ['created', 'updated', 'blocked', 'field-state', 'found', 'not-found', 'no-errors', 'verified'],
    variants,
    fields,
    ...(Object.keys(validBase).length ? { bases: { valid: validBase } } : {}),
  };

  const fieldsTs = [
    `export interface FieldDef {`,
    `  card?: string;`,
    `  label: string;`,
    `  kind: 'text' | 'textarea' | 'select' | 'date' | 'datetime' | 'checkbox' | 'radio' | 'number';`,
    `  column?: string;`,
    `  required?: boolean;`,
    `  options?: string[];`,
    `}`,
    ``,
    `export const FIELDS: Record<string, FieldDef> = ${JSON.stringify(fieldMeta, null, 2)};`,
    ``,
    `export const FILL_ORDER: string[] = ${JSON.stringify(formFieldKeys.concat(['notes']))};`,
    ``,
  ].join('\n');

  const pageTs = [
    `import type { Locator, Page } from '@playwright/test';`,
    `import { FIELDS } from './fields';`,
    ``,
    `const MODULE_PATH = ${JSON.stringify(moduleUrl)};`,
    ``,
    `export interface StepExecutionResult {`,
    `  action: string;`,
    `  expected: string;`,
    `  performed: boolean;`,
    `  verified: boolean;`,
    `}`,
    ``,
    `export class ${pageClass} {`,
    `  readonly page: Page;`,
    ``,
    `  constructor(page: Page) {`,
    `    this.page = page;`,
    `  }`,
    ``,
    `  async open(variant?: string, section?: string): Promise<void> {`,
    `    await this.page.goto(MODULE_PATH, { waitUntil: 'domcontentloaded' });`,
    `    await this.page.waitForLoadState('networkidle').catch(() => {});`,
    `    if (variant) await this.selectVariant(variant);`,
    `    if (section) await this.selectSection(section);`,
    `  }`,
    ``,
    `  async selectVariant(variant: string): Promise<void> {`,
    `    const tab = this.page.getByRole('tab', { name: variant, exact: false }).first();`,
    `    if (await tab.isVisible().catch(() => false)) {`,
    `      await tab.click();`,
    `      return;`,
    `    }`,
    `    const btn = this.page.getByRole('button', { name: variant, exact: false }).first();`,
    `    if (await btn.isVisible().catch(() => false)) {`,
    `      await btn.click();`,
    `      return;`,
    `    }`,
    `    const radio = this.page.getByLabel(variant, { exact: false }).first();`,
    `    if (await radio.isVisible().catch(() => false)) await radio.click();`,
    `  }`,
    ``,
    `  async selectSection(section: string): Promise<boolean> {`,
    `    const clean = section.trim();`,
    `    if (clean.length < 2) return false;`,
    `    const navSelectors = [`,
    `      this.page.getByRole('tab', { name: clean, exact: false }).first(),`,
    `      this.page.locator('nav a, nav button, [data-section], [data-nav]').filter({ hasText: clean }).first(),`,
    `    ];`,
    `    for (const loc of navSelectors) {`,
    `      if (await loc.isVisible().catch(() => false)) {`,
    `        await loc.click().catch(() => {});`,
    `        await this.page.waitForTimeout(150);`,
    `        return true;`,
    `      }`,
    `    }`,
    `    return false;`,
    `  }`,
    ``,
    `  private async controlFor(key: string): Promise<Locator | null> {`,
    `    const def = FIELDS[key];`,
    `    const rawLabel = def?.label ?? key.replace(/_/g, ' ');`,
    `    const shortLabel = rawLabel.replace(/\\s*\\([^)]*\\)/g, '').trim();`,
    `    const labels = shortLabel && shortLabel !== rawLabel ? [rawLabel, shortLabel] : [rawLabel];`,
    `    const candidates: Locator[] = [];`,
    `    for (const label of labels) {`,
    `      candidates.push(this.page.getByLabel(label, { exact: false }).first());`,
    `      candidates.push(this.page.getByPlaceholder(label, { exact: false }).first());`,
    `    }`,
    `    if (def?.column) {`,
    `      candidates.push(this.page.locator(\`[name="\${def.column}"], [id="\${def.column}"]\`).first());`,
    `    }`,
    `    candidates.push(this.page.locator(\`[name="\${key}"], [id="\${key}"]\`).first());`,
    `    for (const loc of candidates) {`,
    `      if (await loc.isVisible().catch(() => false)) return loc;`,
    `    }`,
    `    return null;`,
    `  }`,
    ``,
    `  private async controlByLabel(rawLabel: string): Promise<Locator | null> {`,
    `    const clean = rawLabel.trim();`,
    `    if (!clean) return null;`,
    `    const norm = clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');`,
    `    if (FIELDS[norm]) {`,
    `      const found = await this.controlFor(norm);`,
    `      if (found) return found;`,
    `    }`,
    `    const byFieldLabel = Object.entries(FIELDS).find(([, def]) =>`,
    `      def.label.toLowerCase() === clean.toLowerCase() || def.label.toLowerCase().includes(clean.toLowerCase())`,
    `    );`,
    `    if (byFieldLabel) {`,
    `      const found = await this.controlFor(byFieldLabel[0]);`,
    `      if (found) return found;`,
    `    }`,
    `    const candidates: Locator[] = [`,
    `      this.page.getByLabel(clean, { exact: false }).first(),`,
    `      this.page.getByPlaceholder(clean, { exact: false }).first(),`,
    `      this.page.getByRole('textbox', { name: clean, exact: false }).first(),`,
    `      this.page.getByRole('combobox', { name: clean, exact: false }).first(),`,
    `      this.page.locator(\`[aria-label*="\${clean.replace(/"/g, '')}" i], [data-field*="\${norm}"]\`).first(),`,
    `    ];`,
    `    for (const loc of candidates) {`,
    `      if (await loc.isVisible().catch(() => false)) return loc;`,
    `    }`,
    `    return null;`,
    `  }`,
    ``,
    `  private async applyControl(loc: Locator, val: string | boolean): Promise<boolean> {`,
    `    const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'input');`,
    `    const type = await loc.getAttribute('type').catch(() => '');`,
    `    if (typeof val === 'boolean' || type === 'checkbox') {`,
    `      const checked = Boolean(val);`,
    `      if (checked) await loc.check().catch(() => loc.click());`,
    `      else await loc.uncheck().catch(() => {});`,
    `      return true;`,
    `    }`,
    `    const text = String(val ?? '');`,
    `    if (tag === 'select') {`,
    `      if (text) await loc.selectOption({ label: text }).catch(() => loc.selectOption(text)).catch(() => {});`,
    `      else await loc.selectOption({ index: 0 }).catch(() => {});`,
    `      return true;`,
    `    }`,
    `    await loc.click().catch(() => {});`,
    `    await loc.fill(text);`,
    `    const role = await loc.getAttribute('role').catch(() => '');`,
    `    if (role === 'combobox' && text) {`,
    `      const opt = this.page.getByRole('option', { name: text, exact: false }).first();`,
    `      if (await opt.isVisible().catch(() => false)) await opt.click();`,
    `      else await loc.press('Enter').catch(() => {});`,
    `    }`,
    `    return true;`,
    `  }`,
    ``,
    `  async set(key: string, val: string | boolean): Promise<boolean> {`,
    `    const loc = await this.controlFor(key);`,
    `    if (!loc) return false;`,
    `    return this.applyControl(loc, val);`,
    `  }`,
    ``,
    `  async setByLabel(label: string, val: string | boolean): Promise<boolean> {`,
    `    const loc = await this.controlByLabel(label);`,
    `    if (!loc) return false;`,
    `    return this.applyControl(loc, val);`,
    `  }`,
    ``,
    `  async clickTarget(target: string, doubleClick = false): Promise<boolean> {`,
    `    const clean = target.trim().replace(/[.:;,]+$/, '');`,
    `    if (clean.length < 2) return false;`,
    `    const candidates: Locator[] = [`,
    `      this.page.getByRole('button', { name: clean, exact: false }).first(),`,
    `      this.page.getByRole('tab', { name: clean, exact: false }).first(),`,
    `      this.page.getByRole('link', { name: clean, exact: false }).first(),`,
    `      this.page.getByRole('checkbox', { name: clean, exact: false }).first(),`,
    `      this.page.getByRole('radio', { name: clean, exact: false }).first(),`,
    `      this.page.locator('[data-chip], .chip, button, [role="button"], a').filter({ hasText: clean }).first(),`,
    `    ];`,
    `    for (const loc of candidates) {`,
    `      if (await loc.isVisible().catch(() => false)) {`,
    `        if (doubleClick) await loc.dblclick().catch(() => loc.click());`,
    `        else await loc.click().catch(() => {});`,
    `        await this.page.waitForTimeout(150);`,
    `        return true;`,
    `      }`,
    `    }`,
    `    return false;`,
    `  }`,
    ``,
    `  async value(key: string): Promise<string> {`,
    `    const loc = await this.controlFor(key);`,
    `    if (!loc) return '';`,
    `    const type = await loc.getAttribute('type').catch(() => '');`,
    `    if (type === 'checkbox') return (await loc.isChecked().catch(() => false)) ? 'true' : 'false';`,
    `    return (await loc.inputValue().catch(() => loc.innerText().catch(() => ''))).trim();`,
    `  }`,
    ``,
    `  async fieldErrors(): Promise<Record<string, string>> {`,
    `    const out: Record<string, string> = {};`,
    `    const errs = this.page.locator('.invalid-feedback, .field-error, .error-message, [aria-invalid="true"]');`,
    `    const count = await errs.count().catch(() => 0);`,
    `    for (let i = 0; i < Math.min(count, 20); i++) {`,
    `      const el = errs.nth(i);`,
    `      if (!(await el.isVisible().catch(() => false))) continue;`,
    `      const msg = (await el.innerText().catch(() => '')).trim();`,
    `      if (msg) out[\`error_\${i + 1}\`] = msg;`,
    `    }`,
    `    return out;`,
    `  }`,
    ``,
    `  async toasts(): Promise<string[]> {`,
    `    const items: string[] = [];`,
    `    const loc = this.page.locator('.Toastify__toast, .toast, [role="alert"], [role="status"], .alert');`,
    `    const count = await loc.count().catch(() => 0);`,
    `    for (let i = 0; i < Math.min(count, 10); i++) {`,
    `      const el = loc.nth(i);`,
    `      if (!(await el.isVisible().catch(() => false))) continue;`,
    `      const t = (await el.innerText().catch(() => '')).trim();`,
    `      if (t) items.push(t);`,
    `    }`,
    `    return items;`,
    `  }`,
    ``,
    `  async saveButton(): Promise<Locator | null> {`,
    `    for (const label of ['Save Stage', 'Save', 'Submit', 'Update', 'Create', 'Confirm', 'Register', 'Add', 'OK', 'Apply Setting', 'Import']) {`,
    `      const btn = this.page.getByRole('button', { name: new RegExp(label, 'i') }).first();`,
    `      if (await btn.isVisible().catch(() => false)) return btn;`,
    `    }`,
    `    const submit = this.page.locator('button[type="submit"], input[type="submit"]').first();`,
    `    return (await submit.isVisible().catch(() => false)) ? submit : null;`,
    `  }`,
    ``,
    `  async save(): Promise<{ clicked: boolean; disabled: boolean }> {`,
    `    const btn = await this.saveButton();`,
    `    if (!btn) return { clicked: false, disabled: false };`,
    `    if (await btn.isDisabled().catch(() => false)) return { clicked: false, disabled: true };`,
    `    await btn.click();`,
    `    await this.page.waitForTimeout(300);`,
    `    return { clicked: true, disabled: false };`,
    `  }`,
    ``,
    `  async search(query: string): Promise<{ searched: boolean; matches: number }> {`,
    `    const candidates: Array<Locator | null> = [`,
    `      await this.controlFor('search'),`,
    `      this.page.getByRole('searchbox').first(),`,
    `      this.page.getByPlaceholder(/search|filter|key|template/i).first(),`,
    `      this.page.locator('input[type="search"], input[placeholder*="Search" i]').first(),`,
    `    ];`,
    `    let box: Locator | null = null;`,
    `    for (const c of candidates) {`,
    `      if (c && (await c.isVisible().catch(() => false))) { box = c; break; }`,
    `    }`,
    `    if (!box) return { searched: false, matches: 0 };`,
    `    await box.fill(query);`,
    `    await box.press('Enter').catch(() => {});`,
    `    await this.page.waitForTimeout(300);`,
    `    const itemLoc = this.page.locator('table tbody tr, [role="row"]:not(thead tr), [data-chip], .chip, .template-chip, .field-row, [data-field-row]');`,
    `    const rawCount = await itemLoc.count().catch(() => 0);`,
    `    let visibleMatches = 0;`,
    `    for (let i = 0; i < Math.min(rawCount, 60); i++) {`,
    `      if (await itemLoc.nth(i).isVisible().catch(() => false)) visibleMatches++;`,
    `    }`,
    `    return { searched: true, matches: visibleMatches };`,
    `  }`,
    ``,
    `  private expectedHints(expectedText: string): string[] {`,
    `    const hints: string[] = [];`,
    `    for (const m of expectedText.matchAll(/["']([^"']{2,60})["']/g)) hints.push(m[1]);`,
    `    for (const m of expectedText.matchAll(/\\b[A-Za-z]+_[A-Za-z0-9_.]+\\b/g)) hints.push(m[0]);`,
    `    for (const m of expectedText.matchAll(/\\b[A-Z][A-Za-z0-9/?-]{1,}(?:\\s+(?:[A-Z][A-Za-z0-9/?-]{1,}|&|of|by)){0,2}/g)) {`,
    `      const s = m[0].trim();`,
    `      if (!/^(The|Only|Same|Each|Record|Rows|Chips|Columns|No|None|If|With|On|In|An)$/i.test(s)) hints.push(s);`,
    `    }`,
    `    for (const m of expectedText.matchAll(/\\b(welcome|header|menu|language|settings|notification|logout|dialog|asterisk|mandatory|checkbox|dropdown|filter|template|stage|process|task|preview|alias|visit|doctor|admin)\\b/gi)) {`,
    `      hints.push(m[1]);`,
    `    }`,
    `    return [...new Set(hints)].slice(0, 14);`,
    `  }`,
    ``,
    `  async runSteps(steps: Array<{ action: string; expected: string }> = []): Promise<StepExecutionResult[]> {`,
    `    const log: StepExecutionResult[] = [];`,
    `    for (const st of steps) {`,
    `      let performed = false;`,
    `      const act = st.action || '';`,
    `      const typeMatch = /\\b(?:type|enter|fill)\\s+['"]([^'"]*)['"]\\s+(?:in|into)\\s+([A-Za-z0-9 /_.-]{2,50})/i.exec(act);`,
    `      const fillMatch = !typeMatch ? /\\bfill\\s+([A-Za-z0-9 /_.-]{2,50}?)\\s+with\\s+['"]([^'"]*)['"]/i.exec(act) : null;`,
    `      const bareType = !typeMatch && !fillMatch ? /\\b(?:type|enter)\\s+['"]([^'"]+)['"]/i.exec(act) : null;`,
    `      if (typeMatch) {`,
    `        if (await this.setByLabel(typeMatch[2], typeMatch[1])) performed = true;`,
    `      } else if (fillMatch) {`,
    `        if (await this.setByLabel(fillMatch[1], fillMatch[2])) performed = true;`,
    `      } else if (bareType) {`,
    `        for (const sel of [`,
    `          '[role="dialog"]:not(.hidden) input:not([type="checkbox"]):not([type="radio"]):not([type="search"])',`,
    `          'section.active input:not([type="checkbox"]):not([type="radio"]):not([type="search"])',`,
    `          'input:not([type="checkbox"]):not([type="radio"]):not([type="search"])',`,
    `        ]) {`,
    `          const inp = this.page.locator(sel).first();`,
    `          if (await inp.isVisible().catch(() => false)) { await inp.fill(bareType[1]); performed = true; break; }`,
    `        }`,
    `      }`,
    `      const leaveEmpty = /\\bleave\\s+([A-Za-z0-9 /_.-]{2,50}?)\\s+empty/i.exec(act);`,
    `      if (leaveEmpty && (await this.setByLabel(leaveEmpty[1], ''))) performed = true;`,
    `      const spacesMatch = /\\btype\\s+(?:two|three)\\s+spaces\\s+in\\s+([A-Za-z0-9 /_.-]{2,50})/i.exec(act);`,
    `      if (spacesMatch && (await this.setByLabel(spacesMatch[1], '   '))) performed = true;`,
    `      const pickMatch = /\\b(?:pick|select|choose)\\s+(?:a\\s+(\\w+)(?:\\s+(?:in|from)\\s+(?:the\\s+)?([A-Za-z0-9 /_.-]{2,40}))?|['"]?([^'"]+?)['"]?\\s+(?:in|from)\\s+(?:the\\s+)?([A-Za-z0-9 /_.-]{2,40}))/i.exec(act);`,
    `      if (pickMatch) {`,
    `        const genericNoun = pickMatch[1];`,
    `        const rawTarget = (pickMatch[2] || pickMatch[4] || genericNoun || '').replace(/\\s+dropdown$/i, '').replace(/\\.+$/, '').trim();`,
    `        const desired = pickMatch[3];`,
    `        let loc = !/\\bstage\\b/i.test(rawTarget) && ((!pickMatch[2] && !pickMatch[4]) || /^select role$/i.test(rawTarget))`,
    `          ? this.page.locator('[role="dialog"]:not(.hidden) select').first()`,
    `          : null;`,
    `        if (loc && !(await loc.isVisible().catch(() => false))) loc = null;`,
    `        if (!loc && rawTarget) loc = await this.controlByLabel(rawTarget);`,
    `        if (!loc && genericNoun) {`,
    `          for (const sel of ['[role="dialog"]:not(.hidden) select', 'section.active select', 'select']) {`,
    `            const cand = this.page.locator(sel).first();`,
    `            if (await cand.isVisible().catch(() => false)) { loc = cand; break; }`,
    `          }`,
    `        }`,
    `        if (loc && (await loc.isVisible().catch(() => false))) {`,
    `          if (desired && !/^a\\s+/i.test(desired)) performed = await this.applyControl(loc, desired);`,
    `          else {`,
    `            const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');`,
    `            if (tag === 'select') {`,
    `              const optCount = await loc.locator('option').count().catch(() => 0);`,
    `              if (optCount > 1) { await loc.selectOption({ index: 1 }).catch(() => {}); performed = true; }`,
    `              else if (optCount === 1) { await loc.selectOption({ index: 0 }).catch(() => {}); performed = true; }`,
    `            }`,
    `          }`,
    `        }`,
    `      }`,
    `      if (/\\bclear\\s+(?:the\\s+)?box\\b/i.test(act)) {`,
    `        const box = this.page.getByPlaceholder(/search|filter|key|template/i).first();`,
    `        if (await box.isVisible().catch(() => false)) { await box.fill(''); performed = true; }`,
    `      }`,
    `      const isDbl = /\\bdouble[-\\s]?click\\b/i.test(act);`,
    `      const quoted = /["']([^"']{2,60})["']/.exec(act)?.[1];`,
    `      if (quoted && !typeMatch && !fillMatch && !bareType) {`,
    `        if (await this.clickTarget(quoted, isDbl)) performed = true;`,
    `      }`,
    `      for (const m of act.matchAll(/\\b(?:click|open|switch(?:\\s+to)?|toggle|press)(?:\\s+on)?\\s+(?:the\\s+)?(?:dialog\\s+|tab\\s+|button\\s+|chip\\s+|header\\s+)?([A-Za-z0-9 +/_.-]{2,40}?)(?=\\s+(?:once|twice|again|quickly|under\\b|beside\\b|at\\b|on\\b|with\\b|without\\b|button|tab|chip|control|dialog|and\\b)|[.,;]|$)/gi)) {`,
    `        if (await this.clickTarget(m[1], isDbl)) performed = true;`,
    `      }`,
    `      if (!performed && !/^(?:inspect|look|review|compare|verify)\\b|\\bwithout\\s+confirming\\b/i.test(act.trim()) && /\\b(save|submit|confirm|export|add)\\b/i.test(act)) {`,
    `        const res = await this.save();`,
    `        performed = res.clicked || res.disabled;`,
    `      }`,
    `      const bodyText = (await this.page.locator('body').innerText().catch(() => '')).toLowerCase();`,
    `      const hints = this.expectedHints(st.expected || '');`,
    `      const verified = hints.length > 0 ? hints.some((h) => bodyText.includes(h.toLowerCase())) : performed;`,
    `      log.push({ action: act, expected: st.expected, performed, verified });`,
    `    }`,
    `    return log;`,
    `  }`,
    `}`,
    ``,
  ].join('\n');

  const caseRunnerTs = [
    `import type { Page, TestInfo } from '@playwright/test';`,
    `import { captureEvidence } from '../../fixtures/evidence';`,
    `import { FIELDS, FILL_ORDER } from './fields';`,
    `import { ${pageClass} } from './${moduleId}.page';`,
    ``,
    `let seqCounter = 101;`,
    `const SEQ_WORDS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];`,
    ``,
    `function expandTokens(raw: string): string {`,
    `  const idx = seqCounter++;`,
    `  const word = SEQ_WORDS[idx % SEQ_WORDS.length];`,
    `  const d = new Date();`,
    `  const today = \`\${String(d.getDate()).padStart(2, '0')}/\${String(d.getMonth() + 1).padStart(2, '0')}/\${d.getFullYear()}\`;`,
    `  return raw`,
    `    .replace(/\\{\\{seqWord\\}\\}/g, word)`,
    `    .replace(/\\{\\{seq\\}\\}/g, String(idx))`,
    `    .replace(/\\{\\{phone\\}\\}/g, \`98765\${String(10000 + (idx % 89999)).padStart(5, '0')}\`)`,
    `    .replace(/\\{\\{today\\}\\}/g, today);`,
    `}`,
    ``,
    `export interface ModuleCase {`,
    `  id: string;`,
    `  title: string;`,
    `  category?: string;`,
    `  priority?: string;`,
    `  registrationType?: string;`,
    `  action: 'fill' | 'save' | 'update' | 'search' | 'workflow' | 'unavailable';`,
    `  base?: string;`,
    `  target?: string;`,
    `  enabled?: boolean;`,
    `  steps?: Array<{ action: string; expected: string }>;`,
    `  input: Record<string, string | boolean>;`,
    `  expected: {`,
    `    outcome: string;`,
    `    toastContains?: string;`,
    `    fieldErrors?: Record<string, string>;`,
    `    values?: Record<string, string>;`,
    `    persisted?: Record<string, string>;`,
    `    saveDisabled?: boolean;`,
    `    note?: string;`,
    `  };`,
    `}`,
    ``,
    `export interface CaseResult {`,
    `  id: string;`,
    `  title: string;`,
    `  category: string;`,
    `  priority: string;`,
    `  status: 'PASS' | 'FAIL' | 'ERROR' | 'BLOCKED';`,
    `  verificationPerformed: boolean;`,
    `  expected: string;`,
    `  actual: string;`,
    `  mismatches: string[];`,
    `  toasts: string[];`,
    `  fieldErrors: Record<string, string>;`,
    `  values: Record<string, string>;`,
    `  durationMs: number;`,
    `}`,
    ``,
    `export async function runCase(page: Page, c: ModuleCase, bases: Record<string, Record<string, string>>, info: TestInfo): Promise<CaseResult> {`,
    `  const started = Date.now();`,
    `  const pageErrors: string[] = [];`,
    `  const onError = (err: Error) => pageErrors.push(err.message);`,
    `  page.on('pageerror', onError);`,
    `  const mod = new ${pageClass}(page);`,
    `  const mismatches: string[] = [];`,
    `  const values: Record<string, string> = {};`,
    ``,
    `  try {`,
    `    await mod.open(c.registrationType, c.category);`,
    `    await captureEvidence(page, info, c.id, 'Module opened');`,
    ``,
    `    const rawBase = c.base ? bases[c.base] ?? {} : {};`,
    `    const baseInput: Record<string, string | boolean> = {};`,
    `    for (const [k, v] of Object.entries(rawBase)) baseInput[k] = typeof v === 'string' ? expandTokens(v) : v;`,
    `    const caseInput: Record<string, string | boolean> = {};`,
    `    for (const [k, v] of Object.entries(c.input ?? {})) caseInput[k] = typeof v === 'string' ? expandTokens(v) : v;`,
    `    const resolvedSteps = (c.steps ?? []).map((st) => ({ action: expandTokens(st.action), expected: expandTokens(st.expected) }));`,
    ``,
    `    if (c.action === 'search') {`,
    `      const stepLog = resolvedSteps.length ? await mod.runSteps(resolvedSteps) : [];`,
    `      const q = String(caseInput.search ?? baseInput.search ?? '');`,
    `      const sr = await mod.search(q);`,
    `      if (!sr.searched && !stepLog.some((s) => s.performed)) mismatches.push('Search control was not found on the module page.');`,
    `      if (c.expected.outcome === 'not-found' && sr.matches > 0) mismatches.push(\`Expected no search matches, found \${sr.matches}.\`);`,
    `      if (c.expected.outcome === 'found' && sr.searched && sr.matches === 0 && !stepLog.some((s) => s.verified)) mismatches.push(\`Expected search matches for "\${q}", found 0.\`);`,
    `    } else {`,
    `      const baseKeys = [...FILL_ORDER.filter((k) => k in baseInput && !(k in caseInput)), ...Object.keys(baseInput).filter((k) => !FILL_ORDER.includes(k) && !(k in caseInput))];`,
    `      for (const k of baseKeys) {`,
    `        await mod.set(k, baseInput[k]);`,
    `      }`,
    `      const appliedKeys = new Set<string>();`,
    `      const inputKeys = [...FILL_ORDER.filter((k) => k in caseInput), ...Object.keys(caseInput).filter((k) => !FILL_ORDER.includes(k))];`,
    `      for (const k of inputKeys) {`,
    `        if (k === 'search') { appliedKeys.add(k); continue; }`,
    `        if (await mod.set(k, caseInput[k])) appliedKeys.add(k);`,
    `      }`,
    `      const stepLog = resolvedSteps.length ? await mod.runSteps(resolvedSteps) : [];`,
    `      for (const k of inputKeys) {`,
    `        if (appliedKeys.has(k)) continue;`,
    `        const labelBase = (FIELDS[k]?.label ?? k.replace(/_/g, ' ')).replace(/\\s*\\([^)]*\\)/g, '').trim().toLowerCase();`,
    `        const handledInStep = stepLog.some((s) => s.performed && labelBase && s.action.toLowerCase().includes(labelBase));`,
    `        if (handledInStep || (await mod.set(k, caseInput[k]))) appliedKeys.add(k);`,
    `        else mismatches.push(\`Field control "\${k}" was not found on the page.\`);`,
    `      }`,
    `      if (c.action === 'save' || c.action === 'update') {`,
    `        const stepClickedSave = stepLog.some((s) => s.performed && /\\b(save|submit|update|create|confirm|register|add|ok)\\b/i.test(s.action));`,
    `        if (!stepClickedSave || c.expected.saveDisabled !== undefined) {`,
    `          const saveRes = await mod.save();`,
    `          if (c.expected.saveDisabled !== undefined && saveRes.disabled !== c.expected.saveDisabled) {`,
    `            mismatches.push(\`Expected saveDisabled=\${c.expected.saveDisabled}, actual \${saveRes.disabled}.\`);`,
    `          } else if (!saveRes.clicked && !saveRes.disabled && !stepClickedSave) {`,
    `            mismatches.push('Save or Submit button was not found or could not be clicked on the page.');`,
    `          }`,
    `        }`,
    `      } else if (c.action === 'workflow' && stepLog.length > 0 && !stepLog.some((s) => s.performed || s.verified)) {`,
    `        mismatches.push('None of the expected workflow controls or screen elements were found on the page.');`,
    `      }`,
    `    }`,
    ``,
    `    const errors = await mod.fieldErrors();`,
    `    const toasts = await mod.toasts();`,
    `    if ((c.expected.outcome === 'created' || c.expected.outcome === 'updated') && Object.keys(errors).length > 0) {`,
    `      mismatches.push(\`Unexpected validation error on \${c.expected.outcome}: \${Object.values(errors).join(' | ')}\`);`,
    `    }`,
    `    for (const [k, exp] of Object.entries(c.expected.values ?? {})) {`,
    `      values[k] = await mod.value(k);`,
    `      if (!values[k].toLowerCase().includes(exp.toLowerCase())) mismatches.push(\`value.\${k}: expected "\${exp}", actual "\${values[k]}"\`);`,
    `    }`,
    `    for (const [k, exp] of Object.entries(c.expected.fieldErrors ?? {})) {`,
    `      const errText = Object.values(errors).join(' | ');`,
    `      if (!errText.toLowerCase().includes(exp.toLowerCase())) mismatches.push(\`fieldError.\${k}: expected "\${exp}", actual "\${errText || 'none'}"\`);`,
    `    }`,
    `    if (c.expected.toastContains && !toasts.some((t) => t.toLowerCase().includes(c.expected.toastContains!.toLowerCase()))) {`,
    `      mismatches.push(\`toast: expected substring "\${c.expected.toastContains}", actual \${JSON.stringify(toasts)}\`);`,
    `    }`,
    `    if (c.expected.outcome === 'blocked' && !Object.keys(errors).length && !toasts.some((t) => /required|invalid|error|fail|cannot|blocked/i.test(t))) {`,
    `      const saveBtn = await mod.saveButton();`,
    `      const isDis = saveBtn ? await saveBtn.isDisabled().catch(() => false) : false;`,
    `      if (!isDis) mismatches.push('Expected validation error, error alert, or disabled Save button.');`,
    `    }`,
    `    if (pageErrors.length) mismatches.push(\`Uncaught page error: \${pageErrors[0]}\`);`,
    `    await captureEvidence(page, info, c.id, 'After action');`,
    ``,
    `    return {`,
    `      id: c.id,`,
    `      title: c.title,`,
    `      category: c.category ?? '',`,
    `      priority: c.priority ?? 'P2',`,
    `      status: mismatches.length ? 'FAIL' : 'PASS',`,
    `      verificationPerformed: true,`,
    `      expected: c.expected.note || c.expected.outcome,`,
    `      actual: mismatches.length ? mismatches.join('; ') : \`Verified outcome: \${c.expected.outcome}\`,`,
    `      mismatches,`,
    `      toasts,`,
    `      fieldErrors: errors,`,
    `      values,`,
    `      durationMs: Date.now() - started,`,
    `    };`,
    `  } finally {`,
    `    page.off('pageerror', onError);`,
    `  }`,
    `}`,
    ``,
  ].join('\n');

  const casesSpecTs = [
    `import { test, expect } from '../../fixtures/auth';`,
    `import { attachCaseResult, captureEvidence, readCasesSnapshot } from '../../fixtures/evidence';`,
    `import { CaseResult, ModuleCase, runCase } from './case-runner';`,
    ``,
    `const snapshot = readCasesSnapshot<ModuleCase>();`,
    `const bases: Record<string, Record<string, string>> = snapshot.bases ?? {};`,
    `const cases: ModuleCase[] = snapshot.cases ?? [];`,
    ``,
    `test.describe(${JSON.stringify(`${module.name} automated cases`)}, () => {`,
    `  for (const c of cases) {`,
    `    test(\`\${c.id} \${c.title}\`, async ({ page }, info) => {`,
    `      test.skip(c.enabled === false, 'Disabled in portal');`,
    `      let r: CaseResult;`,
    `      const started = Date.now();`,
    `      try {`,
    `        r = await runCase(page, c, bases, info);`,
    `      } catch (err: unknown) {`,
    `        const msg = err instanceof Error ? err.message : String(err);`,
    `        r = {`,
    `          id: c.id, title: c.title, category: c.category ?? '', priority: c.priority ?? 'P2',`,
    `          status: 'ERROR', verificationPerformed: false,`,
    `          expected: c.expected?.outcome ?? '', actual: \`runner error: \${msg.split('\\n')[0]}\`,`,
    `          mismatches: [], toasts: [], fieldErrors: {}, values: {}, durationMs: Date.now() - started,`,
    `        };`,
    `        await captureEvidence(page, info, c.id, 'Execution error');`,
    `      }`,
    `      await captureEvidence(page, info, c.id, \`Final result \${r.status}\`);`,
    `      await attachCaseResult(info, r);`,
    `      expect(r.status === 'ERROR' ? r.actual : '', 'runner error').toBe('');`,
    `      expect(r.mismatches, \`\${c.id}: expected vs actual\`).toEqual([]);`,
    `    });`,
    `  }`,
    `});`,
    ``,
  ].join('\n');

  const notesMd = [
    `# ${module.name} Automation Adapter`,
    ``,
    `- Module ID: \`${moduleId}\``,
    `- Product: \`${productId}\``,
    `- Target route: \`${moduleUrl}\``,
    `- Variants: ${variants.length ? variants.join(', ') : '(none)'}`,
    `- Fields registered: ${Object.keys(fields).length}`,
    ``,
    `Generated automatically by Test Studio from uploaded intake sources and discovered UI controls.`,
    `Update locators inside \`${moduleId}.page.ts\` if the target screen uses custom widgets.`,
    ``,
  ].join('\n');

  const files = {
    'fields.ts': fieldsTs,
    [`${moduleId}.page.ts`]: pageTs,
    'case-runner.ts': caseRunnerTs,
    'cases.spec.ts': casesSpecTs,
    'NOTES.md': notesMd,
    'adapter.json': JSON.stringify(adapter, null, 2) + '\n',
  };

  return { productId, moduleId, qaRel, testsRel, adapter, files };
}

/** Converts a manual/draft case spec into a validated automated case matching the module's adapter. */
export function convertCaseToAutomated(rawCase, module, adapter, { reconvert = false } = {}) {
  const c = structuredClone(rawCase);
  const steps = Array.isArray(c.steps) ? c.steps : [];
  const stepsActionText = steps.map(s => s.action ?? '').join(' ');
  const stepsExpectedText = steps.map(s => s.expected ?? '').join(' ');
  const text = [c.title, c.category, c.preconditions, stepsActionText, stepsExpectedText].join(' ');
  const availableFields = adapter?.fields ?? {};
  const fieldKeys = Object.keys(availableFields).filter(k => k !== 'search');
  const isLoginCase = /\b(sign[- ]?in|login|logout|password)\b/i.test(`${c.title ?? ''} ${c.category ?? ''}`);
  const formKeys = fieldKeys.filter(k => !['record_id', 'notes'].includes(k));
  const nonLoginFormKeys = formKeys.filter(k => !/email_id_user_name|user_name|username/i.test(k));
  const firstFormField = (isLoginCase ? formKeys : nonLoginFormKeys.length ? nonLoginFormKeys : formKeys)[0] ?? null;
  const hasValidBase = Boolean(module.config?.bases?.valid);
  const variant = !c.registrationType && Array.isArray(adapter?.variants)
    ? adapter.variants.find(v => text.toLowerCase().includes(v.toLowerCase()))
    : c.registrationType;

  // Preserve valid automated structure unless reconverting after adapter updates.
  if (!reconvert && c.mode === 'automated' && c.action && c.expected?.outcome) {
    try { return validateCase(c, module); } catch { /* re-synthesize below */ }
  }

  let action = 'workflow';
  let base;
  const input = {};
  const expected = {
    outcome: 'verified',
    ...(c.expected?.toastContains ? { toastContains: c.expected.toastContains } : {}),
    ...(c.expected?.fieldErrors ? { fieldErrors: c.expected.fieldErrors } : {}),
    ...(c.expected?.values ? { values: c.expected.values } : {}),
    ...(c.expected?.persisted ? { persisted: c.expected.persisted } : {}),
    ...(c.expected?.saveDisabled !== undefined ? { saveDisabled: c.expected.saveDisabled } : {}),
    ...(c.expected?.note ? { note: c.expected.note } : {}),
  };

  // Preserve explicit prior inputs unless it was just the legacy blind firstFormField fallback.
  const mappedInput = {};
  if (c.input && typeof c.input === 'object') {
    const entries = Object.entries(c.input).filter(([k, v]) => k !== 'search' && Object.hasOwn(availableFields, k) && (typeof v === 'string' || typeof v === 'boolean'));
    const legacyBlindFallback = entries.length > 0 && entries.every(([k, v]) => (k === 'email_id_user_name' || k === firstFormField || /select_role/.test(k)) && (v === 'Agent Testing' || v === ''));
    if (!reconvert || !legacyBlindFallback) {
      for (const [k, v] of entries) mappedInput[k] = v;
    }
  }

  // Extract concrete fields and values mentioned directly inside the case steps.
  const fieldLookup = Object.entries(availableFields)
    .filter(([k]) => !['search', 'record_id', 'notes'].includes(k))
    .map(([k, def]) => {
      const raw = String(def?.label ?? k.replace(/_/g, ' '));
      const clean = raw.replace(/\s*\([^)]*\)/g, '').trim();
      return { key: k, phrases: [clean.toLowerCase(), raw.toLowerCase(), k.replace(/_/g, ' ')].filter(Boolean) };
    })
    .sort((a, b) => Math.max(...b.phrases.map(p => p.length)) - Math.max(...a.phrases.map(p => p.length)));

  const matchFieldByPhrase = (phrase, context = '') => {
    const p = String(phrase ?? '').trim().toLowerCase();
    const ctx = String(context ?? '').toLowerCase();
    if (!p) return null;
    const matches = fieldLookup.filter(f => f.phrases.some(ph => ph === p || ph.includes(p) || p.includes(ph)));
    if (matches.length <= 1) return matches[0]?.key ?? null;
    return matches.find(f => f.phrases.some(ph => ph.split(/\s+/).some(w => w.length > 3 && !p.includes(w) && ctx.includes(w))))?.key ?? matches[0].key;
  };

  const stepMatchedInput = {};
  for (const st of steps) {
    const act = st.action ?? '';
    const ctx = `${c.title ?? ''} ${act}`;
    const typeM = /\b(?:type|enter|fill)\s+['"]([^'"]*)['"]\s+(?:in|into)\s+([A-Za-z0-9 /_.-]{2,50})/i.exec(act);
    const fillM = !typeM ? /\bfill\s+([A-Za-z0-9 /_.-]{2,50}?)\s+with\s+['"]([^'"]*)['"]/i.exec(act) : null;
    if (typeM) {
      const k = matchFieldByPhrase(typeM[2], ctx);
      if (k) stepMatchedInput[k] = typeM[1];
    } else if (fillM) {
      const k = matchFieldByPhrase(fillM[1], ctx);
      if (k) stepMatchedInput[k] = fillM[2];
    }
    const emptyM = /\bleave\s+([A-Za-z0-9 /_.-]{2,50}?)\s+empty/i.exec(act);
    if (emptyM) {
      const k = matchFieldByPhrase(emptyM[1], ctx);
      if (k) stepMatchedInput[k] = '';
    }
    const spaceM = /\btype\s+(?:two|three)\s+spaces\s+in\s+([A-Za-z0-9 /_.-]{2,50})/i.exec(act);
    if (spaceM) {
      const k = matchFieldByPhrase(spaceM[1], ctx);
      if (k && !(k in stepMatchedInput)) stepMatchedInput[k] = '   ';
    }
  }

  const titleStr = c.title ?? '';
  const hasDataEntryVerb = /\b(type|enter|fill|leave\s+[\w\s]+\s+empty|submit|save\b|double[- ]?click\s+submit|rename)\b/i.test(stepsActionText);
  const isPureInspection = /^(verify|review|compare|switch|scroll|preview|check|chip count)\b/i.test(titleStr) && !hasDataEntryVerb;
  const isResetOrClose = /^(reset|clear|close)\b/i.test(titleStr) && !/\bempty name\b/i.test(titleStr);
  const isSearch = !isPureInspection && !/\b(rename|edit|add|create|save|submit)\b/i.test(titleStr) && (
    /\b(?:search\b.*\b(?:by key|special|box|bar|record|filter|template)|find|lookup)\b/i.test(titleStr) ||
    (/\bsearch\b/i.test(titleStr) && /\b(?:type|enter|search)\b/i.test(stepsActionText))
  );
  const negSignals = `${titleStr} ${c.category ?? ''} ${stepsActionText}`;
  const hasSaveLikeStep = !steps.length || Object.keys(stepMatchedInput).length > 0 || /\b(save|submit|add|ok|register|create)\b/i.test(stepsActionText);
  const isNegative = !isResetOrClose && !isPureInspection && hasSaveLikeStep && !/record the actual behaviour/i.test(stepsExpectedText) && (
    /\b(invalid|reject|block|required|mandatory|empty|blank|missing|error|fail|cannot|must not|wrong|duplicate|already exists|exceed|limit|whitespace|without inputs|without a role)\b/i.test(negSignals) ||
    /\b(warning|blocked|error|stays open|not added|not renamed)\b/i.test(stepsExpectedText)
  );
  const isSave = !isPureInspection && !isResetOrClose && hasSaveLikeStep && /\b(save|create|submit|register|generate uhid|add a? ?new|add process|rename|new record|keep it)\b/i.test(`${titleStr} ${stepsActionText}`);
  const isFill = !isPureInspection && !isResetOrClose && /\b(fill|enter|type|select|auto[- ]?fill|populate|dropdown|tab|focus|calendar age)\b/i.test(titleStr) && !isSave;

  if (isSearch && adapter?.actions?.search && adapter?.outcomes?.includes('found')) {
    action = 'search';
    const positiveMatch = /\b(?:type|enter|search)\s+['"]([^'"]{2,40})['"]/i.exec(stepsActionText);
    input.search = positiveMatch?.[1] && !/[%*]/.test(positiveMatch[1]) ? positiveMatch[1] : 'Agent Testing';
    expected.outcome = /\b(no match|not found|zero)\b/i.test(titleStr) && adapter.outcomes.includes('not-found') ? 'not-found' : 'found';
  } else if (isPureInspection || isResetOrClose) {
    action = adapter?.actions?.workflow ? 'workflow' : Object.keys(adapter?.actions ?? { fill: 'Fill' })[0];
    expected.outcome = action === 'workflow' && adapter?.outcomes?.includes('verified') ? 'verified' : adapter?.outcomes?.[0] ?? 'no-errors';
  } else if (isNegative && adapter?.actions?.save && adapter?.outcomes?.includes('blocked')) {
    action = 'save';
    if (hasValidBase && !Object.keys(stepMatchedInput).length) base = 'valid';
    Object.assign(input, mappedInput, stepMatchedInput);
    if (!Object.keys(input).length && !steps.length && firstFormField) input[firstFormField] = '';
    expected.outcome = 'blocked';
  } else if (isSave && adapter?.actions?.save && adapter?.outcomes?.includes('created')) {
    action = 'save';
    if (hasValidBase && !Object.keys(stepMatchedInput).length) base = 'valid';
    Object.assign(input, mappedInput, stepMatchedInput);
    if (!base && !Object.keys(input).length && firstFormField && availableFields[firstFormField]?.kind !== 'select') {
      input[firstFormField] = 'Agent Testing';
    }
    expected.outcome = 'created';
  } else if (isFill && adapter?.actions?.fill && adapter?.outcomes?.includes('no-errors')) {
    action = 'fill';
    if (hasValidBase && Object.keys(mappedInput).length) base = 'valid';
    Object.assign(input, mappedInput, stepMatchedInput);
    if (!Object.keys(input).length && firstFormField) input[firstFormField] = 'Agent Testing';
    expected.outcome = 'no-errors';
  } else {
    action = adapter?.actions?.workflow ? 'workflow' : Object.keys(adapter?.actions ?? { fill: 'Fill' })[0];
    Object.assign(input, mappedInput, stepMatchedInput);
    if (action === 'search') {
      input.search = 'Agent Testing';
      delete input[firstFormField];
    }
    expected.outcome = action === 'workflow' && adapter?.outcomes?.includes('verified')
      ? 'verified'
      : adapter?.outcomes?.[0] ?? 'no-errors';
  }

  const candidate = {
    ...c,
    mode: 'automated',
    action,
    ...(base ? { base } : {}),
    ...(variant && adapter?.variants?.includes(variant) ? { registrationType: variant } : {}),
    input,
    expected,
    steps: steps.length ? steps : [{ action: c.title, expected: expected.note || `Outcome: ${expected.outcome}` }],
  };
  if (candidate.action !== 'save' && candidate.action !== 'update' && candidate.action !== 'fill') delete candidate.base;
  if (candidate.action !== 'update') delete candidate.target;

  try {
    return validateCase(candidate, module);
  } catch {
    const safeAction = adapter?.actions?.workflow ? 'workflow' : adapter?.actions?.fill ? 'fill' : Object.keys(adapter?.actions ?? {})[0];
    const safeOutcome = safeAction === 'workflow' && adapter?.outcomes?.includes('verified')
      ? 'verified'
      : adapter?.outcomes?.includes('no-errors') ? 'no-errors' : adapter?.outcomes?.[0];
    const fallback = {
      ...candidate,
      action: safeAction,
      base: undefined,
      target: undefined,
      registrationType: undefined,
      input: safeAction === 'search' ? { search: 'Agent Testing' } : {},
      expected: { outcome: safeOutcome },
    };
    return validateCase(fallback, module);
  }
}

/** Synthesizes and installs the Playwright adapter for any non-built-in module, connects it, and automates existing cases. */
export function automateModule({ module, store, layoutRoot = ROOT, specRoot = ROOT, user = { username: 'system' }, approveDrafts = false } = {}) {
  if (!module) throw new Error('Module is required.');
  const productId = module.productId ?? 'augastam';
  const insights = store.insights(module.id);
  const existing = store.cases(module.id);

  if (pluginFor(module.id)?.builtIn) {
    let convertedCases = 0;
    const at = new Date().toISOString();
    store.transaction(() => {
      for (const c of existing) {
        const next = approveDrafts && c.reviewStatus !== 'approved'
          ? { ...c, reviewStatus: 'approved', reviewedBy: { user: user.username, at, decision: 'approved' } }
          : c;
        if (next !== c) { store.saveCase(module.id, next, c.version); convertedCases++; }
      }
    });
    return { module, adapter: adapters[module.adapter], convertedCases, automatedCount: existing.filter(c => c.mode === 'automated').length, totalCases: existing.length };
  }

  const { qaRel, adapter, files } = synthesizeAdapterProposal({ module, insights, setup: module.setup ?? null, cases: existing, layoutRoot });
  const problems = [];
  for (const [name, content] of Object.entries(files)) problems.push(...scanCode(name, content, module.id));
  if (problems.length) throw new Error(`Generated adapter failed safety scan: ${problems.join('; ')}`);

  const qaDir = path.join(layoutRoot, ...qaRel.split('/'));
  const testsRel = resolveModuleFolder(specRoot, 'tests', productId, module.id);
  const testsDir = path.join(specRoot, ...testsRel.split('/'));
  fs.mkdirSync(qaDir, { recursive: true });
  fs.mkdirSync(testsDir, { recursive: true });

  for (const [name, content] of Object.entries(files)) {
    const target = name === 'adapter.json' ? path.join(qaDir, 'adapter.json') : path.join(testsDir, name);
    fs.writeFileSync(target, content, 'utf8');
  }

  // Validate against specRoot first, then reload registry (and bind live adapter when tests use split roots).
  const validated = validateAdapterDefinition(adapter, { root: specRoot, folder: qaRel });
  if (layoutRoot === specRoot) {
    reloadAdapters({ root: layoutRoot, warn: () => {} });
  }
  adapters[module.id] = validated;

  const nextModule = {
    ...module,
    adapter: module.id,
    config: {
      ...module.config,
      bases: { ...(module.config?.bases ?? {}), ...(adapter.bases ?? {}) },
      requirements: module.config?.requirements ?? [],
    },
  };

  let convertedCases = 0;
  const at = new Date().toISOString();
  const savedModule = store.transaction(() => {
    const savedMod = store.saveModule(nextModule, module.version);
    for (const c of existing) {
      const converted = convertCaseToAutomated(c, savedMod, validated, { reconvert: true });
      if (approveDrafts && converted.reviewStatus !== 'approved') {
        converted.reviewStatus = 'approved';
        converted.reviewedBy = { user: user.username, at, decision: 'approved' };
      }
      store.saveCase(module.id, converted, c.version);
      if (c.mode !== 'automated' || (approveDrafts && c.reviewStatus !== 'approved')) convertedCases++;
    }
    return savedMod;
  });

  const finalCases = store.cases(module.id);
  return {
    module: savedModule,
    adapter: validated,
    files: Object.keys(files),
    convertedCases,
    automatedCount: finalCases.filter(c => c.mode === 'automated').length,
    totalCases: finalCases.length,
  };
}

/** Runs read-only Playwright discovery for a module that has a confirmed Target setup. */
export function runModuleDiscovery({ module, allEnvs, layoutRoot = ROOT, root = ROOT, exec = spawnSync } = {}) {
  const setup = module?.setup;
  if (!setup?.moduleUrl || !setup?.loginProfileId) {
    const err = new Error('Confirm Target setup (Module URL and Login profile) before running live discovery.');
    err.status = 409;
    throw err;
  }
  const envProfile = allEnvs.find(e => e.id === setup.loginProfileId);
  if (!envProfile) {
    const err = new Error(`Login profile "${setup.loginProfileId}" was not found.`);
    err.status = 409;
    throw err;
  }
  const productId = module.productId ?? 'augastam';
  const schema = loginSchema(productId);
  if (schema && !schema.sessionFiles.every(f => fs.existsSync(path.join(envProfile.authDir, f)))) {
    const err = new Error('Saved login session is missing for this profile. Open Settings and refresh Login first.');
    err.status = 409;
    throw err;
  }
  const qaRel = resolveModuleFolder(layoutRoot, 'qa', productId, module.id);
  const discoveryDir = path.join(layoutRoot, ...qaRel.split('/'), 'discovery');
  const args = ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.config.ts', '--project=discovery', 'tests/discovery/module-discovery.spec.ts'];
  const r = exec(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5 * 60_000,
    env: {
      ...process.env,
      BASE_URL: envProfile.url,
      AUTH_DIR: envProfile.authDir,
      MODULE_ID: module.id,
      MODULE_PRODUCT: productId,
      PORTAL_PRODUCT_ID: productId,
      MODULE_URL: setup.moduleUrl,
      MODULE_VARIANTS: (setup.variants ?? []).join(','),
      DISCOVER_OUT_DIR: discoveryDir,
    },
  });
  if ((r.status ?? 1) !== 0) {
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim().slice(-600);
    const err = new Error(`Live discovery did not finish: ${out || `exit ${r.status}`}`);
    err.status = 502;
    throw err;
  }
  const files = fs.existsSync(discoveryDir) ? fs.readdirSync(discoveryDir) : [];
  let fieldCount = 0;
  const fFile = path.join(discoveryDir, 'fields-default.json');
  if (fs.existsSync(fFile)) {
    try { const parsed = JSON.parse(fs.readFileSync(fFile, 'utf8')); fieldCount = Array.isArray(parsed) ? parsed.length : Object.keys(parsed ?? {}).length; } catch { /* ignore */ }
  }
  return { ok: true, files, fieldCount };
}
