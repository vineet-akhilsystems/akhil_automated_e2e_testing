import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createPortal } from '../server.mjs';
import { cellTone, changedFilesSummary, columnParts, currentVersion, nodeTone, passRateText, triggerText } from '../public/components/version.js';

test('columnParts shows typed version, 6-character profile and automation number; missing parts read unknown', () => {
  assert.deepEqual(columnParts({ appVersion: { label: '1.58' }, profile: { hash: '3f9a1cdeadbeef' }, automationVersion: { number: 4 } }), { typed: '1.58', profile: '3f9a1c', automation: 'v4' });
  assert.deepEqual(columnParts({ appVersion: null, profile: null, automationVersion: null }), { typed: 'unknown', profile: 'unknown', automation: 'unknown' });
  assert.deepEqual(columnParts(undefined), { typed: 'unknown', profile: 'unknown', automation: 'unknown' });
});

test('changedFilesSummary counts added, changed and removed and says "since previous number"', () => {
  assert.deepEqual(changedFilesSummary({ changedFiles: { added: ['a'], changed: ['b', 'c'], removed: [] } }), { count: 3, label: '3 files changed since previous number' });
  assert.equal(changedFilesSummary({ changedFiles: { added: [], changed: ['x'], removed: [] } }).label, '1 file changed since previous number');
  assert.deepEqual(changedFilesSummary({}), { count: null, label: 'unknown' });
});

test('currentVersion is found by hash, not by the highest number (revert case)', () => {
  const list = [{ number: 2, hash: 'bbb' }, { number: 1, hash: 'aaa' }];
  assert.equal(currentVersion(list, { hash: 'aaa' }).number, 1);
  assert.equal(currentVersion(list, { hash: 'zzz' }), null);
  assert.equal(currentVersion(list, { hash: null }), null);
});

test('nodeTone, cellTone, passRateText and triggerText', () => {
  assert.equal(nodeTone({ total: 3, passed: 3, failed: 0, blocked: 0 }), 'pass');
  assert.equal(nodeTone({ total: 3, passed: 2, failed: 1, blocked: 0 }), 'fail');
  assert.equal(nodeTone({ total: 3, passed: 2, failed: 0, blocked: 1 }), 'blocked');
  assert.equal(nodeTone({ total: 3, passed: 1, failed: 0, blocked: 0, other: 2 }), 'none');
  assert.equal(nodeTone({ total: 0 }), 'none'); assert.equal(nodeTone(undefined), 'none');
  assert.deepEqual(['PASS', 'FAIL', 'ERROR', 'BLOCKED', null, 'SKIPPED'].map(cellTone), ['pass', 'fail', 'fail', 'blocked', 'none', 'none']);
  assert.equal(passRateText(66.7), '66.7%'); assert.equal(passRateText(0), '0%'); assert.equal(passRateText(null), 'unknown');
  assert.equal(triggerText({ createdBy: 'ann', trigger: 'manual' }), 'ann'); assert.equal(triggerText({ trigger: 'run' }), 'a run'); assert.equal(triggerText({}), 'unknown');
});

const ADMIN = { username: 'root', password: 'correct-horse-battery' };

test('Versions and Tree tabs in real Chromium: counts, only-differences toggle, register button, escaping, no console errors', { timeout: 180000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-versions-browser-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-versions-root-'));
  const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('tests/modules/registration/a.spec.ts', 'export const a = 1;\n');
  put('qa/modules/registration/tree.json', JSON.stringify({ module: 'registration', version: 1, nodes: [
    { id: 'login', name: 'Login and facility', kind: 'root', note: 'Shared start <b>of</b> every test' },
    { id: 'create', name: 'Create <i>patient</i>', parent: 'login', kind: 'step', match: { category: ['Create'] } },
    { id: 'update', name: 'Update patient', parent: 'login', kind: 'step', match: { category: ['Update'] } },
    { id: 'empty', name: 'Never used group', parent: 'login', kind: 'group', match: { category: ['Nothing'] } },
  ] }));
  const shots = process.env.VERSIONS_SHOTS;
  const portal = createPortal({ dataDir: directory, token: '', bootstrap: ADMIN, automationRoot: root, automationGit: async () => ({ commit: 'abc1234def', dirty: true }) });
  await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${portal.server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close(); await portal.close();
    for (const d of [directory, root]) { const r = fs.realpathSync(d); assert.equal(path.dirname(r).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); fs.rmSync(r, { recursive: true, force: true }); }
  });
  const store = portal.store;
  const mk = (id, title, category) => ({ id, title, mode: 'manual', category, priority: 'P1', input: {}, steps: [{ action: 'Do it.', expected: 'It works.' }] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /^Sign in/ }).click();
  await page.getByRole('button', { name: 'Open Augastam' }).click();
  await expect(page.locator('.module-card').first()).toBeVisible();
  const call = (url, method = 'GET', body) => page.evaluate(async ([u, m, b]) => { const r = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, value: await r.json().catch(() => ({})) }; }, [url, method, body]);
  for (const c of [mk('T-1', 'Create one', 'Create'), mk('T-2', 'Create <img src=x onerror=window.__xss=1> two', 'Create'), mk('T-3', 'Update one', 'Update'), mk('T-4', 'Loose case', 'Other')]) {
    const r = await call('/api/modules/registration/cases', 'POST', c); assert.equal(r.status, 201, JSON.stringify(r.value));
  }
  assert.equal((await call('/api/modules/registration/automation-versions', 'POST', { note: 'first <script>window.__xss=1</script>' })).status, 201);
  put('tests/modules/registration/a.spec.ts', 'export const a = 2;\n');
  assert.equal((await call('/api/modules/registration/automation-versions', 'POST', { note: '' })).status, 201);
  const h = ch => ch.repeat(64);
  const base_ = { kind: 'tests', mode: 'automated', status: 'failed', module: { id: 'registration' }, productId: 'augastam', cases: ['T-1', 'T-2', 'T-3'].map(id => ({ id, title: id })) };
  const run = (id, at, label, hash, n, statuses) => store.saveRun({ ...base_, id, name: `Run ${id}`, createdAt: at, finishedAt: at, appVersion: { label, source: 'run' }, profile: { hash, parts: {}, keys: [], stable: true, shards: 1 }, automationVersion: { number: n, hash: h(String(n)) }, results: ['T-1', 'T-2', 'T-3'].map((id, i) => ({ id, status: statuses[i] })) });
  run('r1', '2026-11-10T10:00:00Z', '1.58', 'aaaaaa1111', 1, ['PASS', 'PASS', 'PASS']);
  run('r2', '2026-11-12T10:00:00Z', '1.59', 'bbbbbb2222', 2, ['PASS', 'FAIL', 'PASS']);

  // Versions tab
  await page.goto(`${base}/#/modules/registration`);
  await page.locator('.module-tabs a', { hasText: 'Versions' }).click();
  await expect(page.getByRole('heading', { name: /^Versions/ })).toBeVisible();
  await expect(page.locator('.versions-table tbody tr')).toHaveCount(2);
  const v2 = page.locator('tr[data-version="2"]');
  await expect(v2).toContainText('Current');
  await expect(v2).toContainText('Uncommitted');
  await expect(v2).toContainText('abc1234');
  await expect(v2).toContainText('1 file changed since previous number');
  await expect(v2.locator('td').nth(4)).toHaveText('1'); // runs
  await expect(v2.locator('td').nth(5)).toHaveText('66.7%');
  await expect(page.locator('tr[data-version="1"] td').nth(5)).toHaveText('100%');
  await expect(page.locator('tr[data-version="1"]')).toContainText('<script>window.__xss=1</script>'); // shown as text
  await expect(page.locator('.matrix-col')).toHaveCount(2);
  await expect(page.locator('.matrix-col').first()).toContainText('1.59');
  await expect(page.locator('.matrix-col').first()).toContainText('profile bbbbbb');
  await expect(page.locator('.matrix-col').first()).toContainText('automation v2');
  await expect(page.locator('.matrix tbody tr')).toHaveCount(3);
  await page.locator('#only-differences').check();
  await expect(page.locator('.matrix tbody tr')).toHaveCount(1);
  await expect(page.locator('.matrix tbody tr')).toContainText('T-2');
  await page.locator('#only-differences').uncheck();
  await expect(page.locator('.matrix tbody tr')).toHaveCount(3);
  // note edit
  await page.getByRole('button', { name: 'Edit note for automation v2' }).click();
  await page.getByLabel('Note for automation v2').fill('second note');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('tr[data-version="2"]')).toContainText('second note');
  // register button: nothing changed -> existing; then change a file -> v3
  await page.getByRole('button', { name: 'Register current automation now' }).click();
  await expect(page.locator('.toast').last()).toContainText('already the current version');
  put('tests/modules/registration/a.spec.ts', 'export const a = 3;\n');
  await page.reload();
  await expect(page.locator('.versions-panel + .warning')).toContainText('have changed');
  await page.getByRole('button', { name: 'Register current automation now' }).click();
  await expect(page.locator('tr[data-version="3"]')).toBeVisible();
  await expect(page.locator('tr[data-version="3"]')).toContainText('Current');
  if (shots) await page.screenshot({ path: path.join(shots, 'versions-desktop.png'), fullPage: true });

  // Tree tab
  await page.locator('.module-tabs a', { hasText: 'Tree' }).click();
  await expect(page.getByRole('heading', { name: /^Tree/ })).toBeVisible();
  await expect(page.locator('.tree-info')).toContainText('qa/modules/registration/tree.json');
  await expect(page.locator('.tree-info')).toContainText('Run r2');
  const createRow = page.locator('.tree-row', { hasText: 'Create <i>patient</i>' });
  await expect(createRow.locator('.tc.total')).toHaveText('2');
  await expect(createRow.locator('.tc.fail')).toHaveText('1');
  await expect(createRow).toHaveClass(/fail/);
  await expect(page.locator('.tree-row', { hasText: 'Update patient' })).toHaveClass(/pass/);
  await expect(page.locator('.tree-row', { hasText: 'Never used group' })).toHaveCount(0); // empty groups hidden
  await expect(page.locator('#tree-unassigned')).toContainText('T-4');
  await expect(page.locator('.tree-note').first()).toContainText('<b>of</b>');
  await page.locator('#tree-show-empty').check();
  await expect(page.locator('.tree-row', { hasText: 'Never used group' })).toHaveCount(1);
  await createRow.locator('.tree-label').click();
  await expect(page.locator('#tree-selected-cases')).toContainText('T-2');
  await expect(page.locator('#tree-selected-cases')).not.toContainText('T-3');
  if (shots) await page.screenshot({ path: path.join(shots, 'tree-desktop.png'), fullPage: true });

  // phone width
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(await overflow() <= 1, 'tree page has no horizontal page scroll on a phone');
  if (shots) await page.screenshot({ path: path.join(shots, 'tree-phone.png'), fullPage: true });
  await page.locator('.module-tabs a', { hasText: 'Versions' }).click();
  await expect(page.locator('.versions-table')).toBeVisible();
  assert.ok(await overflow() <= 1, 'versions page has no horizontal page scroll on a phone');
  if (shots) await page.screenshot({ path: path.join(shots, 'versions-phone.png'), fullPage: true });

  // Re-run buttons keep the original run's application version: the run dialog opens with its label filled in.
  store.saveRun({ ...base_, id: 'r-manual', name: 'Run manual', mode: 'manual', status: 'failed', module: { id: 'registration', name: 'Registration', area: 'Registration' }, environmentId: 'none', environmentName: 'x',
    createdAt: '2026-11-13T10:00:00Z', finishedAt: '2026-11-13T10:00:00Z', appVersion: { label: '1.57', source: 'profile' }, results: [{ id: 'T-1', status: 'FAIL' }, { id: 'T-2', status: 'PASS' }, { id: 'T-3', status: 'PASS' }] });
  for (const cid of ['T-1', 'T-2', 'T-3']) { const existing = store.case('registration', cid); store.saveCase('registration', { ...existing, reviewStatus: 'approved' }, existing.version); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const name of [/^Re-run failures/, /^Rerun all cases/]) {
    await page.goto(`${base}/#/runs/r-manual`);
    await page.getByRole('button', { name }).click();
    await expect(page.locator('input[name="run-app-version"]')).toHaveValue('1.57');
    await page.keyboard.press('Escape');
    await page.reload();
  }

  // a module without a tree has no Tree tab; nothing injected
  await call('/api/modules', 'POST', { name: 'Facility Setup', area: 'Setup', prefix: 'FAC' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/#/modules/facility-setup/versions`);
  await page.reload(); // the module list is loaded at page start
  await expect(page.getByRole('heading', { name: /^Versions/ })).toBeVisible();
  await expect(page.locator('.module-tabs a', { hasText: 'Tree' })).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'no script from data ran');
  assert.equal(await page.locator('.tree-cases img, .matrix img, .versions-table img').count(), 0);
  // The Tree tab probe of a module without a tree is an expected 404 that Chromium logs as a console error.
  assert.deepEqual(errors.filter(e => !/favicon/i.test(e) && !/status of 404/.test(e)), []);
});
