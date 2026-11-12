import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createPortal } from '../server.mjs';

const ADMIN = { username: 'root', password: 'correct-horse-battery' };

test('Access control UI: members, teams, hidden modules and permission-based gating', { timeout: 120000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-access-browser-'));
  const portal = createPortal({ dataDir: directory, token: '', bootstrap: ADMIN });
  await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${portal.server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close(); await portal.close();
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('augastam-access-browser-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const shots = process.env.ACCESS_SHOTS;
  const shot = (page, name) => shots ? page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }) : null;

  // Users are created through the API, like an administrator would on the Users page.
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  for (const username of ['lena', 'nina']) {
    const r = await fetch(`${base}/api/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ username, password: `password-${username}`, role: 'member', displayName: `${username[0].toUpperCase()}${username.slice(1)} Test` }) });
    assert.equal(r.status, 201, await r.clone().text());
  }

  const open = async (username, password) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: /^Sign in/ }).click();
    return page;
  };
  const errors = [];

  // A member with no access sees nothing and is told what to do.
  const nina = await open('nina', 'password-nina');
  await expect(nina.getByText('You have no access yet. Ask an administrator or module lead to add you.')).toBeVisible();
  await expect(nina.getByRole('button', { name: /^Open / })).toHaveCount(0);
  await nina.close();

  // The admin gives Lena the lead role on the first module.
  const admin = await open(ADMIN.username, ADMIN.password);
  admin.on('dialog', d => d.accept());
  await admin.getByRole('button', { name: 'Open Augastam' }).click();
  await admin.locator('.module-card').first().getByRole('link', { name: /Open module/ }).click();
  await admin.getByRole('link', { name: 'Members', exact: true }).click();
  await expect(admin.getByRole('heading', { name: /^Members ·/ })).toBeVisible();
  await expect(admin.getByRole('heading', { name: 'Activity' })).toBeVisible();
  await admin.getByRole('button', { name: 'Add member' }).first().click();
  await admin.getByRole('radio', { name: /Lena Test/ }).check();
  await admin.getByRole('radio', { name: /Module lead/ }).check();
  await admin.getByText('Customize permissions').click();
  await expect(admin.getByLabel(/Delete cases/)).toBeChecked();
  await shot(admin, 'add-member');
  await admin.getByRole('dialog').getByRole('button', { name: 'Add member' }).click();
  await expect(admin.locator('.members-table')).toContainText('Lena Test');
  await expect(admin.locator('.members-table')).toContainText('Module lead');
  await shot(admin, 'members');

  // A team can be created and attached.
  await admin.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Teams', exact: true }).click();
  await admin.getByRole('button', { name: 'Create team' }).first().click();
  await admin.getByLabel('Team name').fill('Billing BAs');
  await admin.getByRole('dialog').getByRole('button', { name: 'Create team' }).click();
  const card = admin.locator('.team-card', { hasText: 'Billing BAs' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Add person' }).click();
  await admin.getByRole('radio', { name: /Nina Test/ }).check();
  await admin.getByRole('dialog').getByRole('button', { name: 'Add to team' }).click();
  await expect(card).toContainText('Nina Test');
  await shot(admin, 'teams');

  // Lena (lead) sees her module and its Members tab, but no admin pages and no product-wide create.
  const lena = await open('lena', 'password-lena');
  await lena.getByRole('button', { name: /^Open Augastam/ }).click();
  await expect(lena.locator('.module-card').first()).toBeVisible();
  await expect(lena.getByRole('button', { name: /Add module/ })).toHaveCount(0);
  await expect(lena.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
  await expect(lena.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  await lena.locator('.module-card').first().getByRole('link', { name: /Open module/ }).click();
  await expect(lena.getByRole('link', { name: 'Members', exact: true })).toBeVisible();
  await expect(lena.getByRole('button', { name: 'Module settings' })).toBeVisible();
  await lena.getByRole('button', { name: 'Module settings' }).click();
  await expect(lena.getByRole('switch', { name: /Require a second person to approve cases/ })).toBeChecked();
  await lena.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  // Phone width: no horizontal page scroll on the new pages.
  await admin.setViewportSize({ width: 390, height: 800 });
  for (const hash of ['#/teams', '#/access']) {
    await admin.goto(`${base}/${hash}`);
    await expect(admin.getByRole('heading', { name: hash === '#/teams' ? 'Teams' : 'Product access', exact: true })).toBeVisible();
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${hash} must not scroll horizontally on mobile`);
  }
  await shot(admin, 'access-mobile');
  assert.deepEqual(errors, []);
});
