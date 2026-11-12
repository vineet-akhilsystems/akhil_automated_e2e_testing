import { test as setup, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { STORAGE_STATE } from '../playwright.config';

// Augastam keeps the login token in sessionStorage, which Playwright's storageState
// does not persist. We save it separately and re-inject it in tests/fixtures/auth.ts.
export const SESSION_FILE = `${process.env.AUTH_DIR ?? '.auth'}/session.json`;
let loginStage = 'configuration';
setup.afterEach(async ({}, info) => {
  if (process.env.PORTAL_RUN_DIR) fs.writeFileSync(path.join(process.env.PORTAL_RUN_DIR, 'auth-status.json'), JSON.stringify({ stage: loginStage, success: info.status === 'passed' }));
});

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env (see .env.example)`);
  return v;
}

// Support both the original login and the newer two-step workspace screen.
const group = (page: Page, label: string) =>
  page.locator('.form-group.input-container, .lg-field').filter({ has: page.locator('label', { hasText: label === 'Tenant Name' ? /^Tenant(?: Name| \(hospital group\))/ : label }) }).first();

async function pick(page: Page, label: string, option: string) {
  const g = group(page, label);
  await g.locator('[class*="control"]').first().click();
  await g.locator('input').first().fill(option);
  const opt = page.getByRole('option', { name: option, exact: true });
  await expect(opt, `${label} option "${option}"`).toBeVisible();
  await opt.click();
}

setup('log in and save session', async ({ page }) => {
  loginStage = 'configuration';
  const tenant = env('AUGASTAM_TENANT');
  const facility = env('AUGASTAM_FACILITY');
  const role = env('AUGASTAM_ROLE');

  loginStage = 'open-login';
  await page.goto('/');
  await page.locator('#username').fill(env('AUGASTAM_USER'));
  await page.locator('#password').fill(env('AUGASTAM_PASS'));

  // Current UI uses Continue; the original UI also supports password Enter.
  loginStage = 'verify-password';
  const verified = page.waitForResponse((r) => r.url().includes('verify-password'), { timeout: 60_000 });
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  if (await continueButton.isVisible()) await continueButton.click();
  else await page.locator('#password').press('Enter');
  const verification = await verified;
  expect(verification.ok(), 'Password verification request must succeed').toBeTruthy();
  await expect(group(page, 'Tenant Name'), 'Tenant dropdown after password check (wrong credentials?)').toBeVisible({ timeout: 30_000 });

  // Step 2: Tenant is auto-selected when the user has only one.
  loginStage = 'tenant';
  if (!(await group(page, 'Tenant Name').innerText()).includes(tenant)) await pick(page, 'Tenant Name', tenant);

  // Facility is a multi-select: keep exactly the configured facility.
  loginStage = 'facility';
  const facilityGroup = group(page, 'Facility Name');
  await expect(facilityGroup).toBeVisible();
  for (const chip of await facilityGroup.locator('[class*="multiValue" i]').filter({ hasNotText: facility }).all()) {
    await chip.locator('[class*="multiValueRemove" i], [role="button"]').first().click();
  }
  if (!(await facilityGroup.innerText()).includes(facility)) await pick(page, 'Facility Name', facility);
  await page.keyboard.press('Escape');

  // Role list loads per facility (getRoleListByFacility); admins get "Admin" automatically.
  loginStage = 'role';
  const roleGroup = group(page, 'Role Name');
  await expect(roleGroup).toBeVisible();
  await expect
    .poll(async () => (await roleGroup.innerText()).replace(/Role Name\*?/, '').trim(), { timeout: 30_000 })
    .not.toBe('');
  if (!(await roleGroup.innerText()).includes(role)) await pick(page, 'Role Name', role);

  // Step 3: Continue (current UI) or Login (original UI) opens the workspace.
  loginStage = 'submit';
  // The app may finish signing in on its own once the role is set, so the button can already be gone.
  // Click it only if we are not signed in yet; if the click times out but the token has appeared, carry on.
  const hasToken = () => page.evaluate(() => Boolean(sessionStorage.getItem('token')));
  if (!(await hasToken())) {
    await page.getByRole('button', { name: /^(Login|Continue)$/ }).click({ timeout: 20_000 })
      .catch(async (error) => { if (!(await hasToken())) throw error; });
  }
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('token')), { timeout: 60_000 }).toBeTruthy();
  await page.waitForURL((url) => url.pathname !== '/', { timeout: 60_000 });

  loginStage = 'session-save';
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE });
  fs.writeFileSync(SESSION_FILE, await page.evaluate(() => JSON.stringify(sessionStorage)));
});
