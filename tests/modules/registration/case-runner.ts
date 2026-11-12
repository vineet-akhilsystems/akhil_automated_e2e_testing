import fs from 'fs';
import path from 'path';
import { Page, TestInfo } from '@playwright/test';
import { FIELDS, FILL_ORDER } from './fields';
import { RegistrationPage, SaveResult } from './registration.page';
import { moduleDir } from '../../shared/module-paths';
import { captureEvidence } from '../../fixtures/evidence';
import { runWorkflow } from './workflow-runner';

export interface RegCase {
  id: string;
  title: string;
  category?: string;
  priority?: string;
  registrationType?: string;
  action: 'fill' | 'save' | 'saveTwice' | 'saveDoubleClick' | 'search' | 'update' | 'workflow' | 'unavailable';
  base?: string;
  target?: string;
  enabled?: boolean;
  notes?: string;
  automationBlocker?: string;
  sourceWorkbook?: string;
  steps?: { action: string; expected: string }[];
  input: Record<string, string | boolean>;
  expected: {
    outcome: string;
    toastContains?: string;
    fieldErrors?: Record<string, string>;
    values?: Record<string, string>;
    hints?: Record<string, string>;
    persisted?: Record<string, string>;
    saveDisabled?: boolean;
    assumed?: boolean;
    note?: string;
  };
}

export interface CaseResult {
  id: string;
  title: string;
  category: string;
  priority: string;
  status: 'PASS' | 'FAIL' | 'FAIL (assumed requirement)' | 'OBSERVED' | 'SKIPPED' | 'ERROR' | 'BLOCKED';
  verificationPerformed?: boolean;
  expected: string;
  actual: string;
  mismatches: string[];
  registrationId?: string | null;
  toasts: string[];
  fieldErrors: Record<string, string>;
  values: Record<string, string>;
  resolvedInput?: Record<string, string | boolean>;
  serverResponse?: unknown;
  note?: string;
  durationMs: number;
}

// ---------------- tokens ----------------

const SEQ_FILE = process.env.PORTAL_RUN_DIR
  ? path.join(process.env.PORTAL_RUN_DIR, 'agent-seq.json')
  : `${moduleDir('qa', 'registration')}/data/agent-seq.json`;
/** Per-run folder (id from tests/global-setup.ts) so concurrent Playwright processes cannot clobber it. */
export const RUNS_DIR = process.env.PORTAL_RUN_DIR ?? `${moduleDir('qa', 'registration')}/results/runs`;
const RUN_DIR = path.join(RUNS_DIR, process.env.REG_RUN_ID ?? 'adhoc');
/** Values produced by earlier cases (registration ids, phones) for later cases. A file, because
 *  Playwright restarts the worker after every failed test. */
export const SHARED_FILE = path.join(RUN_DIR, 'shared-values.json');
/** One JSON line per finished case, written immediately so an interrupted run still has its results
 *  (`npm run reg:report` rebuilds the report from the newest run). */
export const RUN_FILE = path.join(RUN_DIR, 'results.jsonl');

export function recordResult(r: CaseResult) {
  fs.mkdirSync(path.dirname(RUN_FILE), { recursive: true });
  fs.appendFileSync(RUN_FILE, JSON.stringify(r) + '\n');
}

const readShared = (): Record<string, Record<string, string>> =>
  fs.existsSync(SHARED_FILE) ? JSON.parse(fs.readFileSync(SHARED_FILE, 'utf8')) : {};

function saveShared(caseId: string, values: Record<string, string>) {
  const all = readShared();
  all[caseId] = { ...all[caseId], ...values };
  fs.mkdirSync(path.dirname(SHARED_FILE), { recursive: true });
  fs.writeFileSync(SHARED_FILE, JSON.stringify(all, null, 2));
}

function nextSeq(): number {
  const cur = fs.existsSync(SEQ_FILE) ? JSON.parse(fs.readFileSync(SEQ_FILE, 'utf8')).next ?? 1 : 1;
  fs.mkdirSync(path.dirname(SEQ_FILE), { recursive: true });
  fs.writeFileSync(SEQ_FILE, JSON.stringify({ next: cur + 1, note: 'Agent Testing User<N> counter' }, null, 2));
  return cur;
}

let phoneCounter = 0;
function uniquePhone(): string {
  // Valid Indian mobile: 10 digits starting 6-9. Time-based so reruns do not collide.
  const t = String(Date.now()).slice(-6);
  const shard = Number(process.env.PORTAL_SHARD_INDEX ?? 0) % 10;
  return `9${t.slice(0, 5)}${shard}${String(phoneCounter++ % 1000).padStart(3, '0')}`.slice(0, 10);
}

const pad = (n: number) => String(n).padStart(2, '0');

// Name fields on demo strip digits ("User3" is saved as "User"), so the agent number is spelled out: UserThree.
const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
export function numberWord(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ONES[n % 10] : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]}Hundred${n % 100 ? numberWord(n % 100) : ''}`;
  return `${numberWord(Math.floor(n / 1000))}Thousand${n % 1000 ? numberWord(n % 1000) : ''}`;
}

export function renderCase(c: RegCase, bases: Record<string, Record<string, string>>): { input: Record<string, string | boolean>; expected: RegCase['expected']; vars: Record<string, string> } {
  const d = new Date();
  const seq = nextSeq();
  const vars: Record<string, string> = {
    seq: String(seq),
    seqWord: numberWord(seq),
    phone: uniquePhone(),
    phone2: uniquePhone(),
    today: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
  };
  const sub = (v: unknown): any => {
    if (typeof v !== 'string') return v;
    return v.replace(/\{\{(\w+)(?:@([\w-]+))?\}\}/g, (m, name, ref) => {
      if (ref) {
        const val = readShared()[ref]?.[name];
        if (val === undefined) throw new Error(`Case ${c.id} needs {{${name}@${ref}}} but ${ref} did not produce it (did it fail?)`);
        return val;
      }
      if (name === 'first' || name === 'second') return m; // resolved at select time
      return vars[name] ?? m;
    });
  };
  const merged = { ...(c.base ? bases[c.base] ?? {} : {}), ...c.input };
  const input = Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, sub(v)]));
  const exp = JSON.parse(JSON.stringify(c.expected ?? {}), (_k, v) => sub(v));
  return { input, expected: exp, vars };
}

// ---------------- filling ----------------

export async function fillForm(reg: RegistrationPage, input: Record<string, string | boolean>) {
  if (input.id_proof_file) throw new Error('ID-proof upload automation is not connected yet. Use a manual case for this workflow.');
  const keys = Object.keys(input).filter((k) => k !== 'search' && k !== 'id_proof_file');
  const ordered = [...FILL_ORDER.filter((k) => keys.includes(k)), ...keys.filter((k) => !FILL_ORDER.includes(k))];
  for (const key of ordered) {
    const v = input[key];
    if (v === '' || v === undefined) {
      // Clear only text-like fields; dropdown/date defaults are left alone unless a value is given.
      if (['text', 'textarea'].includes(FIELDS[key]?.kind)) await reg.set(key, '');
      if (FIELDS[key]?.kind === 'date') await reg.setDate(key, '');
      if (FIELDS[key]?.kind === 'datetime') await reg.set(key, '');
      continue;
    }
    // With an empty PIN, choosing District/City/Area starts the reverse lookup (400 ms debounce, then
    // up to 3 pincode-lookup calls); wait for it so the PIN is read after it lands.
    const reverse = ['district', 'city', 'area'].includes(key) && !(await reg.value('pin_code').catch(() => 'x'))
      ? reg.page.waitForResponse((r) => r.url().includes('pincode-lookup'), { timeout: 8_000 }).catch(() => null)
      : null;
    if (v === '{{first}}' || v === '{{second}}') await chooseNth(reg, key, v === '{{first}}' ? 0 : 1);
    else await reg.set(key, v);
    if (reverse) {
      await reverse;
      await reg.page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
    }
  }
}

async function chooseNth(reg: RegistrationPage, key: string, n: number) {
  const group = reg.group(key);
  await group.scrollIntoViewIfNeeded();
  const options = reg.page.locator('[id*="react-select"][id*="-option-"]').filter({ hasNotText: /^(Select|None)$/ });
  // Cascading options (e.g. Area after a PIN lookup) are replaced asynchronously; a menu opened too
  // early shows "No options" and does not refresh, so close and reopen it.
  for (let attempt = 0; attempt < 4; attempt++) {
    await group.locator('[class*="-control"]').first().click();
    if (await options.nth(n).waitFor({ timeout: 5_000 }).then(() => true, () => false)) {
      await options.nth(n).click();
      await reg.confirmIfAsked();
      return;
    }
    await reg.page.keyboard.press('Escape');
  }
  throw new Error(`No selectable options in ${key} after 4 attempts`);
}

async function readValues(reg: RegistrationPage, keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = await reg.value(k).catch((e) => `<unreadable: ${String(e.message).split('\n')[0]}>`);
  return out;
}

async function readHints(reg: RegistrationPage, keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = await reg.hint(k).catch(() => '');
  return out;
}

// ---------------- comparing ----------------

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function matches(actual: string | undefined, expected: string): boolean {
  const a = norm(actual ?? '');
  if (expected === '*') return a.length > 0;
  if (expected === '') return a.length === 0 || a === 'select' || a === 'none';
  if (expected.startsWith('~')) return a.includes(norm(expected.slice(1)));
  return a === norm(expected);
}

function compareMap(kind: string, exp: Record<string, string> | undefined, act: Record<string, string>, contains = false): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(exp ?? {})) {
    const ok = contains ? norm(act[k] ?? '').includes(norm(v)) : matches(act[k], v);
    if (!ok) out.push(`${kind}.${k}: expected ${contains ? 'to contain ' : ''}"${v}", got "${act[k] ?? ''}"`);
  }
  return out;
}

function errorsByKey(errors: Record<string, string>): Record<string, string> {
  // Map label-keyed errors back to field keys so cases can say fieldErrors.mobile.
  const out: Record<string, string> = {};
  for (const [key, def] of Object.entries(FIELDS)) {
    const hit = Object.entries(errors).find(([label]) => norm(label) === norm(def.label));
    if (hit) out[key] = hit[1];
  }
  return out;
}

// ---------------- running ----------------

export function blockedCaseResult(c: RegCase): CaseResult {
  const source = JSON.parse(fs.readFileSync(`${moduleDir('qa', 'registration')}/cases/registration-workbook-automation.json`, 'utf8')).cases.find((source: RegCase) => source.id === c.id);
  if (c.action !== 'unavailable' || source?.action !== 'unavailable' || c.automationBlocker !== source.automationBlocker) throw new Error('No reviewed automation blocker exists for this case.');
  return { id: c.id, title: c.title, category: c.category ?? '', priority: c.priority ?? '', status: 'BLOCKED', verificationPerformed: false,
    expected: (c.steps ?? []).map(step => step.expected).join('\n'), actual: `NOT AUTOMATED — ${source.automationBlocker} No application assertions executed.`,
    mismatches: [], toasts: [], fieldErrors: {}, values: {}, durationMs: 0 };
}

export async function runCase(page: Page, c: RegCase, bases: Record<string, Record<string, string>>, info: TestInfo): Promise<CaseResult> {
  if (c.action === 'unavailable') return blockedCaseResult(c);
  if (c.expected.saveDisabled !== undefined && c.action !== 'update') throw new Error('Update-button assertions require the Update action.');
  if (c.action === 'search' && (['values', 'fieldErrors', 'hints', 'persisted'].some(k => Object.keys((c.expected as any)[k] ?? {}).length) || c.expected.toastContains)) {
    throw new Error('Search cases support outcome checks only.');
  }
  const started = Date.now();
  const reg = new RegistrationPage(page);
  const { input, expected, vars } = renderCase(c, bases);
  saveShared(c.id, vars);

  const r: CaseResult = {
    id: c.id, title: c.title, category: c.category ?? '', priority: c.priority ?? '',
    status: 'PASS', expected: describeExpected(expected), actual: '', mismatches: [],
    toasts: [], fieldErrors: {}, values: {}, resolvedInput: input, note: expected.note, durationMs: 0,
  };
  let outcome = '';
  let persistedChecked = false;

  if (c.action === 'workflow') {
    if (c.target) {
      // renderCase substitutes dependency tokens in expected/input, not target.
      const target = String(c.target).replace(/\{\{regId@([\w-]+)\}\}/g, (_m, ref) => {
        const value = readShared()[ref]?.regId;
        if (!value) throw new Error(`Missing saved registration from ${ref}`);
        return value;
      });
      await reg.openExisting(target);
      r.registrationId = target;
      await reg.closeQrIfOpen();
    } else await reg.open();
    await captureEvidence(page, info, c.id, 'Workflow opened');
    try {
      await runWorkflow(reg, String(input.workflow), input, info, c.id, fillForm);
      outcome = 'verified';
      r.actual = `Verified registration workflow: ${input.workflow}`;
    } catch (e: any) {
      if (!e.matcherResult) throw e;
      outcome = 'assertion-failed';
      r.actual = `Workflow assertion failed: ${String(e.message).replace(/\u001b\[[0-9;]*m/g, '')}`;
      r.mismatches.push(r.actual);
      await captureEvidence(page, info, c.id, 'Workflow assertion failure');
    }
  } else if (c.action === 'search') {
    await reg.open();
    await captureEvidence(page, info, c.id, 'Module opened');
    const s = await reg.search(String(input.search));
    await captureEvidence(page, info, c.id, 'Search results');
    const n = Number(s.summary.match(/(\d+)/)?.[1] ?? NaN);
    const navigated = /\/registration\/[^/]+\/[^/]+/.test(s.url);
    const bodyText = JSON.stringify(s.body ?? '');
    if (s.status === null || s.status >= 400 || /"statusCode":\s*(4|5)\d\d/.test(bodyText)) outcome = 'error';
    else if (navigated || n > 0) outcome = 'found';
    else if (n === 0) outcome = 'not-found';
    else outcome = 'unknown';
    r.serverResponse = { status: s.status, summary: s.summary, url: s.url };
    r.actual = `${outcome} (${navigated ? 'opened single match' : s.summary || 'no summary text'})`;
    if (expected.outcome === 'no-error') outcome = outcome === 'error' ? 'error' : 'no-error';
  } else if (c.action === 'update') {
    const target = String(c.target ?? '').replace(/\{\{regId@([\w-]+)\}\}/, (_m, ref) => {
      const id = readShared()[ref]?.regId;
      if (!id) throw new Error(`${c.id} needs the registration id from ${ref}, which did not create a patient.`);
      return id;
    });
    await reg.openExisting(target);
    // Never edit a real patient: refuse before any change unless the opened record is a synthetic Agent Testing one.
    if (Object.keys(input).length) await reg.assertAgentRecord();
    await captureEvidence(page, info, c.id, 'Record opened');
    const disabledBefore = await reg.saveButton().isDisabled();
    if (expected.saveDisabled !== undefined && disabledBefore !== expected.saveDisabled) {
      r.mismatches.push(`saveDisabled: expected ${expected.saveDisabled}, got ${disabledBefore}`);
    }
    if (Object.keys(input).length) await fillForm(reg, input);
    await captureEvidence(page, info, c.id, 'Inputs applied');
    r.values = await readValues(reg, Object.keys(expected.values ?? {}));
    r.mismatches.push(...compareMap('value', expected.values, r.values));
    const updateHints = await readHints(reg, Object.keys(expected.hints ?? {}));
    r.mismatches.push(...compareMap('hint', expected.hints, updateHints, true));
    if (Object.keys(input).length) {
      const u = await reg.update(`Agent testing ${c.id}: automated update`);
      await captureEvidence(page, info, c.id, 'After update');
      r.serverResponse = { status: u.status, body: u.body };
      r.toasts = u.toasts;
      r.fieldErrors = await reg.fieldErrors();
      outcome = u.blocked
        ? 'blocked'
        : u.status === 200 && /success/i.test(JSON.stringify(u.body)) ? 'updated' : `update failed (${u.status})`;
      if (outcome === 'updated' && expected.persisted) {
        persistedChecked = true;
        await reg.openExisting(target);
        await captureEvidence(page, info, c.id, 'Saved record verification');
        const got = await readValues(reg, Object.keys(expected.persisted));
        r.mismatches.push(...compareMap('persisted', expected.persisted, got));
      }
    } else outcome = 'field-state';
    r.actual = `${outcome}; Update button ${disabledBefore ? 'disabled' : 'enabled'} before changes${r.toasts.length ? `; toast: ${r.toasts.join(' / ')}` : ''}${Object.keys(r.fieldErrors).length ? `; errors ${JSON.stringify(r.fieldErrors)}` : ''}`;
    r.registrationId = target;
  } else {
    // fill | save | saveTwice
    await reg.open();
    if (c.registrationType) await reg.selectRegistrationType(c.registrationType);
    await captureEvidence(page, info, c.id, 'Module opened');
    if (c.action === 'fill' && expected.outcome === 'no-errors') {
      r.fieldErrors = await reg.fieldErrors();
      outcome = Object.keys(r.fieldErrors).length ? 'errors shown' : 'no-errors';
    } else {
      await fillForm(reg, input);
    }
    await captureEvidence(page, info, c.id, 'Inputs applied');
    const checkKeys = [...new Set([...Object.keys(expected.values ?? {}), ...Object.keys(input).filter((k) => FIELDS[k])])];
    r.values = await readValues(reg, checkKeys);
    const hints = await readHints(reg, Object.keys(expected.hints ?? {}));
    r.mismatches.push(...compareMap('value', expected.values, r.values));
    r.mismatches.push(...compareMap('hint', expected.hints, hints, true));
    if (Object.keys(hints).length) r.values = { ...r.values, ...Object.fromEntries(Object.entries(hints).map(([k, v]) => [`hint:${k}`, v])) };

    if (c.action === 'saveDoubleClick') {
      const d = await reg.saveDoubleClick();
      await captureEvidence(page, info, c.id, 'After double save');
      r.toasts = d.toasts;
      r.serverResponse = d;
      r.registrationId = d.ids.join(', ') || null;
      r.fieldErrors = await reg.fieldErrors();
      outcome = d.ids.length === 1 ? 'created-once' : d.ids.length > 1 ? `created-${d.ids.length}-records` : 'not-created';
      r.actual = `${d.requests} create request(s), ${d.ids.length} record(s): ${d.ids.join(', ') || 'none'}`;
    } else if (c.action === 'fill') {
      if (!outcome) outcome = 'field-state';
      r.fieldErrors = { ...r.fieldErrors, ...(await reg.fieldErrors()) };
      r.actual = `values ${JSON.stringify(r.values)}${Object.keys(r.fieldErrors).length ? `; errors ${JSON.stringify(r.fieldErrors)}` : ''}`;
    } else {
      let save = await reg.save();
      await captureEvidence(page, info, c.id, 'After save');
      if (c.action === 'saveTwice') {
        const first = save;
        r.registrationId = first.registrationId;
        await info.attach(`${c.id}-first-save.json`, { body: JSON.stringify(first, null, 2), contentType: 'application/json' });
        await reg.open();
        if (c.registrationType) await reg.selectRegistrationType(c.registrationType);
        await fillForm(reg, input);
        await captureEvidence(page, info, c.id, 'Before second save');
        save = await reg.save();
        await captureEvidence(page, info, c.id, 'After second save');
      }
      r.toasts = save.toasts;
      r.fieldErrors = await reg.fieldErrors();
      const dupModal = await reg.duplicateModal().isVisible().catch(() => false);
      outcome = classifySave(save, r.toasts, dupModal);
      if (c.action !== 'saveTwice') r.registrationId = save.registrationId;
      r.serverResponse = { status: save.status, body: save.body };
      if (save.registrationId) {
        saveShared(c.id, { regId: save.registrationId, phone: String(input.mobile ?? vars.phone) });
      }
      r.actual = `${outcome}${save.registrationId ? ` (UHID ${save.registrationId})` : ''}${dupModal && save.registrationId ? '; Duplicate Patients dialog was also shown' : ''}${r.toasts.length ? `; toast: ${r.toasts.join(' / ')}` : ''}${Object.keys(r.fieldErrors).length ? `; errors ${JSON.stringify(r.fieldErrors)}` : ''}`;

      if (outcome === 'created' && expected.persisted && save.registrationId) {
        persistedChecked = true;
        await reg.openExisting(save.registrationId);
        await captureEvidence(page, info, c.id, 'Saved record verification');
        const got = await readValues(reg, Object.keys(expected.persisted));
        r.values = { ...r.values, ...Object.fromEntries(Object.entries(got).map(([k, v]) => [`saved:${k}`, v])) };
        r.mismatches.push(...compareMap('persisted', expected.persisted, got));
      }
    }
  }

  if (c.action !== 'search' && c.action !== 'workflow') {
    r.fieldErrors = { ...r.fieldErrors, ...(await reg.fieldErrors()) };
    r.mismatches.push(...compareMap('fieldError', expected.fieldErrors, errorsByKey(r.fieldErrors), true));
    if (expected.toastContains && !r.toasts.some(t => norm(t).includes(norm(expected.toastContains!)))) {
      r.mismatches.push(`toast: expected to contain "${expected.toastContains}", got ${JSON.stringify(r.toasts)}`);
    }
  }
  if (Object.keys(expected.persisted ?? {}).length && !persistedChecked) {
    r.mismatches.push('persisted: no successfully saved record was available to verify the requested values');
  }
  if (expected.outcome !== 'observe' && outcome !== expected.outcome && !(expected.outcome === 'field-state' && outcome === 'field-state')) {
    r.mismatches.unshift(`outcome: expected "${expected.outcome}", got "${outcome}"`);
  }
  r.status = expected.outcome === 'observe' ? 'OBSERVED' : r.mismatches.length ? (expected.assumed ? 'FAIL (assumed requirement)' : 'FAIL') : 'PASS';
  r.durationMs = Date.now() - started;
  return r;
}

function classifySave(save: SaveResult, toasts: string[], dupModal: boolean): string {
  // A saved record wins: the live duplicate dialog can be on screen while the save still goes through.
  if (save.registrationId) return 'created';
  if (dupModal) return 'duplicate-warning';
  if (save.status === null) return 'blocked';
  const body = save.body as any;
  if (body && typeof body === 'object' && [409].includes(body.statusCode)) {
    // Server rejected as duplicate; flag if the UI still shows a success toast.
    return toasts.some((t) => /registration number/i.test(t)) ? 'rejected-but-shown-as-success' : 'duplicate-warning';
  }
  return `rejected (${body?.statusCode ?? save.status}: ${body?.message ?? ''})`.trim();
}

function describeExpected(e: RegCase['expected']): string {
  const parts = [e.outcome];
  if (e.toastContains) parts.push(`toast contains "${e.toastContains}"`);
  if (e.values) parts.push(`values ${JSON.stringify(e.values)}`);
  if (e.hints) parts.push(`hints ${JSON.stringify(e.hints)}`);
  if (e.fieldErrors) parts.push(`errors ${JSON.stringify(e.fieldErrors)}`);
  if (e.persisted) parts.push(`saved ${JSON.stringify(e.persisted)}`);
  if (e.saveDisabled !== undefined) parts.push(`Update button ${e.saveDisabled ? 'disabled' : 'enabled'}`);
  if (e.assumed) parts.push('(assumed requirement)');
  return parts.join('; ');
}
