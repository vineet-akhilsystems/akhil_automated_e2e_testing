import type { Locator, Page } from '@playwright/test';
import { FIELDS } from './fields';

const MODULE_PATH = "/PRegistration/Demographics.aspx";

export interface StepExecutionResult {
  action: string;
  expected: string;
  performed: boolean;
  verified: boolean;
}

export class MiracleRegistrationPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async open(variant?: string, section?: string): Promise<void> {
    await this.page.goto(MODULE_PATH, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle').catch(() => {});
    if (variant) await this.selectVariant(variant);
    if (section) await this.selectSection(section);
  }

  async selectVariant(variant: string): Promise<void> {
    const tab = this.page.getByRole('tab', { name: variant, exact: false }).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      return;
    }
    const btn = this.page.getByRole('button', { name: variant, exact: false }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      return;
    }
    const radio = this.page.getByLabel(variant, { exact: false }).first();
    if (await radio.isVisible().catch(() => false)) await radio.click();
  }

  async selectSection(section: string): Promise<boolean> {
    const clean = section.trim();
    if (clean.length < 2) return false;
    const navSelectors = [
      this.page.getByRole('tab', { name: clean, exact: false }).first(),
      this.page.locator('nav a, nav button, [data-section], [data-nav]').filter({ hasText: clean }).first(),
    ];
    for (const loc of navSelectors) {
      if (await loc.isVisible().catch(() => false)) {
        await loc.click().catch(() => {});
        await this.page.waitForTimeout(150);
        return true;
      }
    }
    return false;
  }

  private async controlFor(key: string): Promise<Locator | null> {
    const def = FIELDS[key];
    const rawLabel = def?.label ?? key.replace(/_/g, ' ');
    const shortLabel = rawLabel.replace(/\s*\([^)]*\)/g, '').trim();
    const labels = shortLabel && shortLabel !== rawLabel ? [rawLabel, shortLabel] : [rawLabel];
    const candidates: Locator[] = [];
    for (const label of labels) {
      candidates.push(this.page.getByLabel(label, { exact: false }).first());
      candidates.push(this.page.getByPlaceholder(label, { exact: false }).first());
    }
    if (def?.column) {
      candidates.push(this.page.locator(`[name="${def.column}"], [id="${def.column}"]`).first());
    }
    candidates.push(this.page.locator(`[name="${key}"], [id="${key}"]`).first());
    for (const loc of candidates) {
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    return null;
  }

  private async controlByLabel(rawLabel: string): Promise<Locator | null> {
    const clean = rawLabel.trim();
    if (!clean) return null;
    const norm = clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (FIELDS[norm]) {
      const found = await this.controlFor(norm);
      if (found) return found;
    }
    const byFieldLabel = Object.entries(FIELDS).find(([, def]) =>
      def.label.toLowerCase() === clean.toLowerCase() || def.label.toLowerCase().includes(clean.toLowerCase())
    );
    if (byFieldLabel) {
      const found = await this.controlFor(byFieldLabel[0]);
      if (found) return found;
    }
    const candidates: Locator[] = [
      this.page.getByLabel(clean, { exact: false }).first(),
      this.page.getByPlaceholder(clean, { exact: false }).first(),
      this.page.getByRole('textbox', { name: clean, exact: false }).first(),
      this.page.getByRole('combobox', { name: clean, exact: false }).first(),
      this.page.locator(`[aria-label*="${clean.replace(/"/g, '')}" i], [data-field*="${norm}"]`).first(),
    ];
    for (const loc of candidates) {
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    return null;
  }

  private async applyControl(loc: Locator, val: string | boolean): Promise<boolean> {
    const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'input');
    const type = await loc.getAttribute('type').catch(() => '');
    if (typeof val === 'boolean' || type === 'checkbox') {
      const checked = Boolean(val);
      if (checked) await loc.check().catch(() => loc.click());
      else await loc.uncheck().catch(() => {});
      return true;
    }
    const text = String(val ?? '');
    if (tag === 'select') {
      if (text) await loc.selectOption({ label: text }).catch(() => loc.selectOption(text)).catch(() => {});
      else await loc.selectOption({ index: 0 }).catch(() => {});
      return true;
    }
    await loc.click().catch(() => {});
    await loc.fill(text);
    const role = await loc.getAttribute('role').catch(() => '');
    if (role === 'combobox' && text) {
      const opt = this.page.getByRole('option', { name: text, exact: false }).first();
      if (await opt.isVisible().catch(() => false)) await opt.click();
      else await loc.press('Enter').catch(() => {});
    }
    return true;
  }

  async set(key: string, val: string | boolean): Promise<boolean> {
    const loc = await this.controlFor(key);
    if (!loc) return false;
    return this.applyControl(loc, val);
  }

  async setByLabel(label: string, val: string | boolean): Promise<boolean> {
    const loc = await this.controlByLabel(label);
    if (!loc) return false;
    return this.applyControl(loc, val);
  }

  async clickTarget(target: string, doubleClick = false): Promise<boolean> {
    const clean = target.trim().replace(/[.:;,]+$/, '');
    if (clean.length < 2) return false;
    const candidates: Locator[] = [
      this.page.getByRole('button', { name: clean, exact: false }).first(),
      this.page.getByRole('tab', { name: clean, exact: false }).first(),
      this.page.getByRole('link', { name: clean, exact: false }).first(),
      this.page.getByRole('checkbox', { name: clean, exact: false }).first(),
      this.page.getByRole('radio', { name: clean, exact: false }).first(),
      this.page.locator('[data-chip], .chip, button, [role="button"], a').filter({ hasText: clean }).first(),
    ];
    for (const loc of candidates) {
      if (await loc.isVisible().catch(() => false)) {
        if (doubleClick) await loc.dblclick().catch(() => loc.click());
        else await loc.click().catch(() => {});
        await this.page.waitForTimeout(150);
        return true;
      }
    }
    return false;
  }

  async value(key: string): Promise<string> {
    const loc = await this.controlFor(key);
    if (!loc) return '';
    const type = await loc.getAttribute('type').catch(() => '');
    if (type === 'checkbox') return (await loc.isChecked().catch(() => false)) ? 'true' : 'false';
    return (await loc.inputValue().catch(() => loc.innerText().catch(() => ''))).trim();
  }

  async fieldErrors(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const errs = this.page.locator('.invalid-feedback, .field-error, .error-message, [aria-invalid="true"]');
    const count = await errs.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 20); i++) {
      const el = errs.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const msg = (await el.innerText().catch(() => '')).trim();
      if (msg) out[`error_${i + 1}`] = msg;
    }
    return out;
  }

  async toasts(): Promise<string[]> {
    const items: string[] = [];
    const loc = this.page.locator('.Toastify__toast, .toast, [role="alert"], [role="status"], .alert');
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 10); i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const t = (await el.innerText().catch(() => '')).trim();
      if (t) items.push(t);
    }
    return items;
  }

  async saveButton(): Promise<Locator | null> {
    for (const label of ['Save Stage', 'Save', 'Submit', 'Update', 'Create', 'Confirm', 'Register', 'Add', 'OK', 'Apply Setting', 'Import']) {
      const btn = this.page.getByRole('button', { name: new RegExp(label, 'i') }).first();
      if (await btn.isVisible().catch(() => false)) return btn;
    }
    const submit = this.page.locator('button[type="submit"], input[type="submit"]').first();
    return (await submit.isVisible().catch(() => false)) ? submit : null;
  }

  async save(): Promise<{ clicked: boolean; disabled: boolean }> {
    const btn = await this.saveButton();
    if (!btn) return { clicked: false, disabled: false };
    if (await btn.isDisabled().catch(() => false)) return { clicked: false, disabled: true };
    await btn.click();
    await this.page.waitForTimeout(300);
    return { clicked: true, disabled: false };
  }

  async search(query: string): Promise<{ searched: boolean; matches: number }> {
    const candidates: Array<Locator | null> = [
      await this.controlFor('search'),
      this.page.getByRole('searchbox').first(),
      this.page.getByPlaceholder(/search|filter|key|template/i).first(),
      this.page.locator('input[type="search"], input[placeholder*="Search" i]').first(),
    ];
    let box: Locator | null = null;
    for (const c of candidates) {
      if (c && (await c.isVisible().catch(() => false))) { box = c; break; }
    }
    if (!box) return { searched: false, matches: 0 };
    await box.fill(query);
    await box.press('Enter').catch(() => {});
    await this.page.waitForTimeout(300);
    const itemLoc = this.page.locator('table tbody tr, [role="row"]:not(thead tr), [data-chip], .chip, .template-chip, .field-row, [data-field-row]');
    const rawCount = await itemLoc.count().catch(() => 0);
    let visibleMatches = 0;
    for (let i = 0; i < Math.min(rawCount, 60); i++) {
      if (await itemLoc.nth(i).isVisible().catch(() => false)) visibleMatches++;
    }
    return { searched: true, matches: visibleMatches };
  }

  private expectedHints(expectedText: string): string[] {
    const hints: string[] = [];
    for (const m of expectedText.matchAll(/["']([^"']{2,60})["']/g)) hints.push(m[1]);
    for (const m of expectedText.matchAll(/\b[A-Za-z]+_[A-Za-z0-9_.]+\b/g)) hints.push(m[0]);
    for (const m of expectedText.matchAll(/\b[A-Z][A-Za-z0-9/?-]{1,}(?:\s+(?:[A-Z][A-Za-z0-9/?-]{1,}|&|of|by)){0,2}/g)) {
      const s = m[0].trim();
      if (!/^(The|Only|Same|Each|Record|Rows|Chips|Columns|No|None|If|With|On|In|An)$/i.test(s)) hints.push(s);
    }
    for (const m of expectedText.matchAll(/\b(welcome|header|menu|language|settings|notification|logout|dialog|asterisk|mandatory|checkbox|dropdown|filter|template|stage|process|task|preview|alias|visit|doctor|admin)\b/gi)) {
      hints.push(m[1]);
    }
    return [...new Set(hints)].slice(0, 14);
  }

  async runSteps(steps: Array<{ action: string; expected: string }> = []): Promise<StepExecutionResult[]> {
    const log: StepExecutionResult[] = [];
    for (const st of steps) {
      let performed = false;
      const act = st.action || '';
      const typeMatch = /\b(?:type|enter|fill)\s+['"]([^'"]*)['"]\s+(?:in|into)\s+([A-Za-z0-9 /_.-]{2,50})/i.exec(act);
      const fillMatch = !typeMatch ? /\bfill\s+([A-Za-z0-9 /_.-]{2,50}?)\s+with\s+['"]([^'"]*)['"]/i.exec(act) : null;
      const bareType = !typeMatch && !fillMatch ? /\b(?:type|enter)\s+['"]([^'"]+)['"]/i.exec(act) : null;
      if (typeMatch) {
        if (await this.setByLabel(typeMatch[2], typeMatch[1])) performed = true;
      } else if (fillMatch) {
        if (await this.setByLabel(fillMatch[1], fillMatch[2])) performed = true;
      } else if (bareType) {
        for (const sel of [
          '[role="dialog"]:not(.hidden) input:not([type="checkbox"]):not([type="radio"]):not([type="search"])',
          'section.active input:not([type="checkbox"]):not([type="radio"]):not([type="search"])',
          'input:not([type="checkbox"]):not([type="radio"]):not([type="search"])',
        ]) {
          const inp = this.page.locator(sel).first();
          if (await inp.isVisible().catch(() => false)) { await inp.fill(bareType[1]); performed = true; break; }
        }
      }
      const leaveEmpty = /\bleave\s+([A-Za-z0-9 /_.-]{2,50}?)\s+empty/i.exec(act);
      if (leaveEmpty && (await this.setByLabel(leaveEmpty[1], ''))) performed = true;
      const spacesMatch = /\btype\s+(?:two|three)\s+spaces\s+in\s+([A-Za-z0-9 /_.-]{2,50})/i.exec(act);
      if (spacesMatch && (await this.setByLabel(spacesMatch[1], '   '))) performed = true;
      const pickMatch = /\b(?:pick|select|choose)\s+(?:a\s+(\w+)(?:\s+(?:in|from)\s+(?:the\s+)?([A-Za-z0-9 /_.-]{2,40}))?|['"]?([^'"]+?)['"]?\s+(?:in|from)\s+(?:the\s+)?([A-Za-z0-9 /_.-]{2,40}))/i.exec(act);
      if (pickMatch) {
        const genericNoun = pickMatch[1];
        const rawTarget = (pickMatch[2] || pickMatch[4] || genericNoun || '').replace(/\s+dropdown$/i, '').replace(/\.+$/, '').trim();
        const desired = pickMatch[3];
        let loc = !/\bstage\b/i.test(rawTarget) && ((!pickMatch[2] && !pickMatch[4]) || /^select role$/i.test(rawTarget))
          ? this.page.locator('[role="dialog"]:not(.hidden) select').first()
          : null;
        if (loc && !(await loc.isVisible().catch(() => false))) loc = null;
        if (!loc && rawTarget) loc = await this.controlByLabel(rawTarget);
        if (!loc && genericNoun) {
          for (const sel of ['[role="dialog"]:not(.hidden) select', 'section.active select', 'select']) {
            const cand = this.page.locator(sel).first();
            if (await cand.isVisible().catch(() => false)) { loc = cand; break; }
          }
        }
        if (loc && (await loc.isVisible().catch(() => false))) {
          if (desired && !/^a\s+/i.test(desired)) performed = await this.applyControl(loc, desired);
          else {
            const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
            if (tag === 'select') {
              const optCount = await loc.locator('option').count().catch(() => 0);
              if (optCount > 1) { await loc.selectOption({ index: 1 }).catch(() => {}); performed = true; }
              else if (optCount === 1) { await loc.selectOption({ index: 0 }).catch(() => {}); performed = true; }
            }
          }
        }
      }
      if (/\bclear\s+(?:the\s+)?box\b/i.test(act)) {
        const box = this.page.getByPlaceholder(/search|filter|key|template/i).first();
        if (await box.isVisible().catch(() => false)) { await box.fill(''); performed = true; }
      }
      const isDbl = /\bdouble[-\s]?click\b/i.test(act);
      const quoted = /["']([^"']{2,60})["']/.exec(act)?.[1];
      if (quoted && !typeMatch && !fillMatch && !bareType) {
        if (await this.clickTarget(quoted, isDbl)) performed = true;
      }
      for (const m of act.matchAll(/\b(?:click|open|switch(?:\s+to)?|toggle|press)(?:\s+on)?\s+(?:the\s+)?(?:dialog\s+|tab\s+|button\s+|chip\s+|header\s+)?([A-Za-z0-9 +/_.-]{2,40}?)(?=\s+(?:once|twice|again|quickly|under\b|beside\b|at\b|on\b|with\b|without\b|button|tab|chip|control|dialog|and\b)|[.,;]|$)/gi)) {
        if (await this.clickTarget(m[1], isDbl)) performed = true;
      }
      if (!performed && !/^(?:inspect|look|review|compare|verify)\b|\bwithout\s+confirming\b/i.test(act.trim()) && /\b(save|submit|confirm|export|add)\b/i.test(act)) {
        const res = await this.save();
        performed = res.clicked || res.disabled;
      }
      const bodyText = (await this.page.locator('body').innerText().catch(() => '')).toLowerCase();
      const hints = this.expectedHints(st.expected || '');
      const verified = hints.length > 0 ? hints.some((h) => bodyText.includes(h.toLowerCase())) : performed;
      log.push({ action: act, expected: st.expected, performed, verified });
    }
    return log;
  }
}
