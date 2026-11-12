import { test, expect } from '../fixtures/auth';

// Module-neutral session check: the saved session from `npm run auth` still opens the signed-in application.
// It must not depend on any module's page; each module checks its own page in tests/modules/<id>/
// (Registration: tests/modules/registration/session.spec.ts).
test('saved session opens the application without logging in again', async ({ page }) => {
  await page.goto('/');
  const workspace = page.getByText(/^Version:/); // header text of the signed-in workspace
  const loginForm = page.locator('#username');
  const expired = page.getByText(/Your session has expired/i);
  await expect(workspace.or(loginForm).or(expired).first()).toBeVisible({ timeout: 60_000 });
  // An expired token is only reported after the workspace's first API calls come back.
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await expect(expired, 'Application session expired. Run npm run auth, then retry.').toHaveCount(0);
  await expect(loginForm, 'Login form shown: the saved session was not accepted. Run npm run auth.').toHaveCount(0);
  await expect(workspace).toBeVisible();
});
