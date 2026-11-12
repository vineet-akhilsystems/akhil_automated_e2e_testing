import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { createPortal } from '../server.mjs';
import { workbookAutomation } from '../registry.mjs';

test('workbook UI distinguishes missing automation and produces blocked results without manual entry', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-workbook-browser-'));
  const c = workbookAutomation.cases.find(c => c.id === 'TC_REG_066');
  const launch = (command, args, options) => {
    const child = new EventEmitter(); child.kill = () => { setImmediate(() => child.emit('exit', null)); return true; };
    setTimeout(() => {
      fs.writeFileSync(path.join(options.env.PORTAL_RUN_DIR, 'events.jsonl'), JSON.stringify({ id: c.id, title: c.title, status: 'BLOCKED', verificationPerformed: false, actual: c.automationBlocker, expected: c.steps[0].expected, attachments: [], mismatches: [], durationMs: 0 })+'\n');
      child.emit('exit', 0);
    }, 50);
    return child;
  };
  const portal = createPortal({ dataDir: directory, token: '', launch, environments: [{ id: 'fixture', name: 'Fixture', url: 'https://application.invalid', authDir: path.join(directory, 'auth') }] });
  portal.store.saveCase('registration', c);
  await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close(); await portal.close();
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('augastam-workbook-browser-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${portal.server.address().port}/#/modules/registration`);
  await page.getByRole('button', { name: 'Open Augastam' }).click({ timeout: 5000 }).catch(() => {});
  await page.getByRole('textbox', { name: 'Search ID, title, suite or requirement…', exact: true }).fill(c.id);
  await expect(page.getByText('Not automated', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: c.title, exact: true }).click();
  await expect(page.getByText('Not automated: execution blocked', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Execution type', { exact: true })).toHaveValue('automated');
  await page.getByRole('button', { name: 'Save test case', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('checkbox', { name: `Select ${c.id}`, exact: true }).check();
  await page.getByRole('button', { name: 'Run selected', exact: false }).click();
  await expect(page.getByRole('dialog').getByLabel('Execution type', { exact: true })).toHaveValue('automated');
  await page.getByRole('button', { name: 'Create run', exact: true }).click();
  await expect(page.locator('.run-subline .badge')).toHaveText('blocked', { timeout: 15000 });
  await expect(page.getByText('What actually happened?', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Screenshot could not be captured:', { exact: false })).toHaveCount(0);
  await expect(page.getByText(c.automationBlocker, { exact: false }).first()).toBeVisible();
  fs.mkdirSync('portal/test-output', { recursive: true });
  await page.screenshot({ path: 'portal/test-output/workbook-blocked-result.png', fullPage: true });
  assert.deepEqual(errors, []);
});
