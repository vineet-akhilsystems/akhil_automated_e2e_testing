import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createPortal } from '../server.mjs';

// Browser test for the module knowledge pipeline UI (readiness checklist, AI gate, setup form, duplicate upload,
// interrupted job retry, insights history). The backend endpoints from the design (section 6) are stubbed in the
// browser with page.route, so this test checks the UI contract independently of the backend build.
const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const stage = (id, label, status, detail, action) => ({ id, label, status, detail, ...(action ? { action } : {}) });
const stagesWith = overrides => [
  stage('sources', 'Sources', 'ready', '2 usable sources'),
  stage('insights', 'Insights', 'ready', 'Version 3 covers every source'),
  stage('cases', 'Reviewed cases', 'missing', 'No approved case yet', 'Open review queue'),
  stage('setup', 'Target setup', 'missing', 'Not confirmed', 'Confirm target setup'),
  stage('discovery', 'Discovery', 'blocked', 'Needs target setup'),
  stage('automation', 'Automation package', 'missing', 'No adapter installed'),
  stage('smoke', 'Smoke run', 'blocked', 'Needs the automation package'),
].map(s => ({ ...s, ...(overrides[s.id] ?? {}) }));

test('Pipeline UI: readiness checklist, gates, setup, duplicates, retry and history', { timeout: 180000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-pipeline-browser-'));
  const portal = createPortal({ dataDir: directory, token: '', bootstrap: ADMIN });
  await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${portal.server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close(); await portal.close();
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('augastam-pipeline-browser-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const shots = process.env.PIPELINE_SHOTS;
  const shot = (page, name) => shots ? page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }) : null;

  // Mutable server state behind the stubs.
  const rd = { stages: stagesWith({}), canGenerateAi: false, canProposeAutomation: false, blockers: [] };
  let setup = {}, setupPut = null, intakeFetches = 0, retried = null, startBodies = [], aiPosts = 0, aiMode = 'ok';
  const interrupted = { id: 'job-1', kind: 'analyze', agent: 'claude', status: 'interrupted', startedAt: new Date().toISOString(), log: [{ t: Date.now(), text: 'Started' }], message: 'Portal restarted' };
  const history = [
    { version: 3, createdAt: new Date().toISOString(), createdBy: 'root', mode: 'agent-claude', changeSummary: 'Added 2 rules, corrected 1 field' },
    { version: 2, createdAt: new Date(Date.now() - 86400000).toISOString(), createdBy: 'lena', mode: 'assistant', changeSummary: { added: 4, changed: 0 } },
  ];

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/modules/*/readiness', route => json(route, rd));
  await page.route('**/api/modules/*/setup', route => {
    if (route.request().method() === 'PUT') { setupPut = route.request().postDataJSON(); setup = { ...setupPut, confirmedBy: 'root', confirmedAt: new Date().toISOString() }; return json(route, setup); }
    return json(route, setup);
  });
  await page.route('**/api/modules/*/insights/history', route => json(route, history));
  await page.route('**/api/modules/*/insights', route => json(route, { version: 3, summary: 'Registration summary', fields: [], rules: [], flows: [], edgeCases: [], openQuestions: [], sources: [], mode: 'agent-claude', createdAt: new Date().toISOString(), suggestedSetup: { moduleUrl: '/registration', variants: ['OPD', 'IPD'] } }));
  await page.route('**/api/modules/*/intake', route => {
    intakeFetches++;
    return json(route, { files: [{ id: 'f1', name: 'flow.mp4', kind: 'video', size: 5000, extract: intakeFetches > 1 ? 'partial' : 'pending', uploadedBy: 'root', uploadedAt: new Date().toISOString() }], insights: { version: 3, createdAt: new Date().toISOString(), mode: 'agent-claude', status: 'done' } });
  });
  await page.route('**/api/modules/*/intake/files', route => route.request().method() === 'POST' ? json(route, { duplicate: true, duplicateOf: 'first-upload.txt' }) : route.fallback());
  await page.route('**/api/agent/status', route => json(route, { agents: [{ id: 'claude', label: 'Claude Code', available: true }], busy: null }));
  await page.route('**/api/modules/*/agent/jobs', route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); startBodies.push(body);
      return body.force ? json(route, { id: 'job-9' }) : json(route, { error: 'Nothing new to analyse since version 3.' }, 409);
    }
    return json(route, [interrupted]);
  });
  await page.route('**/api/modules/*/agent/jobs/job-1', route => json(route, interrupted));
  await page.route('**/api/modules/*/agent/jobs/job-1/retry', route => { retried = 'job-1'; return json(route, { id: 'job-2' }); });
  await page.route('**/api/modules/*/agent/jobs/job-2', route => json(route, { id: 'job-2', kind: 'analyze', agent: 'claude', status: 'done', startedAt: new Date().toISOString(), log: [], result: { draftCases: 0 } }));
  await page.route('**/api/modules/*/agent/jobs/job-9', route => json(route, { id: 'job-9', kind: 'analyze', agent: 'claude', status: 'running', startedAt: new Date().toISOString(), log: [] }));
  await page.route('**/api/modules/*/ai-generate', route => { aiPosts++; return json(route, { error: 'AI generation is not unlocked yet.', readiness: { ...rd, canGenerateAi: false } }, 409); });

  await page.goto(base);
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /^Sign in/ }).click();
  await page.getByRole('button', { name: 'Open Augastam' }).click();
  await page.locator('.module-card').first().getByRole('link', { name: /Open module/ }).click();
  const moduleHash = new URL(page.url()).hash;
  const moduleId = moduleHash.split('/')[2];

  // 1. Readiness checklist on the cases tab: seven stages, statuses, actions, collapse remembered.
  const panel = page.locator('#readiness-panel');
  await expect(panel.getByRole('heading', { name: 'Readiness' })).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Module pipeline stages' }).getByRole('listitem')).toHaveCount(7);
  await expect(panel.locator('[data-stage="cases"]')).toContainText('Missing');
  await expect(panel.locator('[data-stage="discovery"]')).toContainText('Blocked');
  await expect(panel.getByRole('button', { name: 'Open review queue' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Confirm target setup' })).toBeVisible();
  await shot(page, 'readiness-cases');
  await panel.getByRole('button', { name: 'Hide checklist' }).click();
  await expect(panel.getByRole('list')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#readiness-panel').getByRole('button', { name: 'Show checklist' })).toBeVisible();
  await page.locator('#readiness-panel').getByRole('button', { name: 'Show checklist' }).click();
  await expect(page.locator('#readiness-panel [data-stage]')).toHaveCount(7);

  // 2. AI Studio is locked with the reasons, then warns when insights are stale, then handles a 409.
  await page.goto(`${base}/${moduleHash}/ai`);
  await expect(page.getByText("AI generation unlocks when the module's automation pipeline is set up")).toBeVisible();
  await expect(page.locator('#ai-gate .rd-blockers')).toContainText('Automation package');
  await expect(page.locator('#ai-submit')).toBeDisabled();
  await shot(page, 'ai-locked');
  Object.assign(rd, { canGenerateAi: true, stages: stagesWith({ insights: { status: 'stale', detail: '1 source added since version 3' }, automation: { status: 'ready' } }) });
  await page.reload();
  await expect(page.locator('#ai-submit')).toBeEnabled();
  await expect(page.locator('#ai-gate')).toContainText('The insights are out of date');
  await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-gate')).toContainText("AI generation unlocks when the module's automation pipeline is set up");
  await expect(page.locator('#ai-submit')).toBeDisabled();
  assert.equal(aiPosts, 1);
  Object.assign(rd, { canGenerateAi: false, stages: stagesWith({}) });

  // 3. Review page: the automation proposal is disabled with the reasons.
  await page.goto(`${base}/${moduleHash}/review`);
  const proposal = page.locator('#ag-automation-panel');
  await expect(proposal.getByRole('button', { name: /Generate automation proposal/ })).toBeDisabled();
  await expect(proposal.locator('.propose-gate')).toContainText('Discovery');
  await expect(proposal).toContainText('Blocked until the readiness checklist is complete');
  await shot(page, 'review-gate');

  // 4. Intake: pending file polls to a final state, duplicates are explained, setup form, retry, history.
  await page.goto(`${base}/${moduleHash}/intake`);
  await expect(page.locator('.extract-processing')).toBeVisible();
  await expect(page.getByText('Keyframes only')).toBeVisible({ timeout: 12000 });
  await expect(page.locator('.extract-processing')).toHaveCount(0);

  await page.locator('[data-intake-input]').setInputFiles({ name: 'renamed.txt', mimeType: 'text/plain', buffer: Buffer.from('same bytes') });
  await page.getByRole('button', { name: /^Upload/ }).click();
  await expect(page.getByText('Already uploaded as first-upload.txt: nothing to process')).toBeVisible();
  await expect(page.locator('.upload-row')).toHaveCount(0);

  const setupPanel = page.locator('#setup-panel');
  await expect(setupPanel.getByRole('heading', { name: 'Target setup' })).toBeVisible();
  await setupPanel.getByRole('button', { name: 'Use suggestion' }).click();
  await expect(setupPanel.getByLabel('Module URL path')).toHaveValue('/registration');
  await expect(setupPanel.getByLabel('Variants or tabs')).toHaveValue('OPD, IPD');
  const profile = setupPanel.getByLabel('Login profile');
  const firstProfile = await profile.locator('option').nth(1).getAttribute('value');
  await profile.selectOption(firstProfile);
  await setupPanel.getByRole('button', { name: /Confirm target setup/ }).click();
  await expect(setupPanel).toContainText('Confirmed by root');
  assert.deepEqual(setupPut, { moduleUrl: '/registration', variants: ['OPD', 'IPD'], loginProfileId: firstProfile });

  const agent = page.locator('#ag-analyze-panel');
  await expect(agent.locator('.badge', { hasText: 'Interrupted' }).first()).toBeVisible();
  await agent.getByRole('button', { name: 'Retry' }).first().click();
  await expect.poll(() => retried).toBe('job-1');
  await expect(page.locator('#toasts')).toContainText('The coding agent finished');

  await agent.getByRole('button', { name: /^Analyze with Claude Code/ }).click();
  await expect(agent.locator('.agent-info')).toContainText('Nothing new to analyse since version 3');
  await agent.getByRole('button', { name: 'Run anyway' }).click();
  await expect.poll(() => startBodies.length).toBe(2);
  assert.equal(startBodies[1].force, true);

  await expect(page.locator('#insights-title')).toContainText('v3');
  await page.locator('.insights-history > summary').click();
  await expect(page.locator('.history-list')).toContainText('v2');
  await expect(page.locator('.history-list')).toContainText('Added 2 rules, corrected 1 field');
  await shot(page, 'intake-pipeline');

  // 5. Readiness feature hides itself when the server has no endpoint (404 without an error body).
  // 6. Phone width: no horizontal page scroll on the pages that carry the checklist.
  await page.setViewportSize({ width: 390, height: 800 });
  for (const sub of ['', '/intake', '/review', '/ai']) {
    await page.goto(`${base}/${moduleHash}${sub}`);
    await expect(page.locator('#readiness-panel')).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${sub || 'cases'} must not scroll horizontally at 390px`);
  }
  await shot(page, 'intake-mobile');
  assert.ok(moduleId);
  assert.deepEqual(errors, []);
});
