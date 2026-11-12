import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boot, signedIn, makeUser, until } from './support.mjs';

const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const server = fileURLToPath(new URL('../mcp-server.mjs', import.meta.url));

// Minimal MCP client over stdio.
function mcpClient(env) {
  const child = spawn(process.execPath, [server], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map(); let buf = '', n = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
  const rpc = (method, params) => new Promise(resolve => { const id = ++n; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const call = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); const text = r.result.content[0].text; return { error: Boolean(r.result.isError), data: r.result.isError ? text : JSON.parse(text) }; };
  return { rpc, call, close: () => child.kill() };
}

test('assistant reads uploaded files over MCP and saves insights; its drafts need approval before running', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const ba = await makeUser(admin, 'bob', 'ba');
  const b = await signedIn(f, 'bob', ba.password);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Finance' })).status, 201);
  const body = 'Invoice total must be at least 1.\nInvoice number is mandatory.\n';
  const up = await b.request('/api/modules/billing/intake/files', 'POST', Buffer.from(body), { 'x-file-name': 'rules.txt', 'content-type': 'application/octet-stream' });
  assert.equal(up.status, 201);
  await until(async () => (await b.request('/api/modules/billing/intake')).value.files[0].extract === 'ok');

  const m = mcpClient({ PORTAL_URL: f.base, PORTAL_MCP_USER: 'bob', PORTAL_MCP_PASSWORD: ba.password });
  t.after(() => m.close());
  const init = await m.rpc('initialize', { protocolVersion: '2024-11-05' });
  assert.equal(init.result.serverInfo.name, 'augastam-test-studio');
  const tools = (await m.rpc('tools/list')).result.tools.map(x => x.name);
  for (const name of ['list_modules', 'list_intake_files', 'read_intake_file', 'save_insights', 'list_cases', 'get_insights']) assert.ok(tools.includes(name), name);

  const files = await m.call('list_intake_files', { moduleId: 'billing' });
  assert.equal(files.data.files.length, 1);
  const text = await m.call('read_intake_file', { moduleId: 'billing', fileId: files.data.files[0].id });
  assert.match(text.data.text, /Invoice total must be at least 1/);

  const saved = await m.call('save_insights', {
    moduleId: 'billing', summary: 'Billing creates invoices; totals must be positive.',
    rules: [{ text: 'Total must be at least 1', source: 'rules.txt' }], edgeCases: ['Total of 0'], openQuestions: ['Are credit notes in scope?'],
    cases: [{ title: 'Reject an invoice with total 0', category: 'Validation', priority: 'P1', source: 'rules.txt', steps: [{ action: 'Enter total 0 and save', expected: 'A validation error is shown' }] }],
  });
  assert.equal(saved.error, false, String(saved.data));
  assert.equal(saved.data.draftCases, 1);

  const insights = await m.call('get_insights', { moduleId: 'billing' });
  assert.equal(insights.data.mode, 'assistant');
  assert.equal(insights.data.rules[0].text, 'Total must be at least 1');
  const cases = await m.call('list_cases', { moduleId: 'billing' });
  assert.equal(cases.data[0].reviewStatus, 'draft');

  // A viewer-level tool call fails cleanly rather than crashing.
  const bad = await m.call('read_intake_file', { moduleId: 'billing', fileId: 'nope' });
  assert.equal(bad.error, true);

  // Human approval gate still applies to the assistant's drafts.
  // A tester cannot run a draft; platform admins may by design (portal/app/context.mjs, "Platform administrators may run any case").
  const tu = await makeUser(admin, 'tess', 'tester'), tester = await signedIn(f, 'tess', tu.password);
  const run = await tester.request('/api/runs', 'POST', { name: 'Review gate check', moduleId: 'billing', caseIds: [cases.data[0].id], mode: 'manual', environmentId: 'local' });
  assert.equal(run.status, 409, JSON.stringify(run.value)); assert.match(run.value.error, /Only approved cases can be run/);
});

test('MCP schema, coverage, AI suggestions and automated draft proposals', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const ba = await makeUser(admin, 'bea', 'ba');
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Finance' })).status, 201);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Reg', prefix: 'REG', area: 'Front desk', adapter: 'registration' })).status, 201);
  const m = mcpClient({ PORTAL_URL: f.base, PORTAL_MCP_USER: 'bea', PORTAL_MCP_PASSWORD: ba.password });
  t.after(() => m.close());
  await m.rpc('initialize', {});
  const tools = (await m.rpc('tools/list')).result.tools.map(x => x.name);
  for (const name of ['get_module_coverage', 'generate_ai_cases', 'get_module_schema', 'propose_automated_cases']) assert.ok(tools.includes(name), name);

  const schema = await m.call('get_module_schema', { moduleId: 'reg' });
  assert.equal(schema.error, false, String(schema.data));
  assert.equal(schema.data.adapter.id, 'registration');
  assert.ok(Object.keys(schema.data.adapter.actions).includes('search'));
  assert.ok(schema.data.adapter.outcomes.includes('found'));
  assert.ok(schema.data.adapter.variants.length > 0);
  assert.equal((await m.call('get_module_schema', { moduleId: 'billing' })).data.adapter, null);
  assert.equal((await m.call('get_module_schema', { moduleId: 'nope' })).error, true);

  const cov = await m.call('get_module_coverage', { moduleId: 'reg' });
  assert.equal(cov.error, false, String(cov.data));
  assert.ok(cov.data.counts);

  // AI suggestions are returned, never saved.
  // Gated: needs processed sources and insights first (the adapter is connected).
  const early = await m.call('generate_ai_cases', { moduleId: 'reg', count: 2 });
  assert.equal(early.error, true); assert.match(String(early.data), /not available yet/);
  assert.equal((await admin.request('/api/modules/reg/intake/files', 'POST', Buffer.from('Phone must be 10 digits.\n'), { 'x-file-name': 'rules.txt' })).status, 201);
  await until(async () => (await admin.request('/api/modules/reg/intake')).value.files[0].extract === 'ok');
  assert.equal((await m.call('save_insights', { moduleId: 'reg', summary: 'Reg', cases: [] })).error, false);
  const gen = await m.call('generate_ai_cases', { moduleId: 'reg', count: 2 });
  assert.equal(gen.error, false, String(gen.data));
  assert.ok(Array.isArray(gen.data.drafts));
  assert.equal((await m.call('list_cases', { moduleId: 'reg' })).data.length, 0);

  // Automated proposals are saved as drafts; invalid ones are reported.
  const prop = await m.call('propose_automated_cases', { moduleId: 'reg', cases: [
    { title: 'Search finds a synthetic patient', category: 'Search', priority: 'P1', action: 'search', input: { search: 'Test' }, expected: { outcome: 'found' } },
    { title: 'Bad action', action: 'nonsense', input: {}, expected: { outcome: 'found' } },
  ] });
  assert.equal(prop.error, false, String(prop.data));
  assert.equal(prop.data.saved, 1);
  assert.equal(prop.data.failed, 1);
  const list = await m.call('list_cases', { moduleId: 'reg' });
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].reviewStatus, 'draft');
  assert.equal(list.data[0].mode, 'automated');
  const lit = await m.call('propose_automated_cases', { moduleId: 'reg', cases: [{ title: 'Edit a real patient', action: 'update', target: 'REAL-PATIENT-1', input: { email: 'a@example.test' }, expected: { outcome: 'updated' } }] });
  assert.equal(lit.data.saved, 0); assert.match(lit.data.errors[0].error, /CASE-ID/);
  assert.equal((await m.call('list_cases', { moduleId: 'reg' })).data.length, 1);
  const tu = await makeUser(admin, 'tess', 'tester'), tester = await signedIn(f, 'tess', tu.password);
  const run = await tester.request('/api/runs', 'POST', { name: 'Review gate check', moduleId: 'reg', caseIds: [list.data[0].id], mode: 'automated', environmentId: 'local' });
  assert.equal(run.status, 409, JSON.stringify(run.value)); assert.match(run.value.error, /Only approved cases can be run/);

  // A module without an adapter gets an explanation, not an error or a saved case.
  const none = await m.call('propose_automated_cases', { moduleId: 'billing', cases: [{ title: 'x', action: 'search', expected: { outcome: 'found' } }] });
  assert.equal(none.error, false);
  assert.equal(none.data.saved, 0);
  assert.match(none.data.reason, /no automation adapter/);
});

test('a viewer account cannot save insights through MCP', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const viewer = await makeUser(admin, 'vic', 'viewer');
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Finance' })).status, 201);
  const m = mcpClient({ PORTAL_URL: f.base, PORTAL_MCP_USER: 'vic', PORTAL_MCP_PASSWORD: viewer.password });
  t.after(() => m.close());
  await m.rpc('initialize', {});
  const r = await m.call('save_insights', { moduleId: 'billing', summary: 'x' });
  assert.equal(r.error, true);
});

test('MCP list_runs and get_run read the run history', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const ba = await makeUser(admin, 'rita', 'ba');
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Finance' })).status, 201);
  const made = await admin.request('/api/modules/billing/cases', 'POST', { id: 'BIL-001', title: 'Reject total 0', category: 'Validation', priority: 'P1', mode: 'manual', reviewStatus: 'approved', steps: [{ action: 'Enter 0', expected: 'Error shown' }] });
  assert.equal(made.status, 201, JSON.stringify(made.value));
  const run = await admin.request('/api/runs', 'POST', { moduleId: 'billing', caseIds: ['BIL-001'], mode: 'manual', environmentId: 'local', name: 'Manual billing run' });
  assert.equal(run.status, 201, JSON.stringify(run.value));

  const m = mcpClient({ PORTAL_URL: f.base, PORTAL_MCP_USER: 'rita', PORTAL_MCP_PASSWORD: ba.password });
  t.after(() => m.close());
  await m.rpc('initialize', {});
  const list = await m.call('list_runs');
  assert.equal(list.error, false, String(list.data));
  assert.ok(Array.isArray(list.data));
  const row = list.data.find(r => r.id === run.value.id);
  assert.ok(row, 'run listed');
  assert.equal(row.module.id, 'billing'); assert.equal(row.total, 1); assert.equal(row.cases, undefined);
  const one = await m.call('get_run', { runId: run.value.id });
  assert.equal(one.error, false, String(one.data));
  assert.equal(one.data.id, run.value.id); assert.equal(one.data.cases.length, 1);
});
