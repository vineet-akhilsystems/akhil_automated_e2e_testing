import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { boot, signedIn, makeUser } from './support.mjs';
import { openStore } from '../store.mjs';

// Regression tests for round 3 of the access-control security review.
const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const manual = (id, extra = {}) => ({ id, title: `Case ${id}`, mode: 'manual', category: 'Gate', priority: 'P1', steps: [{ action: 'Do it', expected: 'It works' }], ...extra });
const auto = (id, extra = {}) => ({ id, title: `Auto ${id}`, mode: 'automated', category: 'T', priority: 'P1', action: 'fill', input: { first_name: 'Alpha', last_name: 'Beta' }, expected: { outcome: 'field-state', values: { first_name: 'Alpha' } }, steps: [], ...extra });
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.value)); return r.value; };
const soon = ms => new Date(Date.now() + ms).toISOString();

async function world(t, extra = {}) {
  const f = await boot(t, { bootstrap: ADMIN, ...extra });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const ids = {}, pw = {};
  for (const name of ['ann', 'ben', 'cat', 'dan', 'eve']) { const u = await makeUser(admin, name, 'member'); ids[name] = u.id; pw[name] = u.password; }
  ok(await admin.request('/api/products', 'POST', { name: 'Zeta' }), 201);
  ok(await admin.request('/api/modules', 'POST', { name: 'Alpha', prefix: 'AL', area: 'A' }), 201);
  ok(await admin.request('/api/modules', 'POST', { name: 'Beta', prefix: 'BE', area: 'B' }), 201);
  const grant = (scope, id, user, role, body = {}) => admin.request(`/api/${scope}s/${id}/members`, 'POST', { subjectType: 'user', subjectId: ids[user], role, ...body });
  const grantTeam = (scope, id, teamId, role, body = {}) => admin.request(`/api/${scope}s/${id}/members`, 'POST', { subjectType: 'team', subjectId: teamId, role, ...body });
  const login = name => signedIn(f, name, pw[name]);
  return { f, admin, ids, pw, grant, grantTeam, login };
}

test('R3-1: a template edit makes the editor the content author of every case on it, drafts included, with four-eyes on or off', async t => {
  const { f, admin, grant, login } = await world(t, { strict: true });
  for (const u of ['ben', 'cat']) ok(await grant('module', 'registration', u, 'tester'), 201);
  const ben = await login('ben'), cat = await login('cat');
  const M = '/api/modules/registration';
  const put = (c, name, input) => c.request(`${M}/templates`, 'PUT', { name, input, version: f.store.module('registration').version });
  ok(await put(admin, 'tpl', { first_name: 'Alpha' }));
  ok(await cat.request(`${M}/cases`, 'POST', auto('ZZ-030', { base: 'tpl' })), 201);        // stays a draft under four-eyes
  assert.equal(f.store.case('registration', 'ZZ-030').reviewStatus, 'draft');
  ok(await put(ben, 'tpl', { first_name: 'Hacked', gender: 'Male' }));
  assert.equal(f.store.case('registration', 'ZZ-030').contentBy.user, 'ben');
  assert.equal((await ben.request(`${M}/cases/review`, 'POST', { ids: ['ZZ-030'], decision: 'approved' })).status, 403);
  assert.equal((await cat.request(`${M}/cases/review`, 'POST', { ids: ['ZZ-030'], decision: 'approved' })).status, 403);   // cat created it
  // with four-eyes switched off at edit time the case stays approved, but the author is still recorded
  ok(await admin.request(M, 'PUT', { settings: { requireSecondApprover: false }, version: f.store.module('registration').version }));
  ok(await cat.request(`${M}/cases`, 'POST', auto('ZZ-031', { base: 'tpl' })), 201);
  assert.equal(f.store.case('registration', 'ZZ-031').reviewStatus, 'approved');
  ok(await put(ben, 'tpl', { first_name: 'Evil' }));
  const z = f.store.case('registration', 'ZZ-031');
  assert.deepEqual([z.reviewStatus, z.contentBy.user], ['approved', 'ben']);
  ok(await admin.request(M, 'PUT', { settings: { requireSecondApprover: true }, version: f.store.module('registration').version }));
  assert.equal((await ben.request(`${M}/cases/review`, 'POST', { ids: ['ZZ-031'], decision: 'rejected' })).status, 403);
});

test('R3-2: a membership that was edited by hand is no longer owned by the legacy role mapping', async t => {
  const { f, admin, ids, grant } = await world(t);
  const leg = await makeUser(admin, 'leg', 'tester');
  const m = f.store.memberships().find(x => x.subjectId === leg.id);
  assert.equal(m.legacy, true);
  ok(await admin.request(`/api/memberships/${m.id}`, 'PATCH', { overrides: { 'case.review': false } }));
  assert.equal(f.store.membership(m.id).legacy, undefined);
  ok(await admin.request(`/api/users/${leg.id}`, 'PATCH', { role: 'viewer' }));
  assert.deepEqual([f.store.membership(m.id).role, f.store.membership(m.id).overrides], ['tester', { 'case.review': false }]);
  ok(await admin.request(`/api/users/${leg.id}`, 'PATCH', { role: 'member' }));
  assert.ok(f.store.membership(m.id));
  assert.ok(f.store.auditLog({ scopeType: 'product', scopeId: 'augastam' }).some(e => e.action === 'membership.kept'));
  assert.ok(ids.ann && grant);
});

test('R3-3: a lead whose own access expires cannot leave the module with no permanent lead; admins can, and it is audited', async t => {
  const { f, admin, ids, grant, login } = await world(t);
  const root = ok(await admin.request('/api/modules/alpha/members'))[0];
  ok(await grant('module', 'alpha', 'ann', 'lead', { expiresAt: soon(3600000) }), 201);
  const ann = await login('ann');
  assert.equal((await ann.request(`/api/memberships/${root.id}`, 'DELETE')).status, 403);
  assert.equal(f.store.membership(root.id).role, 'lead');
  ok(await admin.request(`/api/memberships/${root.id}`, 'DELETE'));
  const entry = ok(await admin.request('/api/audit?scopeType=module&scopeId=alpha')).find(e => e.action === 'module.noLead');
  assert.match(entry.detail.reason, /no lead after/); assert.ok(Date.parse(entry.detail.leaderlessAfter) > Date.now());
  assert.ok(ids.ann);
});

test('R3-4: whoever adds people to a team must be able to manage every scope it is attached to', async t => {
  const { admin, ids, grant, grantTeam, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201);      // lets her create teams at all
  ok(await grant('module', 'beta', 'ann', 'tester'), 201);
  const ann = await login('ann');
  const team = ok(await ann.request('/api/teams', 'POST', { name: 'Beta crew' }), 201);
  ok(await grantTeam('module', 'beta', team.id, 'viewer'), 201);
  assert.equal((await ann.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.dan })).status, 403);   // she could not undo it either
  assert.equal((await ann.request(`/api/teams/${team.id}/members/${ids.dan}`, 'DELETE')).status, 403);
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.dan }), 201);
});

async function bulk(w, { leads, productViewers }) {
  const s = w.f.store, users = [], teams = [];
  for (let i = 0; i < 300; i++) { const id = randomUUID(); s.saveUser({ id, username: `u${i}`, role: 'member', displayName: `u${i}`, passwordHash: 'x', createdAt: '' }); users.push(id); }
  for (let i = 0; i < 50; i++) { const id = randomUUID(); s.saveTeam({ id, name: `team${i}`, createdBy: 'root', createdById: 'x' }); for (let j = 0; j < 5; j++) s.addTeamMember(id, users[(i * 5 + j) % 300]); teams.push(id); }
  s.transaction(() => {
    for (let i = 0; i < 300; i++) {
      const mid = `m${i}`; s.saveModule({ id: mid, productId: 'augastam', name: mid, prefix: 'MM', area: 'A', config: { bases: {}, requirements: [] } });
      for (let j = 0; j < 9; j++) s.saveMembership({ id: randomUUID(), subjectType: j < 7 ? 'user' : 'team', subjectId: j < 7 ? users[(i + j) % 300] : teams[(i + j) % 50], scopeType: 'module', scopeId: mid, role: leads && j === 0 ? 'lead' : 'tester', overrides: {} });
    }
    for (let i = 0; i < productViewers; i++) s.saveMembership({ id: randomUUID(), subjectType: 'user', subjectId: users[i], scopeType: 'product', scopeId: 'augastam', role: 'viewer', overrides: {} });
  });
  return { users, teams };
}
const timed = async fn => { const t0 = performance.now(); const r = await fn(); return [r, Math.round(performance.now() - t0)]; };

test('R3-5: access changes stay fast when a product has hundreds of product-level members', async t => {
  const w = await world(t), { f, admin, ids, grant, login } = w;
  const { users } = await bulk(w, { leads: false, productViewers: 299 });
  ok(await grant('product', 'augastam', 'ann', 'lead'), 201);
  const ann = await login('ann');
  const T = ok(await admin.request('/api/teams', 'POST', { name: 'perfT' }), 201);
  ok(await admin.request(`/api/teams/${T.id}/members`, 'POST', { userId: ids.dan }), 201);
  ok(await admin.request('/api/products/augastam/members', 'POST', { subjectType: 'team', subjectId: T.id, role: 'tester' }), 201);
  assert.ok(f.store.memberships().length > 3000);
  const runs = [
    ['team member removal', () => admin.request(`/api/teams/${T.id}/members/${ids.dan}`, 'DELETE')],
    ['disable a product-level user', () => admin.request(`/api/users/${users[0]}`, 'PATCH', { disabled: true })],
    ['role change', () => admin.request(`/api/users/${users[1]}`, 'PATCH', { role: 'viewer' })],
    ['product lead adds a viewer', () => ann.request('/api/products/augastam/members', 'POST', { subjectType: 'user', subjectId: ids.eve, role: 'viewer' })],
  ];
  for (const [label, fn] of runs) { const [r, ms] = await timed(fn); assert.ok(r.status < 300, `${label}: ${r.status}`); assert.ok(ms < 1500, `${label} took ${ms} ms`); }
});

test('R3-6: the expiry cap does not scan every membership in the system', async t => {
  const { f, ids, grant, login } = await world(t);
  const s = f.store, base = Date.now();
  ok(await grant('module', 'alpha', 'ann', 'lead', { expiresAt: soon(3600000) }), 201);
  s.transaction(() => { for (let i = 0; i < 12000; i++) s.saveMembership({ id: randomUUID(), subjectType: 'user', subjectId: randomUUID(), scopeType: 'module', scopeId: `m${i % 300}`, role: 'viewer', overrides: {}, expiresAt: new Date(base + 7200000 + i * 1000).toISOString() }); });
  const ann = await login('ann');
  const [refused, ms] = await timed(() => ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'user', subjectId: ids.dan, role: 'viewer' }));
  assert.equal(refused.status, 403); assert.ok(ms < 2500, `grant took ${ms} ms`);
  const [allowed, ms2] = await timed(() => ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'user', subjectId: ids.dan, role: 'viewer', expiresAt: soon(1800000) }));
  assert.equal(allowed.status, 201); assert.ok(ms2 < 2500, `grant took ${ms2} ms`);
});

test('R3-7: a JSON body that is not an object is a 400 on every route that reads one, never a 500', async t => {
  const { f, admin, ids, grant, login } = await world(t);
  ok(await admin.request('/api/modules/alpha/cases', 'POST', manual('AL-001')), 201);
  const run = ok(await admin.request('/api/runs', 'POST', { moduleId: 'alpha', environmentId: 'local', mode: 'manual', caseIds: ['AL-001'], name: 'r' }), 201);
  const team = ok(await admin.request('/api/teams', 'POST', { name: 'T' }), 201);
  const m = ok(await grant('module', 'alpha', 'ann', 'viewer'), 201);
  const routes = [['PATCH', `/api/memberships/${m.id}`], ['POST', '/api/modules/alpha/members'], ['POST', '/api/products/augastam/members'], ['POST', '/api/teams'], ['PATCH', `/api/teams/${team.id}`],
    ['POST', `/api/teams/${team.id}/members`], ['POST', '/api/modules/alpha/cases/review'], ['POST', '/api/modules/alpha/cases/bulk'], ['POST', '/api/modules/alpha/cases'], ['PUT', '/api/modules/alpha/cases/AL-001'],
    ['POST', '/api/modules/alpha/import'], ['PUT', '/api/modules/alpha'], ['PUT', '/api/modules/alpha/requirements'], ['PUT', '/api/modules/registration/templates'], ['POST', '/api/users'], ['PATCH', `/api/users/${ids.dan}`],
    ['POST', '/api/me/password'], ['POST', '/api/modules'], ['POST', '/api/runs'], ['POST', '/api/products'], ['POST', '/api/environments'], ['PUT', '/api/modules/alpha/insights'], ['POST', '/api/modules/alpha/agent/jobs'],
    ['POST', '/api/modules/alpha/intake/analyze'], ['PUT', `/api/runs/${run.id}/report`], ['PUT', `/api/runs/${run.id}/triage/AL-001`], ['POST', `/api/runs/${run.id}/results`], ['POST', `/api/runs/${run.id}/evidence`]];
  for (const [method, route] of routes) for (const body of [null, [], 5, 'x']) {
    const r = await admin.request(route, method, body);
    assert.equal(r.status, 400, `${method} ${route} with ${JSON.stringify(body)} -> ${r.status} ${JSON.stringify(r.value)}`);
  }
  const anon = f.client();
  for (const body of [null, [], 5, 'x']) assert.equal((await anon.request('/api/login', 'POST', body)).status, 400);
  assert.equal((await login('ann')).request !== undefined, true);
});

test('R3-8a: cases saved before contentBy existed get it backfilled once at migration', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-portal-test-backfill-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let store = openStore(dir);
  store.saveCase('registration', manual('OLD-1', { createdBy: { user: 'cat', at: 'x' }, updatedBy: { user: 'ben', at: 'y' } }));
  store.saveCase('registration', manual('OLD-2', { createdBy: { user: 'cat', at: 'x' } }));
  store.saveCase('registration', manual('OLD-3'));
  store.db.exec(`DELETE FROM meta WHERE key='contentby-backfill-1'`);
  store.close();
  store = openStore(dir);
  assert.equal(store.case('registration', 'OLD-1').contentBy.user, 'ben');
  assert.equal(store.case('registration', 'OLD-2').contentBy.user, 'cat');
  assert.equal(store.case('registration', 'OLD-3').contentBy, undefined);
  assert.equal(store.case('registration', 'OLD-1').version, 1);                       // no version bump
  store.saveCase('registration', { ...store.case('registration', 'OLD-2'), contentBy: undefined }, 1);
  store.close();
  store = openStore(dir);
  assert.equal(store.case('registration', 'OLD-2').contentBy, undefined);             // guarded by the marker: not redone
  store.close();
});

test('R3-8b: a membership edit that changes nothing is refused and writes no audit row', async t => {
  const { f, admin, grant } = await world(t);
  const m = ok(await grant('module', 'alpha', 'ann', 'tester', { overrides: { 'run.start': false } }), 201);
  const rows = () => f.store.auditLog({}).length;
  const before = rows();
  for (const body of [{}, { role: 'tester' }, { role: 'tester', overrides: { 'run.start': false } }, { overrides: { 'run.start': false } }]) {
    const r = await admin.request(`/api/memberships/${m.id}`, 'PATCH', body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(rows(), before);
  ok(await admin.request(`/api/memberships/${m.id}`, 'PATCH', { role: 'viewer' }));
  assert.equal(rows(), before + 1);
  // the same holds for team edits that change nothing
  const team = ok(await admin.request('/api/teams', 'POST', { name: 'Same' }), 201);
  const afterCreate = rows();
  for (let i = 0; i < 5; i++) ok(await admin.request(`/api/teams/${team.id}`, 'PATCH', { name: 'Same', description: '' }));
  assert.equal(rows(), afterCreate);
});
