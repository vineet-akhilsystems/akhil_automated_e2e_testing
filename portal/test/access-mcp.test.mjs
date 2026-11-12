import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boot, signedIn, makeUser } from './support.mjs';

const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const server = fileURLToPath(new URL('../mcp-server.mjs', import.meta.url));

function mcpClient(env) {
  const child = spawn(process.execPath, [server], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map(); let buf = '', n = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
  const rpc = (method, params) => new Promise(resolve => { const id = ++n; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const call = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); const text = r.result.content[0].text; return { error: Boolean(r.result.isError), data: r.result.isError ? text : JSON.parse(text) }; };
  return { rpc, call, close: () => child.kill() };
}

test('an assistant account with only a module-level viewer membership sees one module and cannot write', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const bot = await makeUser(admin, 'bot', 'member');
  for (const [name, prefix] of [['Billing', 'BIL'], ['Payroll', 'PAY']]) assert.equal((await admin.request('/api/modules', 'POST', { name, prefix, area: 'Fin' })).status, 201);
  assert.equal((await admin.request('/api/modules/billing/members', 'POST', { subjectType: 'user', subjectId: bot.id, role: 'viewer' })).status, 201);
  const upload = await admin.request('/api/modules/payroll/intake/files', 'POST', Buffer.from('salary rules\n'), { 'x-file-name': 'pay.txt', 'content-type': 'application/octet-stream' });
  assert.equal(upload.status, 201);
  assert.equal((await admin.request('/api/modules/payroll/cases', 'POST', { id: 'PAY-001', title: 'Pay', mode: 'manual', category: 'C', priority: 'P1', steps: [{ action: 'a', expected: 'e' }] })).status, 201);
  const run = await admin.request('/api/runs', 'POST', { moduleId: 'payroll', environmentId: 'local', mode: 'manual', caseIds: ['PAY-001'], name: 'payroll run' });
  assert.equal(run.status, 201);

  const m = mcpClient({ PORTAL_URL: f.base, PORTAL_MCP_USER: 'bot', PORTAL_MCP_PASSWORD: bot.password });
  t.after(() => m.close());
  await m.rpc('initialize', { protocolVersion: '2024-11-05' });

  const listed = await m.call('list_modules');
  assert.equal(listed.error, false); assert.deepEqual(listed.data.map(x => x.id), ['billing']);
  assert.equal((await m.call('list_cases', { moduleId: 'billing' })).error, false);
  assert.equal((await m.call('list_intake_files', { moduleId: 'billing' })).error, false);
  assert.equal((await m.call('list_runs')).data.length, 0);

  // reading another module is "not found", exactly as if it did not exist
  for (const [tool, args] of [['list_intake_files', { moduleId: 'payroll' }], ['list_cases', { moduleId: 'payroll' }], ['get_insights', { moduleId: 'payroll' }],
    ['get_module_coverage', { moduleId: 'payroll' }], ['generate_ai_cases', { moduleId: 'payroll' }], ['get_module_schema', { moduleId: 'payroll' }],
    ['read_intake_file', { moduleId: 'payroll', fileId: upload.value.id }], ['get_run', { runId: run.value.id }]]) {
    const r = await m.call(tool, args);
    assert.equal(r.error, true, tool); assert.match(r.data, /not found/i, `${tool}: ${r.data}`);
  }
  // writing needs more than viewing, even on the visible module
  const saved = await m.call('save_insights', { moduleId: 'billing', summary: 'x', cases: [{ title: 't', steps: [{ action: 'a' }] }] });
  assert.equal(saved.error, true); assert.match(saved.data, /does not allow/i);
  assert.equal((await admin.request('/api/modules/billing/cases')).value.length, 0);
  const hidden = await m.call('save_insights', { moduleId: 'payroll', summary: 'x' });
  assert.equal(hidden.error, true); assert.match(hidden.data, /not found/i);
  assert.equal(f.store.insights('payroll'), undefined);

  // upgrading the same account to ba lets it save drafts, still only on its own module
  const membership = (await admin.request('/api/modules/billing/members')).value.find(x => x.subject.id === bot.id);
  assert.equal((await admin.request(`/api/memberships/${membership.id}`, 'PATCH', { role: 'ba' })).status, 200);
  const after = await m.call('save_insights', { moduleId: 'billing', summary: 'Billing rules.', cases: [{ title: 'Reject zero', steps: [{ action: 'enter 0', expected: 'error' }] }] });
  assert.equal(after.error, false, String(after.data)); assert.equal(after.data.draftCases, 1);
  assert.equal((await m.call('save_insights', { moduleId: 'payroll', summary: 'x' })).error, true);
});
