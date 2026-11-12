import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { boot, signedIn, makeUser, until } from './support.mjs';
import { agentEnv } from '../agent.mjs';

const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const probe = async id => ({ id, label: id, available: id !== 'codex', version: '9.9.9' });

// Fake coding-agent CLI: `behaviour` acts inside the workspace the portal prepared, like the real CLI would.
function fakeSpawn(behaviour) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    const call = { bin, args, opts, prompt: '' }; child.stdin.on('data', d => { call.prompt += d; }); calls.push(call);
    child.kill = () => { setImmediate(() => child.emit('exit', null)); return true; };
    setImmediate(() => behaviour({ bin, args, opts, child }));
    return child;
  };
  return { spawn, calls };
}
const finish = (child, code = 0) => { child.stdout.end(); child.stderr.end(); child.emit('exit', code); };

async function world(t, behaviour, extra = {}) {
  const fake = fakeSpawn(behaviour);
  const f = await boot(t, { bootstrap: ADMIN, agentOptions: { spawn: fake.spawn, probe }, ...extra });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const ba = await makeUser(admin, 'bob', 'ba'), viewer = await makeUser(admin, 'vic', 'viewer');
  const b = await signedIn(f, 'bob', ba.password), v = await signedIn(f, 'vic', viewer.password);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Finance' })).status, 201);
  const up = await b.request('/api/modules/billing/intake/files', 'POST', Buffer.from('Invoice total must be at least 1.\n'), { 'x-file-name': 'rules.txt', 'content-type': 'application/octet-stream' });
  assert.equal(up.status, 201);
  await until(async () => (await b.request('/api/modules/billing/intake')).value.files[0].extract === 'ok');
  return { f, fake, admin, b, v };
}
const wait = (c, jid) => until(async () => { const j = (await c.request(`/api/modules/billing/agent/jobs/${jid}`)).value; return j.status !== 'running' ? j : null; });

// Drives createAgentRunner directly with stub store/intake so workspace contents can be inspected without a portal.
async function directRun(t, { module, kind, cases, discovery, behaviour, extract = 'ok', ingestOut }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-agent-unit-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const discoveryRoot = path.join(tmp, 'qa-modules'), referenceDir = path.join(tmp, 'reference');
  fs.mkdirSync(referenceDir, { recursive: true });
  for (const n of ['fields.ts', 'registration.page.ts', 'case-runner.ts', 'cases.spec.ts', 'workflow-runner.ts', 'report.ts', 'controls.spec.ts', 'discovery.spec.ts', 'rebuild-report.ts', 'results-reporter.ts', 'extra.ts']) fs.writeFileSync(path.join(referenceDir, n), '// ref\n');
  for (const [rel, text] of Object.entries(discovery ?? {})) { const p = path.join(discoveryRoot, module.id, 'discovery', rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
  const file = { id: 'f1', name: 'rules.txt', kind: 'text', extract };
  const store = { intakeFiles: () => [file], cases: () => cases ?? [], module: () => module };
  const intake = { ensureExtracted: async files => files.map(f => ({ file: f, content: { text: 'Total must be at least 1.' } })) };
  let seen;
  const fake = fakeSpawn(({ opts, child }) => { seen = opts.cwd; behaviour?.(opts.cwd); finish(child); });
  const { createAgentRunner } = await import('../agent.mjs');
  const runner = createAgentRunner({ dataDir: path.join(tmp, 'data'), store, intake, ingest: () => ingestOut ?? ({ id: 'x', draftCases: 0 }), referenceDir, discoveryRoot, spawn: fake.spawn, probe });
  const job = await runner.start({ module, agent: 'claude', kind, user: { username: 'u' } });
  await until(() => runner.get(module.id, job.id).status !== 'running');
  return { ws: seen, job: runner.get(module.id, job.id), runner };
}

test('analyze brief and adapter-schema.json are written only when the module has an adapter', async t => {
  const withAdapter = await directRun(t, { module: { id: 'registration', name: 'Registration', area: 'EMR', adapter: 'registration', config: { bases: { valid: { first_name: 'Agent' } } } }, kind: 'analyze' });
  const schema = JSON.parse(fs.readFileSync(path.join(withAdapter.ws, 'input', 'adapter-schema.json'), 'utf8'));
  assert.ok(schema.fields.first_name && schema.actions.fill && schema.outcomes.includes('created') && schema.variants.includes('New Registration') && schema.bases.valid);
  const brief = fs.readFileSync(path.join(withAdapter.ws, 'INSTRUCTIONS.md'), 'utf8');
  assert.match(brief, /adapter-schema\.json/); assert.match(brief, /"mode": "automated"/); assert.match(brief, /Untrusted input boundary/); assert.match(brief, /synthetic data only/i);
  const without = await directRun(t, { module: { id: 'billing', name: 'Billing', area: 'Fin', config: {} }, kind: 'analyze' });
  assert.ok(!fs.existsSync(path.join(without.ws, 'input', 'adapter-schema.json')));
  assert.ok(!/"mode": "automated"/.test(fs.readFileSync(path.join(without.ws, 'INSTRUCTIONS.md'), 'utf8')));
});

test('automation workspace carries discovery (capped, text only), reference files and the adapter.json contract', async t => {
  const big = 'x'.repeat(250_000);
  const { ws, job } = await directRun(t, {
    module: { id: 'billing', name: 'Billing', area: 'Fin', config: {} }, kind: 'automation',
    cases: [{ id: 'BIL-001', title: 'T', category: 'c', priority: 'P1', steps: [{ action: 'a', expected: 'b' }], reviewStatus: 'approved' }],
    discovery: { 'fields-main.json': '{"a":1}', 'discovery.md': '# d', 'config/x.json': '{}', 'shot.png': 'binary', 'too-big.json': big },
    behaviour: cwd => { for (const n of ['fields.ts', 'billing.page.ts', 'case-runner.ts', 'cases.spec.ts', 'NOTES.md']) fs.writeFileSync(path.join(cwd, 'output', 'automation', n), '//\n'); fs.writeFileSync(path.join(cwd, 'output', 'automation', 'adapter.json'), '{bad'); },
  });
  assert.deepEqual(fs.readdirSync(path.join(ws, 'input', 'discovery'), { recursive: true }).map(String).map(s => s.replace(/\\/g, '/')).sort(), ['config', 'config/x.json', 'discovery.md', 'fields-main.json']);
  const ref = fs.readdirSync(path.join(ws, 'reference'));
  assert.ok(ref.length <= 10 && ['fields.ts', 'registration.page.ts', 'case-runner.ts', 'cases.spec.ts', 'workflow-runner.ts'].every(n => ref.includes(n)), ref.join());
  const brief = fs.readFileSync(path.join(ws, 'INSTRUCTIONS.md'), 'utf8');
  for (const s of ['billing.page.ts', 'tests/modules/billing/cases.spec.ts', 'adapter.json', 'NOTES.md', 'qa/modules/billing/adapter.json']) assert.ok(brief.includes(s), s);
  assert.equal(job.status, 'done');
  assert.ok(job.result.warnings.some(w => /not valid JSON/.test(w)));
});

test('automation without discovery tells the agent to mark TODOs instead of guessing', async t => {
  const { ws } = await directRun(t, { module: { id: 'billing', name: 'Billing', area: 'Fin', config: {} }, kind: 'automation', cases: [{ id: 'B-1', title: 'T', category: 'c', priority: 'P1', steps: [], reviewStatus: 'approved' }], behaviour: cwd => fs.writeFileSync(path.join(cwd, 'output', 'automation', 'NOTES.md'), 'x') });
  assert.ok(!fs.existsSync(path.join(ws, 'input', 'discovery')));
  assert.match(fs.readFileSync(path.join(ws, 'INSTRUCTIONS.md'), 'utf8'), /NOT available/);
});

test('agent environment keeps CLI login paths but drops portal secrets and API keys', () => {
  const env = agentEnv({ PATH: '/bin', HOME: '/h', APPDATA: 'a', PORTAL_ADMIN_PASSWORD: 'x', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', PORTAL_ACCESS_TOKEN: 't' });
  assert.deepEqual(Object.keys(env).sort(), ['APPDATA', 'HOME', 'PATH']);
});

test('status reports which agent CLIs exist; viewers cannot start a job', async t => {
  const { b, v } = await world(t, () => {});
  const st = (await b.request('/api/agent/status')).value;
  assert.deepEqual(st.agents.map(a => [a.id, a.available]), [['claude', true], ['codex', false]]);
  assert.equal((await v.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude', kind: 'analyze' })).status, 403);
  assert.equal((await b.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'codex', kind: 'analyze' })).status, 409); // not installed
  assert.equal((await b.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'nope' })).status, 400);
});

test('analyze job: the agent sees only its workspace, output is validated, drafts need approval', async t => {
  let seen;
  const { f, fake, b, admin } = await world(t, ({ opts, child }) => {
    seen = { cwd: opts.cwd, env: opts.env, input: fs.readdirSync(path.join(opts.cwd, 'input')), brief: fs.existsSync(path.join(opts.cwd, 'CLAUDE.md')) };
    fs.writeFileSync(path.join(opts.cwd, 'output', 'insights.json'), JSON.stringify({
      summary: 'Billing creates invoices.', rules: [{ text: 'Total must be at least 1', source: 'rules.txt' }],
      cases: [{ title: 'Reject total 0', category: 'Validation', priority: 'P1', source: 'rules.txt', steps: [{ action: 'Enter total 0', expected: 'A validation error is shown' }] }],
    }));
    child.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the rules' }, { type: 'tool_use', name: 'Read', input: { file_path: 'input/01-rules.txt' } }] } }) + '\n');
    finish(child);
  });
  const start = await b.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude', kind: 'analyze' });
  assert.equal(start.status, 202, JSON.stringify(start.value));
  const job = await wait(b, start.value.id);
  assert.equal(job.status, 'done', job.message);
  assert.equal(job.result.draftCases, 1);
  assert.ok(job.log.some(l => /Reading the rules/.test(l.text)) && job.log.some(l => /\[Read\]/.test(l.text)));

  assert.ok(seen.input.some(n => n.endsWith("rules.txt")) && seen.input.includes("MANIFEST.json") && seen.brief, JSON.stringify(seen.input));
  assert.equal(seen.env.PORTAL_ADMIN_PASSWORD, undefined); assert.equal(seen.env.ANTHROPIC_API_KEY, undefined);
  const call = fake.calls[0];
  assert.equal(call.bin, 'claude'); assert.match(call.prompt, /INSTRUCTIONS\.md/);
  assert.ok(call.args.includes('--disallowedTools') && /Bash/.test(call.args[call.args.indexOf('--disallowedTools') + 1]));
  assert.ok(call.opts.cwd.includes(path.join('agent', start.value.id)) || call.opts.cwd.includes('agent'));

  const insights = (await b.request('/api/modules/billing/insights')).value;
  assert.equal(insights.mode, 'agent:claude');
  const cases = (await b.request('/api/modules/billing/cases')).value;
  assert.equal(cases[0].reviewStatus, 'draft');
  // Review gate: a tester cannot run a draft. Platform admins may run drafts by design (portal/app/context.mjs, "Platform administrators may run any case").
  const tu = await makeUser(admin, 'tess', 'tester'), tester = await signedIn(f, 'tess', tu.password);
  const run = await tester.request('/api/runs', 'POST', { name: 'Review gate check', moduleId: 'billing', caseIds: [cases[0].id], mode: 'manual', environmentId: 'local' });
  assert.equal(run.status, 409, JSON.stringify(run.value)); assert.match(run.value.error, /Only approved cases can be run/);
  void f;
});

test('bad or missing agent output becomes a clear error, nothing is saved; cancel works', async t => {
  let mode = 'missing';
  const { b } = await world(t, ({ opts, child }) => {
    if (mode === 'missing') return finish(child);
    if (mode === 'invalid') { fs.writeFileSync(path.join(opts.cwd, 'output', 'insights.json'), '{"summary": ""}'); return finish(child); }
    // mode === 'hang': never exits until cancelled
  });
  let j = (await b.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude' })).value;
  j = await wait(b, j.id); assert.equal(j.status, 'error'); assert.match(j.message, /insights\.json/);

  mode = 'invalid';
  j = (await b.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude' })).value;
  j = await wait(b, j.id); assert.equal(j.status, 'error');
  assert.equal((await b.request('/api/modules/billing/cases')).value.length, 0);

  mode = 'hang';
  const started = (await b.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude' })).value;
  assert.equal((await b.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude' })).status, 409); // busy
  assert.equal((await b.request(`/api/modules/billing/agent/jobs/${started.id}/cancel`, 'POST')).status, 200);
  assert.equal((await wait(b, started.id)).status, 'cancelled');
});

test('automation proposal needs an approved case and a tester; files are listed but never installed', async t => {
  const qaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-qa-root-'));
  t.after(() => fs.rmSync(qaRoot, { recursive: true, force: true }));
  const { b, admin, f } = await world(t, ({ opts, child }) => {
    fs.writeFileSync(path.join(opts.cwd, 'output', 'automation', 'billing.spec.ts'), '// proposed spec\n');
    fs.writeFileSync(path.join(opts.cwd, 'output', 'automation', 'NOTES.md'), 'TODO selectors\n');
    finish(child);
  }, { qaRoot });
  assert.equal((await b.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude', kind: 'automation' })).status, 403); // ba cannot
  assert.equal((await admin.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude', kind: 'automation' })).status, 409); // no approved case yet
  const created = await admin.request('/api/modules/billing/cases', 'POST', { id: 'BIL-001', title: 'Total 0 rejected', category: 'Validation', priority: 'P1', mode: 'manual', steps: [{ action: 'Enter 0', expected: 'Error' }] });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.value));
  // The pipeline gate: an approved case alone is not enough (insights, confirmed setup and discovery are missing).
  const gated = await admin.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude', kind: 'automation' });
  assert.equal(gated.status, 409); assert.equal(gated.value.readiness.canProposeAutomation, false);
  assert.match(gated.value.error, /Insights/); assert.match(gated.value.error, /Target setup/); assert.match(gated.value.error, /Discovery/);
  assert.equal((await admin.request('/api/modules/billing/insights', 'PUT', { summary: 'Billing', cases: [] })).status, 201);
  assert.equal((await admin.request('/api/modules/billing/setup', 'PUT', { moduleUrl: '/billing', variants: [], loginProfileId: 'local' })).status, 200);
  fs.mkdirSync(path.join(qaRoot, 'billing', 'discovery'), { recursive: true }); fs.writeFileSync(path.join(qaRoot, 'billing', 'discovery', 'fields-default.json'), '{}');
  const s = await admin.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude', kind: 'automation' });
  assert.equal(s.status, 202, JSON.stringify(s.value));
  const job = await wait(admin, s.value.id);
  assert.equal(job.status, 'done', job.message);
  assert.deepEqual(job.result.files.map(x => x.path).sort(), ['NOTES.md', 'billing.spec.ts']);
  const file = await admin.request(`/api/modules/billing/agent/jobs/${s.value.id}/files?path=billing.spec.ts`);
  assert.match(file.value.text, /proposed spec/);
  assert.equal((await admin.request(`/api/modules/billing/agent/jobs/${s.value.id}/files?path=${encodeURIComponent('../../input/MANIFEST.json')}`)).status, 404);
  assert.ok(!fs.existsSync(path.join(f.directory, '..', 'tests', 'modules', 'billing')));
});

test('analysis refuses to start when every readable file is a partial (keyframes-only) video, and the brief explains partial entries', async t => {
  // The request returns at once; the job itself ends in a clear error because nothing readable was extracted.
  const partial = await directRun(t, { module: { id: 'billing', name: 'Billing', area: 'Fin', config: {} }, kind: 'analyze', extract: 'partial' });
  assert.equal(partial.job.status, 'error'); assert.match(partial.job.message, /keyframe/);
  const ok = await directRun(t, { module: { id: 'billing', name: 'Billing', area: 'Fin', config: {} }, kind: 'analyze' });
  const brief = fs.readFileSync(path.join(ok.ws, 'INSTRUCTIONS.md'), 'utf8');
  assert.match(brief, /partial/); assert.match(brief, /keyframe/);
});

test('automation brief does not ask for bases in adapter.json; Registration proposals are not offered for install', async t => {
  const cases = [{ id: 'B-1', title: 'T', category: 'c', priority: 'P1', steps: [], reviewStatus: 'approved' }];
  const write = cwd => fs.writeFileSync(path.join(cwd, 'output', 'automation', 'NOTES.md'), 'x');
  const bill = await directRun(t, { module: { id: 'billing', name: 'Billing', area: 'Fin', config: {} }, kind: 'automation', cases, behaviour: write });
  const brief = fs.readFileSync(path.join(bill.ws, 'INSTRUCTIONS.md'), 'utf8');
  assert.match(brief, /Do NOT put "bases" in adapter.json/); assert.ok(!/"bases": { "<name>"/.test(brief));
  assert.match(bill.job.message, /module:adapter:install/);
  const reg = await directRun(t, { module: { id: 'registration', name: 'Registration', area: 'EMR', adapter: 'registration', config: { bases: {} } }, kind: 'automation', cases, behaviour: write });
  assert.ok(!/module:adapter:install/.test(reg.job.message)); assert.match(reg.job.message, /cannot be installed/);
});

test('analyze brief is module-neutral except for Registration', async () => {
  const { instructions } = await import('../agent.mjs');
  // `registrationType` is the stored schema key for a case's variant, not copy; it is excluded from the scan.
  const banned = /registration|uhid|patient|newborn|guardian|REG-/i;
  for (const hasAdapterSchema of [false, true]) {
    const brief = instructions({ kind: 'analyze', module: { id: 'billing', name: 'Billing', area: 'Finance' }, hasAdapterSchema });
    assert.ok(!banned.test(brief.replace(/registrationType/g, 'variantKey')), `billing brief leaks: ${brief.match(banned)}`);
    assert.match(brief, /contradict/);
  }
  assert.match(instructions({ kind: 'analyze', module: { id: 'registration', name: 'Registration', area: 'Patient Care' } }), /minor without guardian/);
  assert.match(instructions({ kind: 'automation', module: { id: 'billing', name: 'Billing', area: 'Finance' } }), /variantLabel.*targetLabel.*targetPlaceholder/s);
});

test('starting a job never waits for file preparation, a videos-only module is refused instantly, and the busy message says what is running', async t => {
  const { createAgentRunner } = await import('../agent.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-agent-fast-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const module = { id: 'billing', name: 'Billing', area: 'Fin', config: {} };
  let files = [{ id: 'v1', name: 'walkthrough.mp4', kind: 'video', extract: 'unsupported' }];
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const store = { intakeFiles: () => files, cases: () => [] };
  // Extraction that takes "minutes": the request must not wait for it.
  const intake = { ensureExtracted: async fs_ => { await slow; return fs_.map(f => ({ file: f, content: { text: 'Total must be at least 1.' } })); } };
  const fake = fakeSpawn(({ child }) => finish(child));
  const runner = createAgentRunner({ dataDir: path.join(tmp, 'data'), store, intake, ingest: () => ({ id: 'x', draftCases: 0 }), spawn: fake.spawn, probe });

  // Videos only: refused in milliseconds with an actionable message, no job created.
  const t0 = Date.now();
  await assert.rejects(runner.start({ module, agent: 'claude', user: { username: 'u' } }), e => e.status === 409 && /could not process these videos/.test(e.message) && /transcript/.test(e.message));
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(runner.list('billing'), []);

  // A text file exists: start returns immediately even though extraction is slow.
  files = [{ id: 't1', name: 'rules.txt', kind: 'text', extract: 'pending' }];
  const t1 = Date.now();
  const job = await runner.start({ module, agent: 'claude', user: { username: 'u' } });
  assert.ok(Date.now() - t1 < 1000, 'start did not wait for extraction');
  assert.equal(runner.get('billing', job.id).status, 'running');
  // The second click gets a useful message while the first is still preparing.
  await assert.rejects(runner.start({ module, agent: 'claude', user: { username: 'u' } }), e => e.status === 409 && /busy with another job/.test(e.message) && /analysing files/.test(e.message) && /min ago/.test(e.message));
  release();
  await until(() => runner.get('billing', job.id).status !== 'running');
  assert.equal(runner.get('billing', job.id).status, 'error'); // the fake agent wrote no output: reported on the job, not as a hung request
});

test('agent output written with a UTF-8 byte-order mark (PowerShell on Windows) is still accepted', async t => {
  const out = { summary: 'Billing creates invoices.', rules: [{ text: 'Total must be at least 1', source: 'rules.txt' }], cases: [] };
  const { job } = await directRun(t, {
    module: { id: 'billing', name: 'Billing', area: 'Fin', config: {} }, kind: 'analyze',
    behaviour: cwd => fs.writeFileSync(path.join(cwd, 'output', 'insights.json'), '\uFEFF' + JSON.stringify(out), 'utf8'),
    ingestOut: { id: 'x', draftCases: 0 },
  });
  assert.equal(job.status, 'done', job.message);
});
