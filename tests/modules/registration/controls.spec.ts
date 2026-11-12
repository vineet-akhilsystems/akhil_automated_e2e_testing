import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../fixtures/auth';
import { RegistrationPage } from './registration.page';
import { captureEvidence } from '../../fixtures/evidence';

// Observe the configured controls without saving or invoking master changes.
// This inventory is evidence for coverage review, not a functional pass for
// every control it discovers. Hidden and conditional controls need their flows.
test('inventory configured registration buttons, fields and tabs across all variants', async ({ page }, info) => {
  test.setTimeout(12 * 60_000);
  const reg = new RegistrationPage(page);
  await reg.open();
  const variants = ['New Registration', 'New Born Registration', 'International Registration', 'Outside Registration', 'Staff Registration', 'Diagnostic Registration'];
  const screens: unknown[] = [];
  const snapshot = async (variant: string, tab: string) => {
    const controls = await page.evaluate(() => Array.from(document.querySelectorAll('button, input:not([type=hidden]), select, textarea, [role=button], a[href]'))
      .filter(el => (el as HTMLElement).getBoundingClientRect().width > 0)
      .map(el => {
        const card = el.closest('.registration-card');
        const group = el.closest('.form-group');
        return {
          tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '',
          card: card?.querySelector('.registration-card-title')?.textContent?.trim() || '',
          label: group?.querySelector('label')?.textContent?.trim() || '',
          name: el.getAttribute('name') || '',
          text: ['BUTTON', 'A'].includes(el.tagName) ? (el as HTMLElement).innerText.trim() : '',
          ariaLabel: el.getAttribute('aria-label') || '',
          placeholder: el.getAttribute('placeholder') || '',
          disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true',
          className: el.getAttribute('class') || '',
        };
      }));
    screens.push({ variant, tab, controls });
  };
  for (const variant of variants) {
    await reg.selectRegistrationType(variant);
    await snapshot(variant, 'initial');
    for (const title of ['Address Details', 'Additional Details']) {
      const card = reg.card(title);
      const tabs = card.locator('.registration-tab-btn');
      if (!(await tabs.first().isVisible())) continue;
      const count = await tabs.count();
      for (let index = 0; index < count; index++) {
        const name = await tabs.nth(index).innerText();
        await tabs.nth(index).click();
        await snapshot(variant, `${title}: ${name}`);
      }
    }
    await captureEvidence(page, info, `INVENTORY-${variant.replace(/\W/g, '-')}`, 'Configured registration controls');
  }
  expect(screens.length).toBeGreaterThanOrEqual(variants.length);
  const directory = process.env.PORTAL_RUN_DIR || 'qa/modules/registration/discovery';
  fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, 'controls-inventory.json');
  fs.writeFileSync(output, JSON.stringify({ capturedAt: new Date().toISOString(), scope: 'Unsaved form variants and visible tabs only; no patient values captured.', screens }, null, 2));
  await info.attach('Configured controls inventory', { path: output, contentType: 'application/json' });
});
