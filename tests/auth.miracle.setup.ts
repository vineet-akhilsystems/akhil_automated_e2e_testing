import { test as setup, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Miracle HIS (billing) login: classic ASP.NET page with Telerik combo boxes.
// Saves a separate session so it never overwrites the Augastam one (.auth/admin.json, session.json).
// Values come from the portal's Settings > login profile (it sets MIRACLE_* and BASE_URL for the run);
// from the command line (`npm run auth:miracle`) they come from .env.
export const MIRACLE_STATE = `${process.env.AUTH_DIR ?? '.auth'}/miracle.json`;
const DEFAULT_URL = 'https://uatbilling.miracleoncloud.com';

let loginStage = 'configuration';
setup.afterEach(async ({}, info) => {
  if (process.env.PORTAL_RUN_DIR) fs.writeFileSync(path.join(process.env.PORTAL_RUN_DIR, 'auth-status.json'), JSON.stringify({ stage: loginStage, success: info.status === 'passed' }));
});

function env(name: string, fallback?: string): string {
  const v = process.env[name] || fallback;
  if (!v) throw new Error(`Missing ${name} (set it in Settings, or in .env for the command line)`);
  return v;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (text: string) => new RegExp(`^\\s*${escapeRegExp(text.trim())}\\s*$`, 'i');

// Telerik RadComboBox: open it via its input, then click the option whose text matches exactly
// (the list also holds near-duplicates such as "Akhil System Pvt.Ltd 2").
async function pick(page: Page, inputId: string, option: string) {
  const input = page.locator(`#${inputId}_Input`);
  if (exact(option).test(await input.inputValue())) return;
  await input.click();
  const item = page.locator(`#${inputId}_DropDown .rcbItem`).filter({ hasText: exact(option) }).first();
  await expect(item, `${inputId} option "${option}"`).toBeVisible({ timeout: 20_000 });
  await item.click();
  await expect(input).toHaveValue(exact(option));
}

setup('log in to Miracle and save session', async ({ page }) => {
  loginStage = 'configuration';
  const baseUrl = process.env.PORTAL_AUTH_RUN ? env('BASE_URL') : env('MIRACLE_BASE_URL', DEFAULT_URL);
  const user = env('MIRACLE_USER');
  const pass = env('MIRACLE_PASS');
  const facility = env('MIRACLE_FACILITY', 'Akhil System Pvt.Ltd');
  const group = env('MIRACLE_GROUP', 'ADMINISTRATION');
  const entrySite = env('MIRACLE_ENTRY_SITE', 'Cardiology');

  loginStage = 'open-login';
  await page.goto(baseUrl);
  await page.locator('#txtUserID').fill(user);
  await page.locator('#txtPassword').fill(pass);

  // The page fills the dropdowns for this user once the password field loses focus; wait for that, then adjust only if needed.
  await page.locator('#txtPassword').press('Tab');
  await expect.poll(async () => (await page.locator('#ddlFacility_Input').inputValue()).trim(), { timeout: 20_000 }).not.toBe('Facility').catch(() => {});
  loginStage = 'facility';
  await pick(page, 'ddlFacility', facility);
  loginStage = 'group';
  await pick(page, 'dropGroup', group);
  loginStage = 'entrySite';
  await pick(page, 'ddlEntrySite', entrySite);

  loginStage = 'sign-in';
  await page.locator('#btnvalid').click();
  await expect(page.locator('#txtPassword'), 'Login form should be gone after sign-in (wrong credentials?)').toBeHidden({ timeout: 60_000 });

  loginStage = 'session-save';
  fs.mkdirSync(path.dirname(MIRACLE_STATE), { recursive: true });
  await page.context().storageState({ path: MIRACLE_STATE });
});
