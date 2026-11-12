import { test, expect } from '../../fixtures/auth';
import { RegistrationPage } from './registration.page';

// Registration preflight (run first by qa/tools/run-registration-e2e.mjs): the saved session must open a ready
// Registration form. The module-neutral session check is tests/smoke/session.spec.ts.
test('saved session opens the Registration page without logging in again', async ({ page }) => {
  await page.goto('/registration');
  await expect(page).toHaveURL(/\/registration/);
  await expect(page.locator('#username')).toHaveCount(0);
  await new RegistrationPage(page).waitForForm();
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
});
