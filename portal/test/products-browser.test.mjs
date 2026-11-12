import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createPortal } from '../server.mjs';

test('Product picker scopes the workspace, switches products and lets an admin add one', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-products-browser-'));
  const portal = createPortal({ dataDir: directory, token: '' });
  await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close(); await portal.close();
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('augastam-products-browser-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const shots = process.env.PRODUCT_SHOTS;
  const shot = (page, name) => shots ? page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }) : null;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${portal.server.address().port}`);

  await expect(page.getByRole('heading', { name: 'Which product do you want to test?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Miracle' })).toBeVisible();
  await shot(page, 'picker');
  await page.getByRole('button', { name: 'Open Augastam' }).click();
  await expect(page.getByRole('link', { name: 'Module library' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Switch product/ })).toBeVisible();
  await expect(page.locator('.module-card').first()).toBeVisible();
  await shot(page, 'augastam');

  await page.getByRole('button', { name: /Switch product/ }).click();
  await expect(page.getByRole('button', { name: 'Continue with Augastam' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Miracle' }).click();
  await expect(page.getByText('No modules yet in Miracle', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('No login profiles yet in Miracle', { exact: false })).toBeVisible();
  await shot(page, 'miracle-settings');

  await page.getByRole('button', { name: /Switch product/ }).click();
  await page.getByRole('button', { name: /^Add product/ }).click();
  await page.getByLabel('Product name', { exact: true }).fill('Zeta');
  await page.getByLabel('Description', { exact: true }).fill('Synthetic product');
  await page.getByRole('dialog').getByRole('button', { name: 'Add product', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Zeta' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByRole('button', { name: 'Open Zeta' })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'picker must not scroll horizontally on mobile');
  await shot(page, 'picker-mobile');
  assert.deepEqual(errors, []);
});
