import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createPortal } from '../server.mjs';
import { relaxApproval } from './support.mjs';
import { resolveCases, validateCase, registrationData, workbookAutomation, ROOT } from '../registry.mjs';

const require = createRequire(import.meta.url), ExcelJS = require('exceljs');
const directories = [];
function temp() { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-portal-test-')); directories.push(p); return p; }
async function fixture(t, extra = {}) {
  const directory = temp(), authDir = path.join(directory, 'auth');
  fs.mkdirSync(authDir); fs.writeFileSync(path.join(authDir, 'admin.json'), '{}'); fs.writeFileSync(path.join(authDir, 'session.json'), '{}');
  const launches = [];
  const launch = (command, args, options) => {
    const child = new EventEmitter();
    child.kill = () => { setImmediate(() => child.emit('exit', null)); return true; };
    launches.push({ command, args, options, child }); return child;
  };
  const p = createPortal({ dataDir: directory, environments: [{ id: 'local', name: 'Local fixture', url: 'http://application.invalid', authDir }], launch, ...extra });
  if (!extra.strict) relaxApproval(p.store);
  await new Promise(resolve => p.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await p.close();
    // Only remove this test's explicitly-created temporary workspace.
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('augastam-portal-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${p.server.address().port}`;
  async function request(route, method = 'GET', body, headers = {}) {
    const response = await fetch(base + route, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = (response.headers.get('content-type') ?? '').includes('application/json') ? await response.json() : await response.arrayBuffer();
    return { status: response.status, value, response };
  }
  return { ...p, request, base, directory, authDir, launches };
}
const manualCase = (id = 'FAC-001') => ({ id, title: 'Create a facility', mode: 'manual', category: 'Facility', priority: 'P1', input: {}, steps: [{ action: 'Enter a unique facility name and save.', expected: 'The new facility appears in the facility list.' }] });
async function addModule(f) { const r = await f.request('/api/modules', 'POST', { name: 'Facility Setup', area: 'Setup', prefix: 'FAC', description: 'Facility configuration' }); assert.equal(r.status, 201); return r.value; }
const tick = () => new Promise(resolve => setTimeout(resolve, 30));

test('unimplemented workbook selections finish BLOCKED without login, manual entry or fabricated passing evidence', async t => {
  const f = await fixture(t);
  fs.unlinkSync(path.join(f.authDir, 'admin.json')); fs.unlinkSync(path.join(f.authDir, 'session.json'));
  const c = workbookAutomation.cases.find(c => c.id === 'TC_REG_066');
  assert.equal((await f.request('/api/modules/registration/cases', 'POST', c)).status, 201);
  const created = await f.request('/api/runs', 'POST', { moduleId: 'registration', environmentId: 'local', mode: 'automated', caseIds: [c.id], name: 'Blocked merge requirement' });
  assert.equal(created.status, 201); await tick();
  const runDir = f.launches[0].options.env.PORTAL_RUN_DIR;
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ id: c.id, title: c.title, status: 'BLOCKED', verificationPerformed: false, expected: c.steps[0].expected, actual: c.automationBlocker, attachments: [], mismatches: [], durationMs: 0 }) + '\n');
  f.launches[0].child.emit('exit', 0); await tick();
  const finished = (await f.request(`/api/runs/${created.value.id}`)).value;
  assert.equal(finished.status, 'blocked');
  assert.equal(finished.results[0].status, 'BLOCKED');
  assert.equal(finished.results[0].verificationPerformed, false);
  assert.equal((await f.request(`/api/runs/${created.value.id}/results/${c.id}`, 'POST', { status: 'PASS', actual: 'Manual entry' })).status, 409);
  const boot = (await f.request('/api/bootstrap')).value;
  assert.equal(boot.modules[0].blockedAutomationCount, 1);
  assert.equal(boot.modules[0].automatedCount, registrationData.cases.filter(c => c.enabled !== false).length);
});

test('default server login appears in Settings and a blank edit preserves its password without returning it', async t => {
  const credentials = { AUGASTAM_USER: 'default-fixture-user', AUGASTAM_PASS: 'default-fixture-secret', AUGASTAM_TENANT: 'Fixture tenant', AUGASTAM_FACILITY: 'Fixture facility', AUGASTAM_ROLE: 'QA' };
  const previous = Object.fromEntries(Object.keys(credentials).map(k => [k, process.env[k]]));
  Object.assign(process.env, credentials);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const f = await fixture(t);
  const profile = (await f.request('/api/bootstrap')).value.environments[0];
  assert.equal(profile.login.username, credentials.AUGASTAM_USER);
  assert.equal(profile.login.tenant, credentials.AUGASTAM_TENANT);
  assert.equal(profile.passwordSaved, true);
  assert.ok(!JSON.stringify(profile).includes(credentials.AUGASTAM_PASS));
  const saved = await f.request('/api/environments', 'POST', { id: profile.id, name: profile.name, url: profile.url, version: profile.version, credentials: { ...profile.login, password: '' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.passwordSaved, true);
  assert.equal(saved.value.loginSource, 'settings');
  const login = await f.request('/api/environments/local/auth', 'POST', {});
  assert.equal(login.status, 201); await tick();
  assert.equal(f.launches[0].options.env.AUGASTAM_PASS, credentials.AUGASTAM_PASS);
  assert.ok(!JSON.stringify(login.value).includes(credentials.AUGASTAM_PASS));
  f.launches[0].child.emit('exit', 0); await tick();
});

test('UI login profiles encrypt secrets, isolate sessions, reject unsafe edits and supply only the selected login to the worker', async t => {
  const f = await fixture(t);
  const body = { id: 'ba-uat', name: 'BA UAT', url: 'https://uat.example.test', version: 0,
    credentials: { username: 'ba@example.test', password: 'fixture-only-password-42', tenant: 'Test tenant', facility: 'Test facility', role: 'BA' } };
  const created = await f.request('/api/environments', 'POST', body);
  assert.equal(created.status, 201);
  assert.equal(created.value.passwordSaved, true);
  assert.equal(created.value.session, 'missing');
  assert.equal(created.value.login.username, body.credentials.username);
  assert.ok(!JSON.stringify(created.value).includes(body.credentials.password));
  assert.ok(!fs.readFileSync(path.join(f.directory, 'environment-settings.json'), 'utf8').includes(body.credentials.password));
  assert.ok(!fs.readFileSync(path.join(f.directory, 'environment-settings.json'), 'utf8').includes(body.credentials.username));
  const blankPassword = { ...body, version: 1, credentials: { ...body.credentials, password: '' } };
  assert.equal((await f.request('/api/environments', 'POST', blankPassword)).status, 200);
  assert.equal((await f.request('/api/environments', 'POST', blankPassword)).status, 409);
  assert.equal((await f.request('/api/environments', 'POST', { ...blankPassword, version: 2, url: 'https://different.example.test' })).status, 400);
  for (const url of ['file:///etc/passwd', 'https://user:password@example.test', 'https://example.test/?token=secret']) {
    assert.equal((await f.request('/api/environments', 'POST', { ...body, id: 'bad-profile', url })).status, 400);
  }
  const login = await f.request('/api/environments/ba-uat/auth', 'POST', {});
  assert.equal(login.status, 201); await tick();
  const worker = f.launches[0];
  assert.equal(worker.options.env.BASE_URL, body.url);
  assert.equal(worker.options.env.AUGASTAM_USER, body.credentials.username);
  assert.equal(worker.options.env.AUGASTAM_PASS, body.credentials.password);
  assert.equal(worker.options.env.PORTAL_AUTH_RUN, '1');
  assert.ok(worker.options.env.AUTH_DIR.endsWith(path.join('ba-uat', 'v2')));
  assert.equal((await f.request('/api/environments', 'POST', { ...blankPassword, version: 2 })).status, 409);
  assert.ok(!JSON.stringify(f.store.run(login.value.id)).includes(body.credentials.password));
  fs.writeFileSync(path.join(f.directory, 'runs', login.value.id, 'auth-status.json'), JSON.stringify({ stage: 'tenant', message: body.credentials.password }));
  worker.child.emit('exit', 1); await tick();
  assert.equal(f.store.run(login.value.id).status, 'error');
  assert.ok(f.store.run(login.value.id).error.includes('Settings'));
  assert.ok(f.store.run(login.value.id).error.includes('tenant'));
  assert.ok(!f.store.run(login.value.id).error.includes(body.credentials.password));
  const boot = await f.request('/api/bootstrap');
  assert.ok(!JSON.stringify(boot.value).includes(body.credentials.password));
  const log = fs.readFileSync(path.join(f.directory, 'runs', login.value.id, 'runner.log'), 'utf8');
  assert.ok(!log.includes(body.credentials.password));
});

test('registration workflow API validates definitions and preserves synthetic patient prerequisites in runs', async t => {
  const f = await fixture(t);
  const baseline = { ...structuredClone(registrationData.cases[0]), id: 'REG-WORKFLOW-BASE', mode: 'automated' };
  assert.equal((await f.request('/api/modules/registration/cases', 'POST', baseline)).status, 201);
  const c = { id: 'REG-WORKFLOW-CHECK', title: 'Verify saved patient identity', action: 'workflow', input: { workflow: 'search-identity' }, expected: { outcome: 'verified' }, target: '{{regId@REG-WORKFLOW-BASE}}' };
  assert.equal((await f.request('/api/modules/registration/cases', 'POST', { ...c, input: { workflow: 'unsupported' } })).status, 400);
  assert.equal((await f.request('/api/modules/registration/cases', 'POST', c)).status, 201);
  const result = await f.request('/api/runs', 'POST', { moduleId: 'registration', environmentId: 'local', mode: 'automated', caseIds: [c.id], name: 'Workflow prerequisites' });
  assert.equal(result.status, 201);
  const snapshot = f.store.run(result.value.id);
  assert.deepEqual(snapshot.cases.map(c => c.id), [baseline.id, c.id]);
});

test('bootstrap imports existing cases once, excludes secrets and supports new independent modules', async t => {
  const f = await fixture(t);
  const boot = await f.request('/api/bootstrap'); assert.equal(boot.status, 200);
  assert.equal(boot.value.modules[0].caseCount, registrationData.cases.length);
  assert.equal(boot.value.environments[0].session, 'saved');
  assert.equal(boot.value.environments[0].authDir, undefined);
  assert.equal(boot.value.adapters[0].spec, undefined);
  const m = await addModule(f); assert.equal(m.adapter, null); assert.equal(m.area, 'Setup');
  const duplicate = await f.request('/api/modules', 'POST', { name: 'Facility Setup', area: 'Setup', prefix: 'FAC' }); assert.equal(duplicate.status, 409);
  assert.equal((await f.request('/api/modules/registration/cases')).value.length, registrationData.cases.length);
  assert.equal((await f.request(`/api/modules/${m.id}/cases`)).value.length, 0);
});

test('case editing validates expected steps, prevents duplicates and rejects stale writes', async t => {
  const f = await fixture(t); await addModule(f);
  assert.equal((await f.request('/api/modules/facility-setup/cases', 'POST', {})).status, 400);
  assert.equal((await f.request('/api/modules/facility-setup/cases', 'POST', { ...manualCase(), steps: [null] })).status, 400);
  assert.equal((await f.request('/api/modules/facility-setup/cases', 'POST', { ...manualCase(), steps: [] })).status, 400);
  const created = await f.request('/api/modules/facility-setup/cases', 'POST', manualCase()); assert.equal(created.status, 201);
  assert.equal((await f.request('/api/modules/facility-setup/cases', 'POST', manualCase())).status, 409);
  const changed = await f.request('/api/modules/facility-setup/cases/FAC-001', 'PUT', { ...created.value, title: 'Updated requirement' }); assert.equal(changed.status, 200);
  assert.equal((await f.request('/api/modules/facility-setup/cases/FAC-001', 'PUT', { ...created.value, title: 'Stale edit' })).status, 409);
  assert.equal(f.store.case('facility-setup', 'FAC-001').title, 'Updated requirement');
});

test('manual runs preserve case snapshots, require every result and lock completed results', async t => {
  const f = await fixture(t); await addModule(f);
  const c = (await f.request('/api/modules/facility-setup/cases', 'POST', manualCase())).value;
  const run = await f.request('/api/runs', 'POST', { name: 'Setup acceptance', moduleId: 'facility-setup', mode: 'manual', environmentId: 'local', caseIds: [c.id] }); assert.equal(run.status, 201);
  assert.equal(run.value.status, 'manual');
  await f.request('/api/modules/facility-setup/cases/FAC-001', 'PUT', { ...c, title: 'Changed later' });
  const detail = (await f.request(`/api/runs/${run.value.id}`)).value;
  assert.equal(detail.cases[0].title, 'Create a facility');
  assert.equal((await f.request(`/api/runs/${run.value.id}/complete`, 'POST', {})).status, 409);
  assert.equal((await f.request(`/api/runs/${run.value.id}/results`, 'POST', { id: c.id, status: 'PASS', actual: 'Facility appeared in the list.' })).status, 200);
  assert.equal((await f.request(`/api/runs/${run.value.id}/complete`, 'POST', {})).value.status, 'passed');
  assert.equal((await f.request(`/api/runs/${run.value.id}/results`, 'POST', { id: c.id, status: 'FAIL', actual: 'Overwrite attempt' })).status, 409);
  assert.equal((await f.request(`/api/runs/${run.value.id}/export?format=xlsx`)).status, 200);
});

test('imports validate the complete batch before saving and never silently overwrite cases', async t => {
  const f = await fixture(t); await addModule(f);
  const route = '/api/modules/facility-setup/import';
  const invalid = await f.request(route, 'POST', { format: 'json', data: { cases: [manualCase(), { ...manualCase('FAC-002'), steps: [] }] } }); assert.equal(invalid.status, 400);
  assert.equal(f.store.cases('facility-setup').length, 0);
  const valid = await f.request(route, 'POST', { format: 'json', data: { cases: [manualCase()] } }); assert.equal(valid.value.imported, 1);
  assert.equal((await f.request(route, 'POST', { format: 'json', data: { cases: [manualCase(), manualCase('FAC-002')] } })).status, 409);
  assert.equal(f.store.cases('facility-setup').length, 1);
});

test('Excel round trips manual steps and automated boolean/empty overrides', async t => {
  const f = await fixture(t); await addModule(f);
  await f.request('/api/modules/facility-setup/cases', 'POST', manualCase());
  const exported = await f.request('/api/modules/facility-setup/export?format=xlsx');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(exported.value); const ws = wb.getWorksheet('cases');
  assert.match(String(ws.getRow(2).getCell(8).value), /facility list/); ws.getRow(2).getCell(1).value = 'FAC-002';
  const imported = await f.request('/api/modules/facility-setup/import', 'POST', { format: 'xlsx', data: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64') }); assert.equal(imported.status, 201);
  assert.equal(f.store.case('facility-setup', 'FAC-002').steps[0].expected, manualCase().steps[0].expected);
  const { toXlsx, fromXlsx } = require('../../qa/tools/cases-io.js'); const target = path.join(f.directory, 'round-trip.xlsx');
  await toXlsx([{ id: 'REG-X', title: 'Overrides', input: { consent: false, email: '' }, expected: { outcome: 'blocked' }, steps: [] }], target);
  const values = await fromXlsx(target); assert.equal(values[0].input.consent, false); assert.equal(values[0].input.email, '');
  // Neutral `variant` header on export; both `variant` and legacy `registrationType` import.
  await toXlsx([{ id: 'REG-V', title: 'Variant', registrationType: 'Cash Bill', input: {}, expected: { outcome: 'blocked' }, steps: [] }], target);
  const sheet = new ExcelJS.Workbook(); await sheet.xlsx.readFile(target); const head = sheet.getWorksheet('cases').getRow(1).values.slice(1);
  assert.ok(head.includes('variant') && !head.includes('registrationType'));
  assert.equal((await fromXlsx(target))[0].registrationType, 'Cash Bill');
  sheet.getWorksheet('cases').getRow(1).getCell(head.indexOf('variant') + 1).value = 'registrationType'; await sheet.xlsx.writeFile(target);
  assert.equal((await fromXlsx(target))[0].registrationType, 'Cash Bill');
});

test('automation validates adapter fields, sessions and manual-only modules', async t => {
  const f = await fixture(t); await addModule(f);
  const bad = { id: 'REG-X', title: 'Unknown field', category: 'General', mode: 'automated', action: 'fill', input: { non_existent: 'x' }, expected: { outcome: 'field-state' } };
  assert.equal((await f.request('/api/modules/registration/cases', 'POST', bad)).status, 400);
  assert.equal((await f.request('/api/modules/facility-setup/cases', 'POST', { ...bad, input: {} })).status, 400);
  fs.writeFileSync(path.join(f.authDir, 'session.json'), JSON.stringify({ token: `a.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.b` }));
  assert.equal((await f.request('/api/runs', 'POST', { name: 'Expired session', moduleId: 'registration', environmentId: 'local', mode: 'automated', caseIds: ['REG-024'] })).status, 409);
  for (const c of f.store.cases('registration')) validateCase(c, f.store.module('registration'));
});

test('dependency resolution includes prerequisites, sorts them, and rejects cycles/missing cases', () => {
  const all = [{ id: 'B', input: { search: '{{phone@A}}' } }, { id: 'A', input: {} }];
  assert.deepEqual(resolveCases(all, ['B']).map(c => c.id), ['A', 'B']);
  assert.throws(() => resolveCases(all, ['C']), /missing/);
  assert.throws(() => resolveCases([{ id: 'A', input: { x: '{{phone@B}}' } }, { id: 'B', input: { x: '{{phone@A}}' } }], ['A']), /cycle/);
});

test('worker queue runs FIFO, isolates output/snapshots and reports interrupted executions truthfully', async t => {
  const f = await fixture(t);
  const payload = { name: 'First', moduleId: 'registration', environmentId: 'local', mode: 'automated', caseIds: ['REG-024'] };
  const first = (await f.request('/api/runs', 'POST', payload)).value;
  const second = (await f.request('/api/runs', 'POST', { ...payload, name: 'Second' })).value;
  await tick(); assert.equal(f.launches.length, 1);
  const call = f.launches[0]; assert.equal(call.options.cwd, ROOT); assert.equal(call.options.env.BASE_URL, 'http://application.invalid');
  const snapshot = JSON.parse(fs.readFileSync(call.options.env.CASES_FILE)); assert.equal(snapshot.cases.length, 1); assert.equal(snapshot.cases[0].id, 'REG-024');
  assert.ok(call.options.env.PORTAL_REPORT_DIR.startsWith(f.directory));
  fs.appendFileSync(path.join(call.options.env.PORTAL_RUN_DIR, 'events.jsonl'), JSON.stringify({ id: 'REG-024', status: 'PASS', actual: 'Letters removed', expected: 'Digits only', durationMs: 5 }) + '\n');
  call.child.emit('exit', 0); await tick();
  assert.equal(f.store.run(first.id).status, 'passed'); assert.equal(f.launches.length, 2);
  assert.notEqual(f.launches[1].options.env.CASES_FILE, call.options.env.CASES_FILE);
  f.launches[1].child.emit('exit', 1); await tick(); assert.equal(f.store.run(second.id).status, 'error');
});

test('queued cancellation skips execution and active cancellation stops the worker', async t => {
  const f = await fixture(t);
  const payload = { name: 'Run', moduleId: 'registration', environmentId: 'local', mode: 'automated', caseIds: ['REG-024'] };
  const a = (await f.request('/api/runs', 'POST', payload)).value, b = (await f.request('/api/runs', 'POST', payload)).value;
  assert.equal((await f.request(`/api/runs/${b.id}/cancel`, 'POST', {})).status, 200);
  assert.equal(f.store.run(b.id).status, 'cancelled');
  await f.request(`/api/runs/${a.id}/cancel`, 'POST', {}); await tick();
  assert.equal(f.store.run(a.id).status, 'cancelled'); assert.equal(f.launches.length, 1);
});

test('team access requires login, rejects cross-origin writes and prevents arbitrary file access', async t => {
  const f = await fixture(t, { token: 'a-test-access-key-of-sufficient-length' });
  assert.equal((await f.request('/api/bootstrap')).status, 401);
  assert.equal((await f.request('/api/login', 'POST', { token: 'wrong' })).status, 401);
  const login = await f.request('/api/login', 'POST', { token: 'a-test-access-key-of-sufficient-length' }); assert.equal(login.status, 200);
  const cookie = login.response.headers.get('set-cookie').split(';')[0]; assert.match(login.response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await f.request('/api/bootstrap', 'GET', undefined, { Cookie: cookie })).status, 200);
  assert.equal((await f.request('/api/modules', 'POST', { name: 'Bad origin' }, { Cookie: cookie, Origin: 'https://unrelated.invalid' })).status, 403);
  assert.equal((await f.request('/.env')).status, 404);
  assert.equal((await f.request('/api/logout', 'POST', {}, { Cookie: cookie })).status, 200);
  assert.equal((await f.request('/api/bootstrap', 'GET', undefined, { Cookie: cookie })).status, 401);
});

test('SQLite data survives restart and previously running jobs become interrupted', async t => {
  const f = await fixture(t); await addModule(f);
  f.store.saveRun({ id: 'orphan', status: 'running', module: { id: 'registration', name: 'Registration' }, cases: [], results: [] });
  const { openStore } = await import('../store.mjs'), { createQueue } = await import('../queue.mjs');
  const another = openStore(f.directory);
  assert.equal(another.module('facility-setup').name, 'Facility Setup');
  createQueue(another, f.directory, []); assert.equal(another.run('orphan').status, 'interrupted'); another.close();
});

test('a second portal cannot supervise the same data directory', async t => {
  const f = await fixture(t);
  assert.throws(() => createPortal({ dataDir: f.directory, token: '' }), /already has a running server/);
  assert.equal((await f.request('/api/bootstrap')).status, 200);
});

test('starting the CLI again prints the existing portal URL and exits successfully', async t => {
  const f = await fixture(t);
  const before = JSON.parse(fs.readFileSync(path.join(f.directory, 'worker.lock'), 'utf8'));
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['portal/server.mjs'], {
    cwd: ROOT, timeout: 15000,
    env: { ...process.env, PORTAL_DATA_DIR: f.directory, PORTAL_HOST: '127.0.0.1', PORTAL_ACCESS_TOKEN: '' },
  });
  assert.match(stdout, /already running/);
  assert.ok(stdout.includes(f.base));
  assert.equal(stderr, '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, 'worker.lock'), 'utf8')).pid, before.pid);
  assert.equal((await f.request('/api/bootstrap')).status, 200);
});

test('all OpenAPI schema references resolve and every operation declares a response', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'portal/openapi.json'), 'utf8'));
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      assert.ok(value.$ref.startsWith('#/'));
      const target = value.$ref.slice(2).split('/').reduce((node, key) => node?.[key], spec);
      assert.ok(target, `Unresolved schema reference ${value.$ref}`);
    }
    Object.values(value).forEach(visit);
  };
  visit(spec);
  for (const pathItem of Object.values(spec.paths)) for (const operation of Object.values(pathItem)) {
    assert.ok(operation.operationId); assert.ok(operation.responses['200'] || operation.responses['201']);
  }
});

test('coverage requirements link to cases and stale results never appear as current passes', async t => {
  const f = await fixture(t); const m = await addModule(f);
  const updated = await f.request('/api/modules/facility-setup/requirements', 'PUT', { version: m.version, requirements: [{ id: 'FAC-REQ-1', title: 'Create a facility' }] }); assert.equal(updated.status, 200);
  const c = (await f.request('/api/modules/facility-setup/cases', 'POST', { ...manualCase(), requirement: 'FAC-REQ-1' })).value;
  let q = (await f.request('/api/modules/facility-setup/coverage?environmentId=local')).value;
  assert.equal(q.requirements[0].caseIds.length, 1); assert.equal(q.counts.neverRun, 1);
  const r = (await f.request('/api/runs', 'POST', { name: 'Coverage check', moduleId: m.id, environmentId: 'local', mode: 'manual', caseIds: [c.id] })).value;
  await f.request(`/api/runs/${r.id}/results`, 'POST', { id: c.id, status: 'PASS', actual: 'Facility saved.' });
  await f.request(`/api/runs/${r.id}/complete`, 'POST', {});
  q = (await f.request('/api/modules/facility-setup/coverage?environmentId=local')).value; assert.equal(q.counts.passed, 1);
  await f.request('/api/modules/facility-setup/cases/FAC-001', 'PUT', { ...c, title: 'Changed definition' });
  q = (await f.request('/api/modules/facility-setup/coverage?environmentId=local')).value; assert.equal(q.counts.passed, 0); assert.equal(q.counts.stale, 1);
});

test('manual evidence, triage and final PDF preserve the result snapshot', { timeout: 30000 }, async t => {
  const f = await fixture(t); await addModule(f);
  await f.request('/api/modules/facility-setup/cases', 'POST', manualCase());
  const r = (await f.request('/api/runs', 'POST', { name: 'Facility acceptance', moduleId: 'facility-setup', environmentId: 'local', mode: 'manual', caseIds: ['FAC-001'] })).value;
  assert.equal((await f.request(`/api/runs/${r.id}/export?format=pdf`)).status, 409);
  await f.request(`/api/runs/${r.id}/results`, 'POST', { id: 'FAC-001', status: 'FAIL', actual: 'The facility is missing after saving.' });
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4gAAAABJRU5ErkJggg==';
  const uploaded = await f.request(`/api/runs/${r.id}/evidence`, 'POST', { caseId: 'FAC-001', name: 'facility-screen.png', data: image }); assert.equal(uploaded.status, 200);
  await f.request(`/api/runs/${r.id}/results`, 'POST', { id: 'FAC-001', status: 'FAIL', actual: 'The facility is still missing after saving.' });
  assert.equal(f.store.run(r.id).results[0].attachments.length, 1, 'Updating the manual result retains evidence.');
  await f.request(`/api/runs/${r.id}/complete`, 'POST', {});
  assert.equal((await f.request(`/api/runs/${r.id}/evidence`, 'POST', { caseId: 'FAC-001', name: 'late.png', data: image })).status, 409);
  assert.equal((await f.request(`/api/runs/${r.id}/triage/FAC-001`, 'PUT', { severity: 'High', owner: 'BA team', reference: 'BUG-123', impact: 'Cannot configure a facility.' })).status, 200);
  await f.request(`/api/runs/${r.id}/report`, 'PUT', { preparedBy: 'Acceptance team', release: '2026.11', build: '42' });
  const pdf = await f.request(`/api/runs/${r.id}/export?format=pdf`); assert.equal(pdf.status, 200);
  assert.equal(pdf.response.headers.get('content-type'), 'application/pdf');
  assert.ok(pdf.response.headers.get('content-disposition').includes('facility-setup-bug-report-'));
  assert.equal(Buffer.from(pdf.value).subarray(0, 5).toString(), '%PDF-');
  const cached = await f.request(`/api/runs/${r.id}/export?format=pdf`); assert.deepEqual(Buffer.from(cached.value), Buffer.from(pdf.value));
  assert.equal(f.store.run(r.id).results[0].actual, 'The facility is still missing after saving.');
});

test('unsupported assertions and pending upload automation cannot silently run', async t => {
  const f = await fixture(t);
  const base = { id: 'REG-NEW', title: 'Invalid assertion configuration', mode: 'automated', category: 'Validation', priority: 'P2', input: {}, action: 'fill', expected: { outcome: 'field-state' } };
  for (const c of [
    { ...base, expected: { outcome: 'field-state', persisted: { mobile: '123' } } },
    { ...base, expected: { outcome: 'field-state', saveDisabled: true } },
    { ...base, action: 'search', input: { search: '123' }, expected: { outcome: 'found', values: { mobile: '123' } } },
    { ...base, input: { id_proof_file: 'qa/modules/registration/data/agent-test-id-proof.pdf' } },
    { ...base, expected: { outcome: 'observe', values: { mobile: '123' } } },
  ]) assert.equal((await f.request('/api/modules/registration/cases', 'POST', c)).status, 400);
});

test('missing PDF dependencies return a useful error and preserve Excel export', async t => {
  const f = await fixture(t); await addModule(f);
  await f.request('/api/modules/facility-setup/cases', 'POST', manualCase());
  const r = (await f.request('/api/runs', 'POST', { name: 'Missing renderer check', moduleId: 'facility-setup', environmentId: 'local', mode: 'manual', caseIds: ['FAC-001'] })).value;
  await f.request(`/api/runs/${r.id}/results`, 'POST', { id: 'FAC-001', status: 'PASS', actual: 'Facility appeared.' });
  await f.request(`/api/runs/${r.id}/complete`, 'POST', {});
  const original = process.env.PORTAL_PYTHON;
  process.env.PORTAL_PYTHON = path.join(f.directory, 'missing-python.exe');
  try {
    const pdf = await f.request(`/api/runs/${r.id}/export?format=pdf`);
    assert.equal(pdf.status, 503); assert.match(pdf.value.error, /requirements-report.txt/);
    assert.equal((await f.request(`/api/runs/${r.id}/export?format=xlsx`)).status, 200);
  } finally { if (original === undefined) delete process.env.PORTAL_PYTHON; else process.env.PORTAL_PYTHON = original; }
});

test('multi-module lifecycle supports adapter connection, bulk operations, dependency-safe deletion, template cleanup and upsert imports', async t => {
  const f = await fixture(t);
  const m = await addModule(f);
  await f.request('/api/modules/facility-setup/cases', 'POST', manualCase('FAC-001'));
  await f.request('/api/modules/facility-setup/cases', 'POST', manualCase('FAC-002'));
  const bulkDisable = await f.request('/api/modules/facility-setup/cases/bulk', 'POST', { action: 'disable', caseIds: ['FAC-001', 'FAC-002'] });
  assert.equal(bulkDisable.status, 200);
  assert.equal(f.store.case('facility-setup', 'FAC-001').enabled, false);
  const upsert = await f.request('/api/modules/facility-setup/import', 'POST', { format: 'json', upsert: true, data: { cases: [{ ...manualCase('FAC-001'), title: 'Upserted facility case' }] } });
  assert.equal(upsert.status, 201);
  assert.equal(f.store.case('facility-setup', 'FAC-001').title, 'Upserted facility case');
  assert.equal((await f.request('/api/modules/facility-setup/cases/FAC-002', 'DELETE')).status, 200);
  assert.equal(f.store.case('facility-setup', 'FAC-002'), undefined);
  // Dependency-safe deletion blocks removing REG-001 while dependent cases exist
  assert.equal((await f.request('/api/modules/registration/cases/REG-001', 'DELETE')).status, 409);
  // Template in use cannot be deleted, but unused template can be created and deleted
  assert.equal((await f.request('/api/modules/registration/templates/valid', 'DELETE')).status, 409);
  const regMod = f.store.module('registration');
  assert.equal((await f.request('/api/modules/registration/templates', 'PUT', { name: 'temp_base', input: { first_name: 'Temp' }, version: regMod.version })).status, 200);
  assert.equal((await f.request('/api/modules/registration/templates/temp_base', 'DELETE')).status, 200);
  // Connect an automation adapter to a module via PUT
  const connected = await f.request(`/api/modules/${m.id}`, 'PUT', { name: m.name, area: m.area, description: m.description, adapter: 'registration', version: m.version });
  assert.equal(connected.status, 200);
  assert.equal(connected.value.adapter, 'registration');
});

test('AI edge-case generator synthesizes validated automated and manual drafts ready for review and acceptance', async t => {
  const f = await fixture(t);
  await addModule(f);
  const regAi = await f.request('/api/modules/registration/ai-generate', 'POST', {
    prompt: 'Find out of the box UI cascade bugs, mobile validation, and XSS crash edge cases',
    count: 5,
    focus: 'all',
    priority: 'P1',
    mode: 'automated',
  });
  assert.equal(regAi.status, 200);
  assert.equal(regAi.value.drafts.length, 5);
  assert.ok(regAi.value.drafts.every(d => d.mode === 'automated' && d.priority === 'P1' && d.aiRationale));
  const accepted = await f.request('/api/modules/registration/import', 'POST', {
    format: 'json',
    upsert: true,
    data: regAi.value.drafts,
  });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.value.imported, 5);

  // A module with no sources, insights or automation package is gated (see module-pipeline.test.mjs for the success path).
  const manualAi = await f.request('/api/modules/facility-setup/ai-generate', 'POST', {
    prompt: 'Double click save button and test special characters',
    count: 3,
    focus: 'ui',
    mode: 'manual',
  });
  assert.equal(manualAi.status, 409);
  assert.ok(manualAi.value.readiness && manualAi.value.readiness.canGenerateAi === false);
});
