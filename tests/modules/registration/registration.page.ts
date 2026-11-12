import { Locator, Page, Response, expect } from '@playwright/test';
import { FIELDS, FieldDef } from './fields';

export const REGISTRATION_WORKFLOW_ID = '1101f999-7c91-4ba5-a52b-a80d728c588e';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface SaveResult {
  /** Response of POST .../patient-registration/autogenerate, or null when Save never reached the server. */
  status: number | null;
  body: unknown;
  registrationId: string | null;
}

export class RegistrationPage {
  constructor(readonly page: Page) {}

  // ---------- navigation ----------

  /** Open a blank registration and wait until it is safe to Save (form schema + duplicate rules loaded). */
  async open() {
    const dupRules = this.page.waitForResponse((r) => r.url().includes('get-Duplicate-Rule-Configuration'), { timeout: 60_000 }).catch(() => null);
    await this.page.goto('/registration');
    await this.waitForForm();
    await dupRules;
  }

  async openExisting(uhrId: string) {
    const details = this.page.waitForResponse((r) => r.url().includes('/patient-registration/details/'), { timeout: 60_000 });
    await this.page.goto(`/registration/${REGISTRATION_WORKFLOW_ID}/${uhrId}`);
    await this.waitForForm();
    await details;
    // Values are written into the sections after the details response; give React a beat to render them.
    await expect(this.input('first_name')).not.toHaveValue('', { timeout: 20_000 });
  }

  async waitForForm() {
    await Promise.race([
      (async () => {
        await expect(this.page.locator('.registration-preview-loading')).toHaveCount(0, { timeout: 60_000 });
        await expect(this.input('first_name')).toBeVisible({ timeout: 60_000 });
      })(),
      this.page.getByText(/Your session has expired/i).waitFor({ state: 'visible', timeout: 60_000 }).then(() => {
        throw new Error('Application session expired. Run npm run auth in this project, then retry.');
      }),
    ]);
  }

  async selectRegistrationType(type: string) {
    const control = this.page.locator('.registration-type-select__control');
    if ((await control.innerText()).trim() === type) return;
    await control.click();
    await this.page.locator('.registration-type-select__option', { hasText: new RegExp(`^${esc(type)}$`) }).click();
    await this.confirmIfAsked();
    await this.waitForForm();
  }

  /** The if-then ConfirmModal ("Changing X will update Y. Continue?") appears for some selections. */
  async confirmIfAsked() {
    const yes = this.page.locator('.modal.show').getByRole('button', { name: 'Yes' });
    if (await yes.isVisible({ timeout: 1_000 }).catch(() => false)) await yes.click();
  }

  // ---------- locators ----------

  card(title: string): Locator {
    return this.page
      .locator('.registration-card')
      .filter({ has: this.page.locator('.registration-card-title', { hasText: title }) })
      .first();
  }

  /** The visible .form-group whose label is exactly `label` (optionally followed by "*"). */
  group(key: string): Locator {
    const f = this.def(key);
    return this.card(f.card)
      .locator('.form-group')
      .filter({ has: this.page.locator('label', { hasText: new RegExp(`^\\s*${esc(f.label)}\\s*\\*?\\s*$`) }) })
      .filter({ visible: true })
      .first();
  }

  input(key: string): Locator {
    const f = this.def(key);
    if (f.kind === 'checkbox') {
      return this.card(f.card).locator('label, div', { hasText: f.label }).locator('input[type=checkbox]').filter({ visible: true }).first();
    }
    if (f.kind === 'textarea') return this.group(key).locator('textarea').first();
    return this.group(key).locator('input:not([type=hidden])').first();
  }

  def(key: string): FieldDef {
    const f = FIELDS[key];
    if (!f) throw new Error(`Unknown field key "${key}". Add it to tests/modules/registration/fields.ts`);
    return f;
  }

  // ---------- filling ----------

  async set(key: string, value: string | boolean) {
    const f = this.def(key);
    const el = this.input(key);
    // Locator actions below scroll and retry automatically. A separate scroll
    // can hold a detached element while PIN cascades replace the form controls.
    switch (f.kind) {
      case 'checkbox':
        await el.setChecked(value === true || value === 'true' || value === 'yes');
        return;
      case 'select':
        return this.choose(key, String(value));
      case 'date':
        return this.setDate(key, String(value));
      case 'datetime':
        await el.fill(String(value));
        await el.press('Tab');
        return;
      default: {
        // Type like a user: several fields mask/strip input on keystrokes and validate on blur.
        await el.click();
        await el.fill('');
        const text = String(value);
        // Type like a user, except very long text: paste all but the last character, then type it
        // so key handlers still fire (typing 600 chars exceeds the action timeout).
        if (text.length > 80) {
          await el.fill(text.slice(0, -1));
          await el.pressSequentially(text.slice(-1));
        } else if (text !== '') await el.pressSequentially(text, { delay: 20 });
        if (key === 'pin_code') return this.afterPin(String(value));
        await el.press('Tab');
      }
    }
  }

  async choose(key: string, option: string) {
    // react-select hides the selected option from its menu, so re-choosing the default finds nothing.
    if ((await this.value(key)).toLowerCase() === option.toLowerCase()) return;
    const group = this.group(key);
    const control = group.locator('[class*="-control"]').first();
    await control.click();
    const typeable = group.locator('input[id^="react-select"]').first();
    if (await typeable.isEditable().catch(() => false)) await typeable.fill(option);
    // Menus are portalled to <body>; options can arrive late from the backend.
    const opt = this.page
      .locator('[id*="react-select"][id*="-option-"]')
      .filter({ hasText: new RegExp(`^\\s*${esc(option)}\\s*$`, 'i') })
      .first();
    await expect(opt, `option "${option}" in ${key}`).toBeVisible({ timeout: 20_000 });
    await opt.click();
    await this.confirmIfAsked();
  }

  /** DOB is a react-datepicker with a DD/MM/YYYY input mask: type digits, then close the picker. */
  async setDate(key: string, ddmmyyyy: string) {
    const el = this.input(key);
    await el.click();
    await el.fill('');
    if (ddmmyyyy) await el.pressSequentially(ddmmyyyy.replace(/\D/g, ''), { delay: 30 });
    await el.press('Escape');
    await el.press('Tab');
  }

  /** PIN lookup fires on the 6th digit with no debounce; wait for its response and for the spinner text to clear. */
  private async afterPin(pin: string) {
    const el = this.input('pin_code');
    if (/^\d{6}$/.test(pin)) {
      await this.page
        .waitForResponse((r) => r.url().includes('pincode-lookup'), { timeout: 30_000 })
        .catch(() => null);
    }
    await expect(this.group('pin_code')).not.toContainText('Looking up PIN code', { timeout: 30_000 });
    await el.press('Tab');
    // State -> district -> city cascade issues parent-lookup calls after the PIN result.
    await this.page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  }

  // ---------- reading ----------

  /** Visible value of a field. For dropdowns this is the selected option text ('' when only the placeholder shows). */
  async value(key: string): Promise<string> {
    const f = this.def(key);
    if (f.kind === 'checkbox') return String(await this.input(key).isChecked());
    if (f.kind === 'select') {
      const single = this.group(key).locator('[class*="singleValue"], [class*="multiValue"]');
      const text = (await single.count()) ? (await single.allInnerTexts()).join(', ').trim() : '';
      // Multilevel dropdowns render their placeholder ("State", "District", "Select") as a value.
      return new RegExp(`^(Select|${esc(f.label)})$`, 'i').test(text) ? '' : text;
    }
    return (await this.input(key).inputValue()).trim();
  }

  /** Hint / error text shown under a field: the group's text minus its label, selected value and placeholder. */
  async hint(key: string): Promise<string> {
    return this.group(key).evaluate((g) => {
      const label = (g.querySelector('label') as HTMLElement | null)?.innerText ?? '';
      const value = (g.querySelector('[class*="singleValue"], [class*="placeholder"]') as HTMLElement | null)?.innerText ?? '';
      let text = (g as HTMLElement).innerText;
      for (const part of [label, value]) if (part) text = text.replace(part, '');
      return text.replace(/^\s*\*/, '').replace(/\s+/g, ' ').trim();
    });
  }

  /** All visible field errors on the page, keyed by label. The red required "*" also uses .text-danger, so it is ignored. */
  async fieldErrors(): Promise<Record<string, string>> {
    return this.page.evaluate(() => {
      const out: Record<string, string> = {};
      document.querySelectorAll('.registration-card .form-group').forEach((g) => {
        if (!(g as HTMLElement).getBoundingClientRect().width) return;
        const msgs = [...g.querySelectorAll('.error-message, .text-danger, [class*="error"]')]
          .filter((e) => !e.closest('label'))
          .map((e) => (e as HTMLElement).innerText.trim())
          .filter((t) => t.length > 1);
        if (!msgs.length) return;
        const label = (g.querySelector('label') as HTMLElement | null)?.innerText.replace(/\*/g, '').trim() || '?';
        out[label] = [...new Set(msgs)].join(' | ');
      });
      return out;
    });
  }

  /** Texts of react-toastify toasts currently on screen. */
  async toasts(waitMs = 4_000): Promise<string[]> {
    const toast = this.page.locator('.Toastify__toast');
    await toast.first().waitFor({ state: 'visible', timeout: waitMs }).catch(() => undefined);
    return (await toast.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  async dismissToasts() {
    for (const close of await this.page.locator('.Toastify__close-button').all()) await close.click().catch(() => undefined);
  }

  async addressTab(tab: 'Current' | 'Permanent') {
    const card = this.card('Address Details');
    await card.getByRole('button', { name: new RegExp(`^${tab}( Address)?$`, 'i') }).click();
    await expect(this.input('address')).toBeVisible();
  }

  async closeQrIfOpen() {
    const modal = this.page.locator('.registration-qr-modal');
    if (await modal.isVisible()) {
      await modal.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(modal).toHaveCount(0);
    }
  }

  async addon(label: string) {
    await this.page.locator('.registration-addons-rail-list').getByRole('button', { name: label, exact: true }).click();
    const drawer = this.page.locator('.registration-drawer');
    await expect(drawer.locator('.registration-drawer-title')).toHaveText(label);
    return drawer;
  }

  async assertAgentRecord() {
    await expect(this.input('first_name'), 'Only synthetic Agent Testing records may be modified').toHaveValue('Agent');
    await expect(this.input('middle_name'), 'Only synthetic Agent Testing records may be modified').toHaveValue('Testing');
    await expect(this.input('last_name')).toHaveValue(/^User[A-Za-z]+$/);
  }

  // ---------- saving ----------

  saveButton(): Locator {
    return this.page.getByRole('button', { name: /^\s*(Save|Update|Saving…|Saving\.\.\.)\s*$/ }).first();
  }

  /** Click Save and report what reached the server (null status = the UI blocked the save), plus the
   *  toasts shown. Toasts auto-close after a few seconds, so they are read as soon as they appear. */
  async save(waitForServerMs = 15_000): Promise<SaveResult & { toasts: string[] }> {
    let response: Response | null = null;
    const resp = this.page
      .waitForResponse((r) => r.url().includes('/patient-registration/autogenerate') && r.request().method() === 'POST', { timeout: waitForServerMs })
      .then((r) => (response = r), () => null);
    const toast = this.page.locator('.Toastify__toast').first();
    const dialog = this.duplicateModal();
    await this.saveButton().click();
    // Whichever comes first: the server answer, a toast (validation or success), or the duplicate dialog.
    await Promise.race([
      resp,
      toast.waitFor({ state: 'visible', timeout: waitForServerMs }).catch(() => undefined),
      dialog.waitFor({ state: 'visible', timeout: waitForServerMs }).catch(() => undefined),
    ]);
    let toasts = await this.toasts(500);
    if (!response && !(await dialog.isVisible())) {
      // A validation toast means the request will never be sent; otherwise keep waiting for the server.
      await Promise.race([resp, this.page.waitForTimeout(toasts.length ? 3_000 : waitForServerMs)]);
    }
    if (response) toasts = [...new Set([...toasts, ...(await this.toasts(3_000))])];
    return { ...(await parseSave(response)), toasts };
  }

  /** Double-click Save (impatient user / slow network) and count how many create requests reach the server. */
  async saveDoubleClick(waitMs = 15_000): Promise<{ requests: number; ids: string[]; toasts: string[] }> {
    const bodies: Promise<unknown>[] = [];
    const onResp = (r: Response) => {
      if (r.url().includes('/patient-registration/autogenerate') && r.request().method() === 'POST') bodies.push(safeBody(r));
    };
    this.page.on('response', onResp);
    await this.saveButton().dblclick();
    await this.page.waitForTimeout(waitMs); // no single signal for "no further request will come"
    this.page.off('response', onResp);
    const ids = (await Promise.all(bodies)).filter((b): b is string => typeof b === 'string' && !!b && !b.startsWith('{'));
    return { requests: bodies.length, ids, toasts: await this.toasts(500) };
  }

  /** Update flow: Save/Update opens the "Update Registration" remarks modal; Submit sends PUT update-details. */
  async update(remarks: string, waitForServerMs = 20_000) {
    await this.saveButton().click();
    const modal = this.page.locator('.modal.show');
    // Validation (e.g. a bad phone) stops the update before the remarks dialog opens.
    const opened = await modal.filter({ hasText: 'Update Registration' }).waitFor({ timeout: 8_000 }).then(() => true, () => false);
    if (!opened) return { status: null, body: null, blocked: true, toasts: await this.toasts(500) };
    await modal.getByPlaceholder('Enter remarks').fill(remarks);
    const resp = this.page
      .waitForResponse((r) => r.url().includes('/patient-registration/update-details'), { timeout: waitForServerMs })
      .catch(() => null);
    await modal.getByRole('button', { name: 'Submit' }).click();
    const r = await resp;
    return { status: r?.status() ?? null, body: r ? await safeBody(r) : null, blocked: false, toasts: await this.toasts(3_000) };
  }

  /** "Duplicate Patients" dialog (live duplicate check) with Back / Register as New / Use Existing. */
  duplicateModal(): Locator {
    return this.page.getByText('Duplicate Patients', { exact: true }).filter({ visible: true }).first();
  }

  // ---------- search ----------

  async search(text: string) {
    const box = this.page.getByPlaceholder('Search Name/UHID/Phone').filter({ visible: true }).first();
    const resp = this.page
      .waitForResponse((r) => r.url().includes('get-all-patient-details'), { timeout: 30_000 })
      .catch(() => null);
    // The top-bar search swaps its input on focus, so locator.fill() targets a stale element;
    // type through the keyboard into whatever has focus, as a user would.
    await box.click();
    await this.page.keyboard.type(text, { delay: 30 });
    await this.page.keyboard.press('Enter');
    const r = await resp;
    const body = r ? await safeBody(r) : null;
    await this.page.waitForTimeout(1_000);
    const summary = await this.page.getByText(/\d+ records? found/).first().innerText().catch(() => '');
    return { status: r?.status() ?? null, body, summary, url: this.page.url() };
  }
}

async function safeBody(r: Response): Promise<unknown> {
  const text = await r.text().catch(() => '');
  try { return JSON.parse(text); } catch { return text; }
}

async function parseSave(r: Response | null): Promise<SaveResult> {
  if (!r) return { status: null, body: null, registrationId: null };
  const body = await safeBody(r);
  // Success returns the new registration number as a plain string. Errors come back as HTTP 200
  // with {statusCode: 409|500, message} in the body (known frontend bug: shown as success).
  const id = typeof body === 'string' && body && !body.startsWith('{') ? body.replace(/^"|"$/g, '') : null;
  return { status: r.status(), body, registrationId: id };
}
