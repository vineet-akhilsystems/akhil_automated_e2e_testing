import fs from 'node:fs';
import path from 'node:path';
import { expect, type TestInfo } from '@playwright/test';
import { RegistrationPage } from './registration.page';
import { captureEvidence } from '../../fixtures/evidence';

// Calendar-age expectation for the workbook's day-accuracy requirement.
export function calendarAge(birth: Date, today: Date): string {
  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  let days = today.getDate() - birth.getDate();
  if (days < 0) {
    months--;
    days += new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  }
  if (months < 0) { years--; months += 12; }
  return `${years}Y ${months}M ${days}D`;
}

type Fill = (reg: RegistrationPage, input: Record<string, string | boolean>) => Promise<void>;
export async function runWorkflow(reg: RegistrationPage, flow: string, input: Record<string, string | boolean>, info: TestInfo, id: string, fill: Fill) {
  const page = reg.page;
  const evidence = (stage: string) => captureEvidence(page, info, id, stage);
  switch (flow) {
    case 'new-reset':
      await reg.set('first_name', 'Agent');
      await reg.set('middle_name', 'Testing');
      await reg.set('last_name', 'UserUnsaved');
      await evidence('Unsaved patient');
      await page.getByRole('button', { name: 'New', exact: true }).click();
      await reg.confirmIfAsked();
      await reg.waitForForm();
      await expect(reg.input('first_name')).toHaveValue('');
      await expect(reg.input('last_name')).toHaveValue('');
      await expect(reg.saveButton()).toHaveText(/Save/);
      break;
    case 'keyboard-fields': {
      await reg.input('first_name').focus();
      await page.keyboard.press('Tab');
      await expect(reg.input('middle_name')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(reg.input('last_name')).toBeFocused();
      const field = reg.input('marital_status');
      await field.focus();
      await page.keyboard.press('ArrowDown');
      const options = page.locator('[id*="react-select"][id*="-option-"]');
      await expect(options.first()).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect.poll(() => reg.value('marital_status')).not.toBe('');
      break;
    }
    case 'title-gender':
      for (const [title, gender] of [['Mr.', 'Male'], ['Mrs.', 'Female']]) {
        await reg.set('title', title);
        await expect.poll(() => reg.value('gender')).toBe(gender);
        await evidence(`${title} selects ${gender}`);
      }
      break;
    case 'dropdown-keyboard': {
      const field = reg.input('marital_status');
      await field.focus();
      await field.press('ArrowDown');
      await expect(page.getByRole('option').first()).toBeVisible();
      expect(await page.getByRole('option').count(), 'Keyboard fixture requires at least two configured options').toBeGreaterThan(1);
      await field.press('ArrowDown');
      const down = await field.getAttribute('aria-activedescendant');
      expect(down, 'Down arrow identifies a focused option').toBeTruthy();
      await field.press('ArrowUp');
      await expect.poll(() => field.getAttribute('aria-activedescendant')).not.toBe(down);
      await field.press('ArrowDown');
      await expect.poll(() => field.getAttribute('aria-activedescendant')).toBe(down);
      const label = (await page.locator(`[id="${down}"]`).filter({ visible: true }).first().innerText()).trim();
      await field.press('Enter');
      await expect.poll(() => reg.value('marital_status')).toBe(label);
      break;
    }
    case 'mandatory-tab-traversal': {
      const required = await page.locator('.registration-card .form-group').evaluateAll(groups => groups.flatMap(group => {
        if (!(group as HTMLElement).getBoundingClientRect().width) return [];
        const label = group.querySelector('label')?.textContent ?? '';
        if (!label.includes('*')) return [];
        const controls = [...group.querySelectorAll('input:not([type=hidden]), select, textarea')];
        if (!controls.some(control => !(control as HTMLInputElement).disabled && (control as HTMLElement).tabIndex >= 0 && (control as HTMLElement).getBoundingClientRect().width)) return [];
        const card = group.closest('.registration-card')?.querySelector('.registration-card-title')?.textContent?.trim();
        return [`${card}|${label.replace(/\*/g, '').replace(/\s+/g, ' ').trim()}`];
      }));
      expect(required.length, 'Discover configured, visible, enabled mandatory fields').toBeGreaterThan(0);
      expect(new Set(required).size, 'Mandatory controls have unambiguous card/label identities').toBe(required.length);
      await reg.input('title').focus();
      const visited: string[] = [];
      for (let step = 0; step < 150; step++) {
        const focused = await page.evaluate(() => {
          const group = document.activeElement?.closest('.form-group');
          if (!group) return '';
          const card = group.closest('.registration-card')?.querySelector('.registration-card-title')?.textContent?.trim();
          const label = group.querySelector('label')?.textContent?.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
          return `${card}|${label}`;
        });
        if (required.includes(focused) && visited.at(-1) !== focused) visited.push(focused);
        if (visited.length >= required.length) break;
        await page.keyboard.press('Tab');
      }
      await info.attach('Mandatory field keyboard traversal', { body: JSON.stringify({ expected: required, visited }, null, 2), contentType: 'application/json' });
      expect(visited, 'Tab reaches every enabled mandatory field in visible form order').toEqual(required);
      break;
    }
    case 'pin-autofill':
      await reg.addressTab('Current');
      // This fixture has one configured area. 110001 has multiple areas and
      // legitimately asks the user to choose one instead of auto-selecting it.
      await reg.set('pin_code', '110004');
      for (const [key, value] of Object.entries({ country: 'India', state: 'DELHI', city: 'NEW DELHI', area: 'Rashtrapati Bhawan' })) {
        await expect.poll(() => reg.value(key), `PIN auto-fills ${key}`).toBe(value);
      }
      await expect.poll(() => reg.value('area'), 'Workbook requires Area to auto-populate without manual selection').not.toBe('');
      break;
    case 'country-mobile-code':
      await reg.addressTab('Current');
      for (const [country, code] of [['Australia', '+61'], ['India', '+91']]) {
        await reg.set('country', country);
        await expect.poll(() => reg.value('country')).toBe(country);
        await reg.input('mobile').click();
        await expect.poll(async () => {
          const box = await reg.input('mobile').boundingBox();
          if (!box) return '';
          // Prefix chips are portalled to body, outside their labelled group.
          // Match the chip over this input so WhatsApp's code cannot satisfy it.
          return page.locator('.registration-mobile-code').evaluateAll((elements, box) => elements.filter(el => {
            const rect = el.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
            return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
          }).map(el => el.textContent?.trim()).join('|'), box);
        }, `${country} sets the primary mobile input code`).toBe(code);
        await evidence(`${country} selects mobile code ${code}`);
      }
      break;
    case 'partial-name-suggestions': {
      await reg.assertAgentRecord();
      const prefix = (await reg.value('first_name')).slice(0, 3);
      const peer = String(input.peer);
      expect(peer, 'Second synthetic search prerequisite exists').toBeTruthy();
      await reg.openExisting(peer);
      await reg.assertAgentRecord();
      expect((await reg.value('first_name')).slice(0, 3)).toBe(prefix);
      await reg.open();
      const url = page.url();
      const search = page.getByPlaceholder('Search Name/UHID/Phone').filter({ visible: true }).first();
      await search.click();
      const pending = page.waitForResponse(response => response.url().includes('get-all-patient-details'), { timeout: 30_000 });
      await page.keyboard.type(prefix, { delay: 50 });
      const response = await pending;
      expect(response.ok(), 'Partial-name lookup request succeeds without pressing Enter').toBe(true);
      const suggestions = page.locator('.hover-effect').filter({ visible: true });
      await expect.poll(() => suggestions.count(), 'At least two matching synthetic name suggestions appear').toBeGreaterThan(1);
      for (const text of await suggestions.allInnerTexts()) expect(text.toLowerCase()).toContain(prefix.toLowerCase());
      await expect(page).toHaveURL(url);
      break;
    }
    case 'photo-upload': {
      await reg.assertAgentRecord();
      const target = page.url().split('/').pop()!;
      const field = page.locator('.reg-photo-field');
      await field.locator('input[type=file]').setInputFiles(path.resolve('qa/modules/registration/data/agent-test-photo.png'));
      const photo = field.locator('img.reg-photo-img');
      await expect(photo).toBeVisible();
      await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      const before = await photo.screenshot();
      await evidence('Synthetic patient photo uploaded');
      const result = await reg.update(`Agent Testing ${id}: verify photo persistence`);
      expect(result.blocked).toBe(false);
      expect(result.status !== null && result.status >= 200 && result.status < 300, 'Saving patient photo succeeds').toBe(true);
      await reg.openExisting(target);
      await expect(photo).toBeVisible();
      await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      expect((await photo.screenshot()).equals(before), 'Reopened patient displays the uploaded photo, not a placeholder or a different image').toBe(true);
      break;
    }
    case 'dob-age': {
      // Use the browser's date so the assertion follows the application's timezone.
      const now = await page.evaluate(() => [new Date().getFullYear(), new Date().getMonth(), new Date().getDate()]);
      const today = new Date(now[0], now[1], now[2]);
      for (const [day, month, year] of [[15, 8, 1990], [29, 2, 2000], [now[2], now[1] + 1, now[0]]]) {
        const date = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
        await reg.setDate('dob', date);
        await expect(reg.input('dob')).toHaveValue(date);
        await expect.poll(() => reg.value('age')).toBe(calendarAge(new Date(year, month - 1, day), today));
        await evidence(`Age for ${date}`);
      }
      break;
    }
    case 'address-copy': {
      await reg.addressTab('Current');
      await fill(reg, { pin_code: '110001', area: '{{first}}', address: 'Agent Testing current address' });
      const keys = ['country', 'pin_code', 'state', 'district', 'city', 'area', 'address'];
      const values = Object.fromEntries(await Promise.all(keys.map(async key => [key, await reg.value(key)])));
      await reg.set('mark_permanent', true);
      await reg.addressTab('Permanent');
      for (const key of keys) await expect.poll(() => reg.value(key), `Copied ${key}`).toBe(values[key]);
      await evidence('Copied Permanent Address');
      break;
    }
    case 'address-independent':
      await reg.set('mark_permanent', false);
      await reg.addressTab('Current');
      await reg.set('address', 'Agent Testing current address');
      await reg.addressTab('Permanent');
      await reg.set('address', 'Agent Testing permanent address');
      await reg.addressTab('Current');
      await expect(reg.input('address')).toHaveValue('Agent Testing current address');
      await reg.addressTab('Permanent');
      await expect(reg.input('address')).toHaveValue('Agent Testing permanent address');
      break;
    case 'payer-reset':
      await reg.set('payer_type', 'Corporate');
      await reg.set('payer_type', 'Self-Paid');
      for (const key of ['payer', 'sponsor']) {
        await expect.poll(() => reg.value(key)).toBe('Cash');
        await expect(reg.input(key)).toBeDisabled();
      }
      break;
    case 'insurance-payer-reset':
      await reg.set('payer_type', 'Insurance');
      await expect.poll(() => reg.value('payer_type')).toBe('Insurance');
      await evidence('Insurance selected before switching payer type');
      await reg.set('payer_type', 'Self-Paid');
      await expect.poll(() => reg.value('payer_type')).toBe('Self-Paid');
      for (const key of ['payer', 'sponsor']) {
        await expect.poll(() => reg.value(key)).toBe('Cash');
        await expect(reg.input(key)).toBeDisabled();
      }
      break;
    case 'pin-clear':
      await reg.addressTab('Current');
      await reg.set('pin_code', '110001');
      for (const key of ['state', 'district', 'city']) {
        await expect.poll(() => reg.value(key), `PIN lookup populates ${key}`).not.toBe('');
      }
      await evidence('PIN lookup populated address hierarchy');
      await reg.set('pin_code', '');
      await expect(reg.input('pin_code')).toHaveValue('');
      await evidence('PIN cleared; verify address hierarchy is reset');
      await expect.poll(async () => Object.fromEntries(await Promise.all(
        ['state', 'district', 'city'].map(async key => [key, await reg.value(key)]))),
      'Clearing PIN clears State, District and City').toEqual({ state: '', district: '', city: '' });
      break;
    case 'new-reset-address':
      await reg.set('first_name', 'Agent');
      await reg.addressTab('Current');
      await fill(reg, { pin_code: '110001', address: 'Agent Testing unsaved address' });
      await reg.set('mark_permanent', true);
      await reg.addressTab('Permanent');
      await expect(reg.input('address')).toHaveValue('Agent Testing unsaved address');
      await evidence('Unsaved current and copied permanent address');
      await page.getByRole('button', { name: 'New', exact: true }).click();
      await reg.confirmIfAsked();
      await reg.waitForForm();
      await expect(reg.input('first_name')).toHaveValue('');
      for (const tab of ['Current', 'Permanent'] as const) {
        await reg.addressTab(tab);
        await expect(reg.input('pin_code')).toHaveValue('');
        await expect(reg.input('address')).toHaveValue('');
        for (const key of ['state', 'district', 'city']) {
          await expect.poll(() => reg.value(key), `New clears ${tab} ${key}`).toBe('');
        }
      }
      expect(await reg.fieldErrors(), 'Reset form must not show stale validation errors').toEqual({});
      break;
    case 'duplicate-mobile-alert':
    case 'duplicate-explicit-check':
    case 'duplicate-use-existing': {
      await reg.assertAgentRecord();
      const target = page.url().split('/').pop()!;
      const keys = ['title', 'first_name', 'middle_name', 'last_name', 'gender', 'dob', 'mobile', 'pin_code', 'address'];
      const values: Record<string, string> = {};
      for (const key of keys) values[key] = await reg.value(key);
      const name = values.last_name, mobile = values.mobile;
      await reg.open();
      if (flow === 'duplicate-mobile-alert') await reg.set('mobile', mobile);
      else await fill(reg, { ...values, mark_permanent: true });
      await evidence('Matching synthetic patient details entered');
      let creates = 0;
      const onRequest = (request: import('@playwright/test').Request) => {
        if (request.method() === 'POST' && request.url().includes('/patient-registration/autogenerate')) creates++;
      };
      page.on('request', onRequest);
      try {
        if (flow === 'duplicate-explicit-check') {
          const check = page.getByRole('button', { name: /^Check Duplicates?$/i });
          await expect(check, 'Workbook requires an explicit Check Duplicate action').toBeVisible();
          await check.click();
        } else if (flow === 'duplicate-use-existing') await reg.save();
        await expect(reg.duplicateModal(), flow === 'duplicate-mobile-alert' ? 'Entering an existing mobile must show a duplicate alert before Save' : 'Matching details must show a duplicate prompt').toBeVisible();
        const modal = page.locator('[role="dialog"], .modal.show, .registration-duplicate-modal').filter({ has: reg.duplicateModal() }).last();
        await expect(modal, 'Duplicate prompt must identify the prerequisite patient').toContainText(target);
        await expect(modal).toContainText(name);
        await evidence('Duplicate prompt identifies the synthetic patient');
        const row = modal.locator('tr').filter({ hasText: target });
        await expect(row).toHaveCount(1);
        await row.getByRole('radio').check();
        await modal.getByRole('button', { name: /^Use Existing(?: Patient)?$/ }).click();
        await reg.waitForForm();
        await expect(page).toHaveURL(new RegExp(`/registration/[^/]+/${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
        await expect(reg.input('last_name')).toHaveValue(name);
        await expect(reg.input('mobile')).toHaveValue(mobile);
        expect(creates, 'Use Existing must not create another registration').toBe(0);
      } finally { page.off('request', onRequest); }
      break;
    }
    case 'newborn-fields':
      await reg.selectRegistrationType('New Born Registration');
      await expect(reg.input('mother_uhid')).toBeVisible();
      for (const [key, value] of Object.entries({ weight_kg: '3.2', height_cm: '49', delivery_date: '2026-11-01T10:30' })) {
        await reg.set(key, value);
        await expect(reg.input(key)).toHaveValue(value);
      }
      await reg.set('delivery_type', 'Normal');
      await expect.poll(() => reg.value('delivery_type')).toBe('Normal');
      break;
    case 'staff-fields':
      await reg.selectRegistrationType('Staff Registration');
      await expect(reg.input('staff_details')).toBeVisible();
      await reg.set('dependants', 'Son');
      await expect.poll(() => reg.value('dependants')).toBe('Son');
      break;
    case 'document-gate':
    case 'notes-gate': {
      const label = flow === 'document-gate' ? 'Patient Document' : 'Notes';
      const drawer = await reg.addon(label);
      await expect(drawer).toContainText(/Save the registration first/);
      await drawer.locator('.registration-drawer-close').click();
      await expect(drawer).not.toBeInViewport();
      break;
    }
    case 'addon-shells':
      for (const label of ['Worklist', 'Insurance Details', 'Bulk Registration', 'Merge Registration', 'Notes', 'Patient Document', 'Consent Form']) {
        const drawer = await reg.addon(label);
        await expect(drawer.locator('.registration-drawer-body')).not.toBeEmpty();
        await evidence(`${label} drawer shell only`);
        await drawer.locator('.registration-drawer-close').click();
        await expect(drawer).not.toBeInViewport();
      }
      break;
    case 'search-identity': {
      const target = page.url().split('/').pop()!;
      const expected: Record<string, string> = {};
      for (const key of ['first_name', 'middle_name', 'last_name', 'mobile', 'dob', 'address']) expected[key] = await reg.value(key);
      await reg.open();
      const result = await reg.search(target);
      expect(result.status !== null && result.status >= 200 && result.status < 300, 'UHID search request must succeed').toBe(true);
      await expect(page).toHaveURL(new RegExp(`/registration/[^/]+/${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
      for (const [key, value] of Object.entries(expected)) await expect.poll(() => reg.value(key), `UHID search populates ${key}`).toBe(value);
      break;
    }
    case 'update-remarks':
    case 'update-persist': {
      await reg.assertAgentRecord();
      const before = await reg.value('email');
      const email = String(input.email || `agent.workflow.${Date.now()}@example.com`);
      await reg.set('email', email);
      if (flow === 'update-persist') {
        const target = page.url().split('/').pop()!;
        const result = await reg.update(`Agent Testing ${id}: verify email persistence`);
        expect(result.blocked).toBe(false);
        expect(result.status).toBe(200);
        expect(JSON.stringify(result.body)).toMatch(/success/i);
        await reg.openExisting(target);
        await expect(reg.input('email')).toHaveValue(email);
      } else {
        const target = page.url().split('/').pop()!;
        await reg.saveButton().click();
        const modal = page.locator('.modal.show').filter({ hasText: 'Update Registration' });
        const submit = modal.getByRole('button', { name: 'Submit', exact: true });
        await expect(submit).toBeDisabled();
        await modal.getByPlaceholder('Enter remarks').fill('   ');
        await expect(submit).toBeDisabled();
        await modal.getByPlaceholder('Enter remarks').fill('Agent Testing canceled update');
        await expect(submit).toBeEnabled();
        await evidence('Remarks validation');
        await modal.getByRole('button', { name: 'Close', exact: true }).click();
        await reg.openExisting(target);
        await expect(reg.input('email')).toHaveValue(before);
      }
      break;
    }
    case 'active-cancel': {
      await reg.assertAgentRecord();
      const toggle = page.locator('.registration-active-toggle');
      const before = await toggle.innerText();
      const target = page.url().split('/').pop()!;
      await toggle.getByRole('button').click();
      const modal = page.locator('.modal.show').filter({ hasText: /Mark as (In)?active/i });
      await expect(modal.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
      await modal.getByPlaceholder('Enter remarks').fill('   ');
      await expect(modal.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
      await modal.getByRole('button', { name: 'Close', exact: true }).click();
      await reg.openExisting(target);
      await expect(toggle).toHaveText(before);
      break;
    }
    case 'print-card':
    case 'print-form-complete':
    case 'print-form': {
      const target = page.url().split('/').pop()!;
      const surname = await reg.value('last_name');
      const cardValues = flow === 'print-card' ? await Promise.all(['first_name', 'last_name', 'mobile', 'gender'].map(key => reg.value(key))) : [];
      const formValues: Record<string, string> = {};
      if (flow === 'print-form-complete') {
        for (const key of ['title', 'first_name', 'middle_name', 'last_name', 'gender', 'dob', 'mobile', 'country', 'pin_code', 'state', 'district', 'city', 'area', 'address', 'payer_type', 'payer', 'sponsor']) {
          const value = await reg.value(key);
          if (value) formValues[key] = value;
        }
      }
      // Desktop prints through a short-lived hidden iframe; mobile uses a popup.
      // Capture the actual HTML only when the app invokes print, before either
      // surface disappears. Do not require a popup or open an OS printer dialog.
      const documents: string[] = [];
      const binding = `__registrationPrint_${id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      await page.context().exposeBinding(binding, (_source, html: string) => { documents.push(html); });
      const install = (name: string) => {
        const originalPrint = window.print, append = Node.prototype.appendChild;
        window.print = () => { void (window as any)[name](document.documentElement.outerHTML); };
        Node.prototype.appendChild = function<T extends Node>(this: Node, node: T): T {
          if (node instanceof HTMLIFrameElement) node.addEventListener('load', () => {
            // document.write can replace the iframe document after init scripts.
            // Capture phase runs before the application's onload print handler.
            try {
              const frame = node.contentWindow;
              if (frame) frame.print = () => { void (window as any)[name](frame.document.documentElement.outerHTML); };
            } catch { /* Unrelated cross-origin frame, not the print document. */ }
          }, true);
          return append.call(this, node) as T;
        };
        (window as any)[`${name}_restore`] = () => { window.print = originalPrint; Node.prototype.appendChild = append; };
      };
      await page.context().addInitScript(install, binding);
      await page.evaluate(install, binding);
      const popups: import('@playwright/test').Page[] = [];
      const onPopup = (popup: import('@playwright/test').Page) => { popups.push(popup); };
      page.on('popup', onPopup);
      let output: import('@playwright/test').Page | undefined;
      try {
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        await page.locator('.registration-print-menu').getByRole('button', { name: flow === 'print-card' ? 'Card' : 'Form', exact: true }).click();
        await expect.poll(() => documents.length, 'Application invokes print with a generated document').toBeGreaterThan(0);
        const html = info.outputPath('registration-print.html');
        fs.writeFileSync(html, documents[0]);
        await info.attach('Generated registration print document', { path: html, contentType: 'text/html' });
        output = await page.context().newPage();
        await output.setContent(documents[0]);
        await captureEvidence(output, info, id, 'Print output identity and contents');
        await expect(output.locator('body')).toContainText(target);
        await expect(output.locator('body')).toContainText(surname);
        for (const value of cardValues) {
          expect(value, 'Saved synthetic patient has print-card identity data').toBeTruthy();
          await expect(output.locator('body')).toContainText(value);
        }
        if (flow === 'print-form-complete') {
          const text = await output.locator('body').innerText();
          const missing = Object.entries(formValues).filter(([key, value]) => {
            if (key === 'mobile' || key === 'pin_code') return !text.replace(/\D/g, '').includes(value.replace(/\D/g, ''));
            if (key === 'dob') {
              const [day, month, year] = value.split('/');
              return ![value, `${day}-${month}-${year}`, `${year}-${month}-${day}`].some(date => text.includes(date));
            }
            if (key === 'gender') return !new RegExp(`\\b${value}\\b`, 'i').test(text);
            return !text.toLowerCase().replace(/\s+/g, ' ').includes(value.toLowerCase().replace(/\s+/g, ' '));
          }).map(([key]) => key);
          await info.attach('Print form completeness', { body: JSON.stringify({ expected: formValues, missing }, null, 2), contentType: 'application/json' });
          expect(missing, 'Registration form contains every captured fixture field').toEqual([]);
        }
      } finally {
        page.off('popup', onPopup); await output?.close();
        for (const popup of popups) await popup.close().catch(() => {});
        await page.evaluate(name => { (window as any)[`${name}_restore`]?.(); }, binding).catch(() => {});
      }
      break;
    }
    case 'qr-download': {
      const target = page.url().split('/').pop()!;
      await page.getByRole('button', { name: 'Print', exact: true }).click();
      await page.locator('.registration-print-menu').getByRole('button', { name: 'QR Code', exact: true }).click();
      const modal = page.locator('.registration-qr-modal');
      await expect(modal).toContainText(target);
      await expect(modal.locator('canvas')).toBeVisible();
      const pending = page.waitForEvent('download');
      await modal.getByRole('button', { name: 'Download QR Code', exact: true }).click();
      const download = await pending;
      expect(download.suggestedFilename()).toBe(`registration-qr-${target}.png`);
      const filename = info.outputPath('patient-qr.png');
      await download.saveAs(filename);
      expect(fs.readFileSync(filename).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      await info.attach('Patient QR download', { path: filename, contentType: 'image/png' });
      await reg.closeQrIfOpen();
      break;
    }
    case 'quick-actions':
      await page.getByRole('button', { name: 'Quick Actions', exact: true }).click();
      for (const label of ['Appointment', 'OP Invoice', 'Admission']) {
        await expect(page.locator('.registration-quick-actions-menu').getByRole('button', { name: label, exact: true })).toBeVisible();
      }
      await page.getByRole('button', { name: 'Quick Actions', exact: true }).click();
      break;
    case 'document-upload':
    case 'document-format':
    case 'document-clear': {
      await reg.assertAgentRecord();
      const target = page.url().split('/').pop()!;
      let drawer = await reg.addon('Patient Document');
      const upload = drawer.getByRole('button', { name: 'Upload', exact: true });
      await expect(upload).toBeDisabled();
      const category = drawer.getByRole('combobox').first();
      await category.click();
      await category.fill('Patient Identity');
      await page.getByRole('option', { name: 'Patient Identity', exact: true }).click();
      const filename = `Agent Testing proof ${Date.now()}.pdf`;
      await drawer.getByPlaceholder('File name', { exact: true }).fill(filename);
      if (flow === 'document-format') {
        await drawer.locator('input[type=file]').setInputFiles({ name: 'agent-test-unsupported.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('Synthetic format validation fixture') });
        // An accept attribute alone is not validation. The uploader must refuse
        // unsupported content even when a file arrives through drag/drop.
        await expect(upload, 'Unsupported format must not become uploadable').toBeDisabled();
        await expect(page.locator('.Toastify__toast')).toContainText(/format|supported|invalid|PDF/i);
      } else {
        await drawer.locator('input[type=file]').setInputFiles(path.resolve('qa/modules/registration/data/agent-test-id-proof.pdf'));
        await drawer.getByPlaceholder('Add a note').fill('Synthetic Agent Testing automation fixture');
        await expect(upload).toBeEnabled();
        if (flow === 'document-clear') {
          await drawer.getByRole('button', { name: 'Clear', exact: true }).click();
          await expect(drawer.getByPlaceholder('File name', { exact: true })).toHaveValue('');
          await expect(drawer.getByPlaceholder('Add a note')).toHaveValue('');
          await expect(drawer.locator('.patient-doc-selected-file')).toHaveCount(0);
          await expect(upload).toBeDisabled();
        } else {
          const pending = page.waitForResponse(r => r.url().includes('/patient-registration/attachments/add') && r.request().method() === 'PUT', { timeout: 60_000 });
          await upload.click();
          const response = await pending;
          expect(response.ok(), 'Attachment persistence request must succeed').toBe(true);
          const body = await response.json();
          expect(body.attachment?.id, 'Backend must return a persisted attachment ID').toBeTruthy();
          await expect(drawer.locator('.patient-doc-list-panel')).toContainText(filename);
          await evidence('Uploaded document linked to synthetic patient');
          await reg.openExisting(target);
          drawer = await reg.addon('Patient Document');
          await expect(drawer.locator('.patient-doc-list-panel')).toContainText(filename);
        }
      }
      await drawer.locator('.registration-drawer-close').click();
      await expect(drawer).not.toBeInViewport();
      break;
    }
    case 'abha-dialog': {
      await page.getByRole('button', { name: 'ABHA', exact: true }).click();
      const modal = page.locator('.registration-abha-modal');
      await expect(modal).toContainText('ABHA Verification');
      await expect(modal.locator('iframe')).toBeVisible();
      await evidence('ABHA verification shell; no identity submitted');
      await modal.locator('.registration-abha-close').click();
      await expect(modal).toHaveCount(0);
      break;
    }
    case 'redirect-billing':
    case 'redirect-admission':
    case 'redirect-appointment': {
      const target = page.url().split('/').pop()!;
      const surname = await reg.value('last_name');
      const label = flow === 'redirect-billing' ? 'OP Invoice' : flow === 'redirect-admission' ? 'Admission' : 'Appointment';
      await page.getByRole('button', { name: 'Quick Actions', exact: true }).click();
      await page.locator('.registration-quick-actions-menu').getByRole('button', { name: label, exact: true }).click();
      const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await expect(page).toHaveURL(flow === 'redirect-billing' ? new RegExp(`/billing/redirect\\?patient=${escaped}`) : flow === 'redirect-admission' ? new RegExp(`/atd/admission/${escaped}`) : /\/appointment-page/);
      if (flow === 'redirect-appointment') await expect(page.getByText(surname, { exact: false }).first()).toBeVisible();
      // Navigation coverage only; no appointment, bill or admission is submitted.
      break;
    }
    default: throw new Error(`Unsupported registration workflow: ${flow}`);
  }
  await evidence(`Verified ${flow}`);
}
