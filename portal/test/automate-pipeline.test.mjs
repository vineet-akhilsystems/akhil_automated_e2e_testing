import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { adapters, reloadAdapters } from '../registry.mjs';
import { buildDraftCases, saveExternalInsights } from '../insights.mjs';
import { convertCaseToAutomated, synthesizeAdapterProposal } from '../automate.mjs';
import { scanCode } from '../../qa/tools/install-module-adapter.mjs';
import { boot } from './support.mjs';

function makeTempRepo(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-auto-repo-'));
  fs.mkdirSync(path.join(repo, 'qa'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  t.after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    reloadAdapters({ warn: () => {} });
  });
  return repo;
}

test('POST /api/modules/:id/automate synthesizes scanCode-clean adapter, connects module, and converts manual cases', async t => {
  const repo = makeTempRepo(t);
  const f = await boot(t, { layoutRoot: repo, specRoot: repo });
  const created = await f.request('/api/modules', 'POST', {
    id: 'custom-intake',
    name: 'Custom Intake',
    area: 'Intake Flow',
    prefix: 'CI',
  });
  assert.equal(created.status, 201);

  const setupRes = await f.request('/api/modules/custom-intake/setup', 'PUT', {
    moduleUrl: '/custom-intake',
    variants: ['Standard', 'Express'],
    loginProfileId: 'local',
  });
  assert.equal(setupRes.status, 200);

  const manualRes = await f.request('/api/modules/custom-intake/cases', 'POST', {
    id: 'CI-001',
    title: 'Submit custom intake form with patient name and save',
    category: 'Submission',
    priority: 'P1',
    mode: 'manual',
    steps: [
      { action: 'Fill Patient Name with "Jane Doe"', expected: 'Field reflects Jane Doe' },
      { action: 'Click Save button', expected: 'Record is saved successfully' },
    ],
  });
  assert.equal(manualRes.status, 201);

  const autoRes = await f.request('/api/modules/custom-intake/automate', 'POST', {});
  assert.equal(autoRes.status, 200, JSON.stringify(autoRes.value));
  assert.equal(autoRes.value.adapter, 'custom-intake');
  assert.equal(autoRes.value.module.adapter, 'custom-intake');
  assert.equal(autoRes.value.totalCases, 1);
  assert.equal(autoRes.value.automatedCount, 1);

  const adapterJsonPath = path.join(repo, 'qa', 'augastam', 'custom-intake', 'adapter.json');
  const specPath = path.join(repo, 'tests', 'augastam', 'custom-intake', 'cases.spec.ts');
  const runnerPath = path.join(repo, 'tests', 'augastam', 'custom-intake', 'case-runner.ts');
  assert.ok(fs.existsSync(adapterJsonPath), 'adapter.json written');
  assert.ok(fs.existsSync(specPath), 'cases.spec.ts written');
  assert.ok(fs.existsSync(runnerPath), 'case-runner.ts written');

  for (const name of autoRes.value.files) {
    const filePath = name === 'adapter.json'
      ? adapterJsonPath
      : path.join(repo, 'tests', 'augastam', 'custom-intake', name);
    assert.deepEqual(scanCode(name, fs.readFileSync(filePath, 'utf8'), 'custom-intake'), [], `${name} failed scanCode`);
  }

  const listRes = await f.request('/api/modules/custom-intake/cases');
  assert.equal(listRes.status, 200);
  assert.equal(listRes.value.length, 1);
  assert.equal(listRes.value[0].mode, 'automated');
  assert.ok(['save', 'workflow', 'fill', 'search'].includes(listRes.value[0].action));
});

test('subsequent intake analysis on an automated module generates mode: automated drafts automatically', async t => {
  const repo = makeTempRepo(t);
  const f = await boot(t, { layoutRoot: repo, specRoot: repo });
  await f.request('/api/modules', 'POST', {
    id: 'custom-intake',
    name: 'Custom Intake',
    area: 'Clinical',
    prefix: 'CI',
  });
  await f.request('/api/modules/custom-intake/setup', 'PUT', {
    moduleUrl: '/custom-intake',
    variants: ['OPD'],
    loginProfileId: 'local',
  });
  const autoRes = await f.request('/api/modules/custom-intake/automate', 'POST', {});
  assert.equal(autoRes.status, 200);

  const mod = f.store.module('custom-intake');
  const direct = buildDraftCases({
    module: mod,
    existingCases: f.store.cases('custom-intake'),
    user: { username: 'tester' },
    insightId: 'ins-1',
    specs: [
      {
        title: 'Save clinical intake record with required patient details',
        category: 'Form Submission',
        priority: 'P1',
        steps: [
          { action: 'Fill Patient Name', expected: 'Value accepted' },
          { action: 'Click Save', expected: 'Confirmation toast appears' },
        ],
      },
    ],
  });
  assert.equal(direct.cases.length, 1);
  assert.equal(direct.cases[0].mode, 'automated');
  assert.equal(direct.automated, 1);

  const saved = saveExternalInsights({
    store: f.store,
    module: mod,
    user: { username: 'tester' },
    body: {
      summary: 'Follow-up video analysis',
      cases: [
        {
          title: 'Search existing intake record by patient name',
          category: 'Search',
          priority: 'P2',
          steps: [{ action: 'Enter query in search box and press Enter', expected: 'Matching rows load' }],
        },
      ],
    },
  });
  assert.equal(saved.draftCases, 1);
  assert.equal(saved.automatedDrafts, 1);
  const storedCase = f.store.cases('custom-intake').find(c => c.id === saved.draftIds[0]);
  assert.equal(storedCase.mode, 'automated');
});

test('miracle product module unblocks discovery, automation, and smoke readiness once automated', async t => {
  const repo = makeTempRepo(t);
  const authDir = path.join(repo, 'auth-miracle');
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(authDir, 'miracle.json'), '{}');

  const f = await boot(t, {
    layoutRoot: repo,
    specRoot: repo,
    environments: [
      { id: 'local', name: 'Local', url: 'http://application.invalid', authDir: path.join(repo, 'auth-local') },
      { id: 'miracle-uat', name: 'Miracle UAT', productId: 'miracle', url: 'http://miracle.invalid', authDir },
    ],
  });
  const created = await f.request('/api/modules', 'POST', {
    productId: 'miracle',
    name: 'Orders',
    area: 'Orders',
    prefix: 'MO',
  });
  assert.equal(created.status, 201);
  assert.equal(created.value.id, 'miracle-orders');

  const before = await f.request('/api/modules/miracle-orders/readiness');
  assert.equal(before.status, 200);
  const stageBefore = id => before.value.stages.find(s => s.id === id)?.status;
  assert.equal(stageBefore('discovery'), 'blocked');
  assert.equal(stageBefore('automation'), 'blocked');
  assert.equal(stageBefore('smoke'), 'blocked');

  await f.request('/api/modules/miracle-orders/setup', 'PUT', {
    moduleUrl: '/Orders/Entry.aspx',
    variants: ['Outpatient'],
    loginProfileId: 'miracle-uat',
  });

  const autoRes = await f.request('/api/modules/miracle-orders/automate', 'POST', {});
  assert.equal(autoRes.status, 200);

  const after = await f.request('/api/modules/miracle-orders/readiness');
  assert.equal(after.status, 200);
  const stageAfter = id => after.value.stages.find(s => s.id === id)?.status;
  assert.notEqual(stageAfter('discovery'), 'blocked');
  assert.equal(stageAfter('automation'), 'ready');
  assert.notEqual(stageAfter('smoke'), 'blocked');

  // Calling /discover when setup is confirmed vs missing returns 409 cleanly when setup missing (and does not 500)
  const emptyRes = await f.request('/api/modules', 'POST', { productId: 'miracle', name: 'Empty', area: 'Empty', prefix: 'ME' });
  assert.equal(emptyRes.status, 201);
  assert.equal(emptyRes.value.id, 'miracle-empty');
  const discRes = await f.request('/api/modules/miracle-empty/discover', 'POST', {});
  assert.equal(discRes.status, 409);
});

test('POST /api/modules/:id/agent/jobs/:jid/install installs finished automation job proposal and automates cases', async t => {
  const repo = makeTempRepo(t);
  const f = await boot(t, { layoutRoot: repo, specRoot: repo });
  await f.request('/api/modules', 'POST', {
    id: 'custom-intake',
    name: 'Custom Intake',
    area: 'Intake Flow',
    prefix: 'CI',
  });
  await f.request('/api/modules/custom-intake/setup', 'PUT', {
    moduleUrl: '/custom-intake',
    variants: ['OPD'],
    loginProfileId: 'local',
  });
  await f.request('/api/modules/custom-intake/cases', 'POST', {
    id: 'CI-010',
    title: 'Validate intake save flow',
    category: 'Validation',
    priority: 'P1',
    mode: 'manual',
    steps: [{ action: 'Click Save without inputs', expected: 'Validation error is displayed' }],
  });

  const mod = f.store.module('custom-intake');
  const proposal = synthesizeAdapterProposal({
    module: mod,
    setup: mod.setup,
    cases: f.store.cases('custom-intake'),
    layoutRoot: repo,
  });

  const jobId = 'job-auto-install-1';
  const outDir = path.join(f.directory, 'agent', jobId, 'output', 'automation');
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(proposal.files)) {
    fs.writeFileSync(path.join(outDir, name), content, 'utf8');
  }
  const nowIso = new Date().toISOString();
  f.store.saveAgentJob({
    id: jobId,
    moduleId: 'custom-intake',
    kind: 'automation',
    agent: 'claude',
    status: 'done',
    startedAt: nowIso,
    finishedAt: nowIso,
    createdBy: 'local',
    log: [{ t: nowIso, text: 'Proposal ready' }],
    result: { files: Object.keys(proposal.files).map(p => ({ path: p, size: proposal.files[p].length })) },
  });

  const installRes = await f.request(`/api/modules/custom-intake/agent/jobs/${jobId}/install`, 'POST', {});
  assert.equal(installRes.status, 200, JSON.stringify(installRes.value));
  assert.equal(installRes.value.ok, true);
  assert.equal(installRes.value.adapter, 'custom-intake');
  assert.equal(installRes.value.convertedCases, 1);

  const casesRes = await f.request('/api/modules/custom-intake/cases');
  assert.equal(casesRes.status, 200);
  assert.equal(casesRes.value[0].mode, 'automated');
});

test('synthesized runner enforces truthful checks and convertCaseToAutomated maps step fields without login pollution', t => {
  const mod = {
    id: 'clinical-workflow',
    productId: 'augastam',
    name: 'Clinical Workflow',
    prefix: 'CW',
    adapter: 'clinical-workflow',
    config: { bases: { valid: { new_process_name: 'Default Process' } }, requirements: [] },
  };
  const insights = {
    fields: [
      { name: 'Email ID / User Name', type: 'text', required: true },
      { name: 'New Process Name', type: 'text', required: false },
      { name: 'New Task Name', type: 'text', required: false },
    ],
    suggestedSetup: { moduleUrl: '/clinical-workflow', variants: ['OPD'] },
  };
  const proposal = synthesizeAdapterProposal({ module: mod, insights, setup: insights.suggestedSetup, cases: [] });
  adapters['clinical-workflow'] = proposal.adapter;
  t.after(() => { delete adapters['clinical-workflow']; });
  const runnerSrc = proposal.files['case-runner.ts'];
  const pageSrc = proposal.files['clinical-workflow.page.ts'];

  // Truthful failure assertions instead of silent no-ops
  assert.match(runnerSrc, /Field control "\$\{k\}" was not found on the page\./);
  assert.match(runnerSrc, /Save or Submit button was not found or could not be clicked on the page\./);
  assert.match(runnerSrc, /None of the expected workflow controls or screen elements were found on the page\./);
  assert.match(pageSrc, /verified: boolean/);
  assert.deepEqual(scanCode('case-runner.ts', runnerSrc, 'clinical-workflow'), []);
  assert.deepEqual(scanCode('clinical-workflow.page.ts', pageSrc, 'clinical-workflow'), []);

  // Pure verification cases become workflow/verified without unrelated inputs
  const inspectCase = convertCaseToAutomated({
    id: 'CW-001',
    title: 'Verify stage builder layout and page actions',
    category: 'Workflow stage builder',
    mode: 'manual',
    steps: [{ action: 'Look at the top right of the page.', expected: 'Save Stage, Publish and Preview buttons are shown.' }],
  }, mod, proposal.adapter);
  assert.equal(inspectCase.action, 'workflow');
  assert.equal(inspectCase.expected.outcome, 'verified');
  assert.deepEqual(inspectCase.input, {});

  // Form mutation cases extract their step-referenced field instead of polluting with email_id_user_name
  const addProcCase = convertCaseToAutomated({
    id: 'CW-002',
    title: 'Add process with empty name',
    category: 'Workflow stage builder',
    mode: 'manual',
    steps: [{ action: 'Leave New Process Name empty and click Add.', expected: 'Validation message asks for a name.' }],
  }, mod, proposal.adapter);
  assert.equal(addProcCase.action, 'save');
  assert.equal(addProcCase.expected.outcome, 'blocked');
  assert.equal(addProcCase.input.email_id_user_name, undefined);
  assert.equal(addProcCase.input.new_process_name, '');
});
