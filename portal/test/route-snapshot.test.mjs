import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { boot, signedIn, makeUser } from './support.mjs';

// Golden snapshot of status + sorted top-level keys per route, so the router refactor cannot change behavior unnoticed.
// Regenerate deliberately with UPDATE_GOLDEN=1.
const GOLDEN = fileURLToPath(new URL('./route-snapshot.golden.json', import.meta.url));
const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const manualCase = id => ({ id, title: 'Snapshot case', mode: 'manual', category: 'General', priority: 'P1', input: {}, steps: [{ action: 'Do it.', expected: 'It works.' }] });
const shape = value => Array.isArray(value) ? ['[array]', `len:${value.length}`, ...Object.keys(value[0] && typeof value[0] === 'object' ? value[0] : {}).sort()] : value && typeof value === 'object' && !Buffer.isBuffer(value) ? Object.keys(value).sort() : [];

test('route snapshot matches the golden file', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const anon = f.client();
  const results = {};
  const hit = async (client, who, method, route, body) => {
    const r = await client.request(route, method, body);
    // Generated ids vary per run, so they are replaced by a placeholder; repeated keys get a counter.
    const stable = route.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ':id');
    let key = `${who} ${method} ${stable}`;
    for (let n = 2; results[key]; n++) key = `${who} ${method} ${stable} #${n}`;
    results[key] = { key: `${method} ${stable}`, who, status: r.status, topLevelKeys: shape(r.value) };
    return r;
  };
  const A = (m, p, b) => hit(admin, 'admin', m, p, b);

  // session / login / logout
  await hit(anon, 'anon', 'GET', '/api/session');
  await hit(anon, 'anon', 'GET', '/api/bootstrap');
  await hit(anon, 'anon', 'POST', '/api/login', { username: ADMIN.username, password: 'wrong-password' });
  await hit(f.client(), 'anon', 'GET', '/api/health');
  await A('GET', '/api/session');
  await A('GET', '/api/health');
  // users, access, directory, audit
  await A('GET', '/api/users');
  const ann = await makeUser(admin, 'ann', 'member'), ben = await makeUser(admin, 'ben', 'member');
  await A('PATCH', `/api/users/${ann.id}`, { displayName: 'Ann' });
  await A('GET', '/api/access/roles');
  await A('GET', '/api/me/access');
  await A('GET', '/api/directory');
  await A('GET', '/api/audit');
  // teams
  const team = await A('POST', '/api/teams', { name: 'Snapshot team', description: 'd' });
  await A('GET', '/api/teams');
  await A('POST', `/api/teams/${team.value.id}/members`, { userId: ben.id });
  await A('PATCH', `/api/teams/${team.value.id}`, { description: 'changed' });
  await A('DELETE', `/api/teams/${team.value.id}/members/${ben.id}`);
  await A('DELETE', `/api/teams/${team.value.id}`);
  // products, bootstrap, modules CRUD
  await A('GET', '/api/products');
  await A('POST', '/api/products', { name: 'Zeta' });
  await A('GET', '/api/bootstrap');
  await A('POST', '/api/modules', { name: 'Alpha', prefix: 'AL', area: 'A' });
  await A('POST', '/api/modules', { name: 'Gamma', prefix: 'GA', area: 'G', productId: 'zeta' });
  await A('GET', '/api/modules/alpha/members');
  await A('POST', '/api/modules/alpha/members', { subjectType: 'user', subjectId: ann.id, role: 'viewer' });
  await A('GET', '/api/modules/alpha/readiness');
  await A('GET', '/api/modules/alpha/setup');
  await A('GET', '/api/modules/nope/readiness');
  // agent, intake, insights
  await A('GET', '/api/agent/status');
  await A('GET', '/api/modules/alpha/agent/jobs');
  await A('GET', '/api/modules/alpha/intake');
  await A('GET', '/api/modules/alpha/insights'); // 404 before any insights exist
  await A('PUT', '/api/modules/alpha/insights', { summary: 'Snapshot insights', cases: [] });
  await A('GET', '/api/modules/alpha/insights');
  await A('GET', '/api/modules/alpha/insights/history');
  // cases, coverage, templates, export
  await A('GET', '/api/modules/alpha/cases');
  await A('POST', '/api/modules/alpha/cases', manualCase('AL-001'));
  const created = await A('GET', '/api/modules/alpha/cases');
  await A('PUT', '/api/modules/alpha/cases/AL-001', { ...manualCase('AL-001'), title: 'Changed', version: created.value.find(c => c.id === 'AL-001')?.version });
  await A('GET', '/api/modules/alpha/coverage');
  // templates need a module with an adapter (the seeded registration module)
  const reg = await A('GET', '/api/modules/registration/cases');
  const regVersion = () => f.store.module('registration').version;
  await A('PUT', '/api/modules/registration/templates', { name: 'snap_base', input: { first_name: 'A' }, version: regVersion() });
  await A('DELETE', '/api/modules/registration/templates/snap_base');
  // review, bulk, import, requirements
  await A('POST', '/api/modules/alpha/cases', manualCase('AL-002'));
  await A('POST', '/api/modules/alpha/cases/review', { ids: ['AL-002'], decision: 'approved' });
  await A('POST', '/api/modules/alpha/cases/bulk', { caseIds: ['AL-002'], action: 'priority', value: 'P3' });
  await A('POST', '/api/modules/alpha/import', { upsert: true, data: [manualCase('AL-003')] });
  await A('PUT', '/api/modules/alpha/requirements', { version: f.store.module('alpha').version, requirements: [{ id: 'AL-REQ-1', title: 'Snapshot requirement' }] });
  await A('GET', '/api/modules/alpha/export');
  await A('DELETE', '/api/modules/alpha/cases/AL-001');
  // runs
  await A('GET', '/api/runs');
  await A('POST', '/api/runs', {});
  const run = await A('POST', '/api/runs', { moduleId: 'alpha', environmentId: 'local', mode: 'manual', caseIds: ['AL-002'], name: 'snapshot run' });
  await A('GET', `/api/runs/${run.value.id}`);
  await A('GET', '/api/runs/does-not-exist');
  await A('GET', '/api/api-does-not-exist');
  // authorization: viewer sees alpha but cannot manage it (403); gamma is hidden from ann (404)
  // password change and logout use their own client so the admin session stays valid
  const ben2 = await signedIn(f, 'ben', ben.password);
  await hit(ben2, 'ben', 'POST', '/api/me/password', { current: ben.password, next: 'brand-new-secret-pass' });
  const ben3 = f.client();
  await hit(ben3, 'ben', 'POST', '/api/login', { username: 'ben', password: 'brand-new-secret-pass' });
  await hit(ben3, 'ben', 'POST', '/api/logout');
  const annClient = await signedIn(f, 'ann', ann.password);
  await hit(annClient, 'ann', 'GET', '/api/modules/alpha/cases');
  await hit(annClient, 'ann', 'POST', '/api/modules/alpha/members', { subjectType: 'user', subjectId: ben.id, role: 'viewer' });
  await hit(annClient, 'ann', 'GET', '/api/modules/gamma/cases');
  await hit(annClient, 'ann', 'GET', '/api/users');

  assert.equal(results['ann GET /api/modules/gamma/cases'].status, 404, 'hidden module must give 404');
  assert.equal(results['ann POST /api/modules/alpha/members'].status, 403, 'visible admin-only route must give 403');
  const snapshot = Object.fromEntries(Object.keys(results).sort().map(k => [k, results[k]]));
  if (process.env.UPDATE_GOLDEN === '1') { fs.writeFileSync(GOLDEN, JSON.stringify(snapshot, null, 2) + '\n'); return; }
  assert.deepEqual(snapshot, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
});
