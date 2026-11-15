import type { Page, TestInfo } from '@playwright/test';
import { captureEvidence } from '../../fixtures/evidence';
import { FIELDS, FILL_ORDER } from './fields';
import { MiracleRegistrationPage } from './miracle-registration.page';

let seqCounter = 101;
const SEQ_WORDS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];

function expandTokens(raw: string): string {
  const idx = seqCounter++;
  const word = SEQ_WORDS[idx % SEQ_WORDS.length];
  const d = new Date();
  const today = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  return raw
    .replace(/\{\{seqWord\}\}/g, word)
    .replace(/\{\{seq\}\}/g, String(idx))
    .replace(/\{\{phone\}\}/g, `98765${String(10000 + (idx % 89999)).padStart(5, '0')}`)
    .replace(/\{\{today\}\}/g, today);
}

export interface ModuleCase {
  id: string;
  title: string;
  category?: string;
  priority?: string;
  registrationType?: string;
  action: 'fill' | 'save' | 'update' | 'search' | 'workflow' | 'unavailable';
  base?: string;
  target?: string;
  enabled?: boolean;
  steps?: Array<{ action: string; expected: string }>;
  input: Record<string, string | boolean>;
  expected: {
    outcome: string;
    toastContains?: string;
    fieldErrors?: Record<string, string>;
    values?: Record<string, string>;
    persisted?: Record<string, string>;
    saveDisabled?: boolean;
    note?: string;
  };
}

export interface CaseResult {
  id: string;
  title: string;
  category: string;
  priority: string;
  status: 'PASS' | 'FAIL' | 'ERROR' | 'BLOCKED';
  verificationPerformed: boolean;
  expected: string;
  actual: string;
  mismatches: string[];
  toasts: string[];
  fieldErrors: Record<string, string>;
  values: Record<string, string>;
  durationMs: number;
}

export async function runCase(page: Page, c: ModuleCase, bases: Record<string, Record<string, string>>, info: TestInfo): Promise<CaseResult> {
  const started = Date.now();
  const pageErrors: string[] = [];
  const onError = (err: Error) => pageErrors.push(err.message);
  page.on('pageerror', onError);
  const mod = new MiracleRegistrationPage(page);
  const mismatches: string[] = [];
  const values: Record<string, string> = {};

  try {
    await mod.open(c.registrationType, c.category);
    await captureEvidence(page, info, c.id, 'Module opened');

    const rawBase = c.base ? bases[c.base] ?? {} : {};
    const baseInput: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(rawBase)) baseInput[k] = typeof v === 'string' ? expandTokens(v) : v;
    const caseInput: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(c.input ?? {})) caseInput[k] = typeof v === 'string' ? expandTokens(v) : v;
    const resolvedSteps = (c.steps ?? []).map((st) => ({ action: expandTokens(st.action), expected: expandTokens(st.expected) }));

    if (c.action === 'search') {
      const stepLog = resolvedSteps.length ? await mod.runSteps(resolvedSteps) : [];
      const q = String(caseInput.search ?? baseInput.search ?? '');
      const sr = await mod.search(q);
      if (!sr.searched && !stepLog.some((s) => s.performed)) mismatches.push('Search control was not found on the module page.');
      if (c.expected.outcome === 'not-found' && sr.matches > 0) mismatches.push(`Expected no search matches, found ${sr.matches}.`);
      if (c.expected.outcome === 'found' && sr.searched && sr.matches === 0 && !stepLog.some((s) => s.verified)) mismatches.push(`Expected search matches for "${q}", found 0.`);
    } else {
      const baseKeys = [...FILL_ORDER.filter((k) => k in baseInput && !(k in caseInput)), ...Object.keys(baseInput).filter((k) => !FILL_ORDER.includes(k) && !(k in caseInput))];
      for (const k of baseKeys) {
        await mod.set(k, baseInput[k]);
      }
      const appliedKeys = new Set<string>();
      const inputKeys = [...FILL_ORDER.filter((k) => k in caseInput), ...Object.keys(caseInput).filter((k) => !FILL_ORDER.includes(k))];
      for (const k of inputKeys) {
        if (k === 'search') { appliedKeys.add(k); continue; }
        if (await mod.set(k, caseInput[k])) appliedKeys.add(k);
      }
      const stepLog = resolvedSteps.length ? await mod.runSteps(resolvedSteps) : [];
      for (const k of inputKeys) {
        if (appliedKeys.has(k)) continue;
        const labelBase = (FIELDS[k]?.label ?? k.replace(/_/g, ' ')).replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
        const handledInStep = stepLog.some((s) => s.performed && labelBase && s.action.toLowerCase().includes(labelBase));
        if (handledInStep || (await mod.set(k, caseInput[k]))) appliedKeys.add(k);
        else mismatches.push(`Field control "${k}" was not found on the page.`);
      }
      if (c.action === 'save' || c.action === 'update') {
        const stepClickedSave = stepLog.some((s) => s.performed && /\b(save|submit|update|create|confirm|register|add|ok)\b/i.test(s.action));
        if (!stepClickedSave || c.expected.saveDisabled !== undefined) {
          const saveRes = await mod.save();
          if (c.expected.saveDisabled !== undefined && saveRes.disabled !== c.expected.saveDisabled) {
            mismatches.push(`Expected saveDisabled=${c.expected.saveDisabled}, actual ${saveRes.disabled}.`);
          } else if (!saveRes.clicked && !saveRes.disabled && !stepClickedSave) {
            mismatches.push('Save or Submit button was not found or could not be clicked on the page.');
          }
        }
      } else if (c.action === 'workflow' && stepLog.length > 0 && !stepLog.some((s) => s.performed || s.verified)) {
        mismatches.push('None of the expected workflow controls or screen elements were found on the page.');
      }
    }

    const errors = await mod.fieldErrors();
    const toasts = await mod.toasts();
    if ((c.expected.outcome === 'created' || c.expected.outcome === 'updated') && Object.keys(errors).length > 0) {
      mismatches.push(`Unexpected validation error on ${c.expected.outcome}: ${Object.values(errors).join(' | ')}`);
    }
    for (const [k, exp] of Object.entries(c.expected.values ?? {})) {
      values[k] = await mod.value(k);
      if (!values[k].toLowerCase().includes(exp.toLowerCase())) mismatches.push(`value.${k}: expected "${exp}", actual "${values[k]}"`);
    }
    for (const [k, exp] of Object.entries(c.expected.fieldErrors ?? {})) {
      const errText = Object.values(errors).join(' | ');
      if (!errText.toLowerCase().includes(exp.toLowerCase())) mismatches.push(`fieldError.${k}: expected "${exp}", actual "${errText || 'none'}"`);
    }
    if (c.expected.toastContains && !toasts.some((t) => t.toLowerCase().includes(c.expected.toastContains!.toLowerCase()))) {
      mismatches.push(`toast: expected substring "${c.expected.toastContains}", actual ${JSON.stringify(toasts)}`);
    }
    if (c.expected.outcome === 'blocked' && !Object.keys(errors).length && !toasts.some((t) => /required|invalid|error|fail|cannot|blocked/i.test(t))) {
      const saveBtn = await mod.saveButton();
      const isDis = saveBtn ? await saveBtn.isDisabled().catch(() => false) : false;
      if (!isDis) mismatches.push('Expected validation error, error alert, or disabled Save button.');
    }
    if (pageErrors.length) mismatches.push(`Uncaught page error: ${pageErrors[0]}`);
    await captureEvidence(page, info, c.id, 'After action');

    return {
      id: c.id,
      title: c.title,
      category: c.category ?? '',
      priority: c.priority ?? 'P2',
      status: mismatches.length ? 'FAIL' : 'PASS',
      verificationPerformed: true,
      expected: c.expected.note || c.expected.outcome,
      actual: mismatches.length ? mismatches.join('; ') : `Verified outcome: ${c.expected.outcome}`,
      mismatches,
      toasts,
      fieldErrors: errors,
      values,
      durationMs: Date.now() - started,
    };
  } finally {
    page.off('pageerror', onError);
  }
}
