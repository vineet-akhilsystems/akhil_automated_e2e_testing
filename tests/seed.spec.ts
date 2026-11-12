import { test, expect } from './fixtures/auth';

// Seed for the Playwright test agents (planner / generator / healer): starts logged in
// (session restored from `npm run auth`) on a blank, ready-to-fill Registration form.
test.describe('Registration seed', () => {
  test('seed', async ({ page }) => {
    const dupRules = page.waitForResponse((r) => r.url().includes('get-Duplicate-Rule-Configuration'), { timeout: 60_000 }).catch(() => null);
    await page.goto('/registration');
    await expect(page.locator('.registration-preview-loading')).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator('input[name="first_name"]')).toBeVisible({ timeout: 60_000 });
    // Save is refused until duplicate-check settings have loaded.
    await dupRules;
  });
});
