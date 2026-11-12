import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { boot, signedIn, makeUser, until } from './support.mjs';

// Regression tests for the access-control security review (findings 1-9).
const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const manual = (id, extra = {}) => ({ id, title: `Case ${id}`, mode: 'manual', category: 'Gate', priority: 'P1', steps: [{ action: 'Do it', expected: 'It works' }], ...extra });
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.value)); return r.value; };
const soon = ms => new Date(Date.now() + ms).toISOString();

async function world(t, extra = {}) {
  const f = await boot(t, { bootstrap: ADMIN, ...extra });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const ids = {}, pw = {};
  for (const name of ['ann', 'ben', 'cat', 'dan']) { const u = await makeUser(admin, name, 'member'); ids[name] = u.id; pw[name] = u.password; }
  ok(await admin.request('/api/products', 'POST', { name: 'Zeta' }), 201);
  ok(await admin.request('/api/modules', 'POST', { name: 'Alpha', prefix: 'AL', area: 'A' }), 201);
  ok(await admin.request('/api/modules', 'POST', { name: 'Beta', prefix: 'BE', area: 'B' }), 201);
  ok(await admin.request('/api/modules', 'POST', { name: 'Gamma', prefix: 'GA', area: 'G', productId: 'zeta' }), 201);
  const grant = (scope, id, user, role, extraBody = {}) => admin.request(`/api/${scope}s/${id}/members`, 'POST', { subjectType: 'user', subjectId: ids[user], role, ...extraBody });
  const login = name => signedIn(f, name, pw[name]);
  return { f, admin, ids, pw, grant, login };
}

test('finding 1: a team creator cannot escalate by adding people (or themselves) to a team attached elsewhere', async t => {
  const { admin, ids, grant, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201);
  const ann = await login('ann');
  const team = ok(await ann.request('/api/teams', 'POST', { name: 'Ann helpers' }), 201);
  ok(await admin.request('/api/products/zeta/members', 'POST', { subjectType: 'team', subjectId: team.id, role: 'owner' }), 201);
  assert.equal((await ann.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.ann })).status, 403);
  assert.equal((await ann.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.dan })).status, 403);
  assert.deepEqual(ok(await ann.request('/api/me/access')).products.zeta, undefined);
  assert.equal((await ann.request('/api/modules', 'POST', { name: 'Ann Zeta', prefix: 'AZ', area: 'A', productId: 'zeta' })).status, 404);
  // the administrator can still staff it
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.dan }), 201);
  // a team attached only to something she covers is fine
  const own = ok(await ann.request('/api/teams', 'POST', { name: 'Alpha viewers' }), 201);
  ok(await ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'team', subjectId: own.id, role: 'viewer' }), 201);
  ok(await ann.request(`/api/teams/${own.id}/members`, 'POST', { userId: ids.ben }), 201);
});

test('finding 1/5: deleting a team or removing a member needs control of every scope it is attached to', async t => {
  const { admin, ids, grant, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201);
  const ann = await login('ann'), dan = await login('dan');
  const team = ok(await ann.request('/api/teams', 'POST', { name: 'Shared' }), 201);
  ok(await ann.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.dan }), 201);               // nothing attached yet
  ok(await admin.request('/api/modules/zeta-gamma/members', 'POST', { subjectType: 'team', subjectId: team.id, role: 'tester' }), 201);
  assert.equal((await dan.request('/api/modules/zeta-gamma/cases')).status, 200);
  assert.equal((await ann.request(`/api/teams/${team.id}`, 'DELETE')).status, 403);
  assert.equal((await ann.request(`/api/teams/${team.id}/members/${ids.dan}`, 'DELETE')).status, 403);
  assert.equal((await dan.request('/api/modules/zeta-gamma/cases')).status, 200);                          // access untouched
  ok(await admin.request(`/api/teams/${team.id}/members/${ids.dan}`, 'DELETE'));
  assert.equal((await dan.request('/api/modules/zeta-gamma/cases')).status, 404);
});

test('finding 2: a team containing the actor counts as self; grants cannot outlive the granter', async t => {
  const { admin, ids, grant, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'lead', { expiresAt: soon(3600000) }), 201);
  const ann = await login('ann');
  const team = ok(await ann.request('/api/teams', 'POST', { name: 'Me forever' }), 201);
  assert.equal((await ann.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.ann })).status, 403);   // nobody adds themselves
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.ann }), 201);
  assert.equal((await ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'team', subjectId: team.id, role: 'lead' })).status, 403);
  // a team that already has a grant cannot be joined by a granter whose own access ends sooner
  const other = ok(await ann.request('/api/teams', 'POST', { name: 'Forever helpers' }), 201);
  const forever = ok(await ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'team', subjectId: other.id, role: 'viewer', expiresAt: soon(1800000) }), 201);
  assert.ok(forever.expiresAt);
  // expiry cap on plain grants and on edits
  assert.equal((await ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'user', subjectId: ids.ben, role: 'viewer' })).status, 403);
  assert.equal((await ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'user', subjectId: ids.ben, role: 'viewer', expiresAt: soon(7200000) })).status, 403);
  const ben = ok(await ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'user', subjectId: ids.ben, role: 'viewer', expiresAt: soon(1800000) }), 201);
  assert.equal((await ann.request(`/api/memberships/${ben.id}`, 'PATCH', { expiresAt: null })).status, 403);
  assert.equal((await ann.request(`/api/memberships/${ben.id}`, 'PATCH', { expiresAt: soon(9000000) })).status, 403);
  assert.equal((await ann.request(`/api/memberships/${forever.id}`, 'PATCH', { role: 'ba' })).status, 200);
  // a team membership she belongs to cannot be edited or removed by her either
  ok(await admin.request(`/api/teams/${other.id}/members`, 'POST', { userId: ids.ann }), 201);
  assert.equal((await ann.request(`/api/memberships/${forever.id}`, 'PATCH', { role: 'ba' })).status, 403);
  assert.equal((await ann.request(`/api/memberships/${forever.id}`, 'DELETE')).status, 403);
});

test('finding 3: changing an approved case sends it back to review, whoever edits it', async t => {
  const { f, grant, login } = await world(t, { strict: true });
  ok(await grant('module', 'alpha', 'ben', 'tester'), 201); ok(await grant('module', 'alpha', 'cat', 'tester'), 201);
  const ben = await login('ben'), cat = await login('cat');
  ok(await ben.request('/api/modules/alpha/cases', 'POST', manual('AL-001')), 201);
  ok(await cat.request('/api/modules/alpha/cases/review', 'POST', { ids: ['AL-001'], decision: 'approved' }));
  const run = () => ben.request('/api/runs', 'POST', { moduleId: 'alpha', environmentId: 'local', mode: 'manual', caseIds: ['AL-001'], name: 'r' });
  assert.equal((await run()).status, 201);
  // metadata only: approval stays
  const cur = f.store.case('alpha', 'AL-001');
  assert.equal(ok(await ben.request('/api/modules/alpha/cases/AL-001', 'PUT', { ...manual('AL-001', { priority: 'P0', category: 'Other' }), version: cur.version })).reviewStatus, 'approved');
  // content: back to draft, approval cleared, cannot run
  const cur2 = f.store.case('alpha', 'AL-001');
  const edited = ok(await ben.request('/api/modules/alpha/cases/AL-001', 'PUT', { ...manual('AL-001', { title: 'Totally different', steps: [{ action: 'Skip everything', expected: 'Anything' }] }), version: cur2.version }));
  assert.equal(edited.reviewStatus, 'draft'); assert.equal(edited.reviewedBy, undefined);
  assert.equal((await run()).status, 409);
  // another reviewer's edit resets it too; import upsert as well
  ok(await cat.request('/api/modules/alpha/cases/review', 'POST', { ids: ['AL-001'], decision: 'approved' }));
  assert.equal(f.store.case('alpha', 'AL-001').reviewStatus, 'approved');
  const cur3 = f.store.case('alpha', 'AL-001');
  ok(await ben.request('/api/modules/alpha/import', 'POST', { upsert: true, data: [manual('AL-001', { title: 'Via import', version: cur3.version })] }), 201);
  const after = f.store.case('alpha', 'AL-001');
  assert.deepEqual([after.title, after.reviewStatus, after.reviewedBy], ['Via import', 'draft', undefined]);
  // bulk edits cannot change content (only enabled, priority, category), so approval is untouched by them
  ok(await cat.request('/api/modules/alpha/cases/review', 'POST', { ids: ['AL-001'], decision: 'approved' }));
  ok(await ben.request('/api/modules/alpha/cases/bulk', 'POST', { caseIds: ['AL-001'], action: 'priority', value: 'P3' }));
  assert.equal(f.store.case('alpha', 'AL-001').reviewStatus, 'approved');
});

test('finding 4: changing a data template sends cases built on it back to review', async t => {
  const { f, admin, grant, login } = await world(t, { strict: true });
  ok(await grant('module', 'registration', 'ben', 'tester'), 201);
  const ben = await login('ben');
  f.store.saveCase('registration', { id: 'TB-1', title: 'Uses template', mode: 'automated', category: 'T', priority: 'P1', base: 'temp_base', steps: [], reviewStatus: 'approved', reviewedBy: { user: 'someone', decision: 'approved' } });
  f.store.saveCase('registration', { id: 'TB-2', title: 'Other', mode: 'automated', category: 'T', priority: 'P1', base: 'valid', steps: [], reviewStatus: 'approved' });
  const put = input => admin.request('/api/modules/registration/templates', 'PUT', { name: 'temp_base', input, version: f.store.module('registration').version });
  ok(await put({ first_name: 'A' }));                      // creating the template changes nothing for it yet... but it did not exist before: counts as a change
  assert.equal(f.store.case('registration', 'TB-1').reviewStatus, 'draft');
  f.store.saveCase('registration', { ...f.store.case('registration', 'TB-1'), reviewStatus: 'approved' }, f.store.case('registration', 'TB-1').version);
  const same = ok(await put({ first_name: 'A' }));
  assert.deepEqual(same.resetCases, []); assert.equal(f.store.case('registration', 'TB-1').reviewStatus, 'approved');
  const changed = ok(await put({ first_name: 'B' }));
  assert.deepEqual(changed.resetCases, ['TB-1']);
  const tb1 = f.store.case('registration', 'TB-1');
  assert.deepEqual([tb1.reviewStatus, tb1.reviewedBy], ['draft', undefined]);
  assert.equal(f.store.case('registration', 'TB-2').reviewStatus, 'approved');
  assert.ok(f.store.auditLog({ scopeType: 'module', scopeId: 'registration' }).some(e => e.action === 'cases.reset' && e.detail.caseIds[0] === 'TB-1'));
  void ben;
});

test('finding 6: user and team changes are audited where the affected people can be seen', async t => {
  const { f, admin, ids, grant, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201);
  const ann = await login('ann');
  const team = ok(await admin.request('/api/teams', 'POST', { name: 'QA' }), 201);
  ok(await admin.request('/api/modules/alpha/members', 'POST', { subjectType: 'team', subjectId: team.id, role: 'viewer' }), 201);
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.dan }), 201);
  ok(await admin.request(`/api/teams/${team.id}/members/${ids.dan}`, 'DELETE'));
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.ben }), 201);
  let log = ok(await ann.request('/api/audit?scopeType=module&scopeId=alpha'));
  const via = log.filter(e => e.detail?.viaTeam?.id === team.id).map(e => [e.action, e.subject.name]);
  assert.deepEqual(via.reverse(), [['membership.add', 'dan'], ['membership.remove', 'dan'], ['membership.add', 'ben']]);
  ok(await admin.request(`/api/teams/${team.id}`, 'DELETE'));
  log = ok(await ann.request('/api/audit?scopeType=module&scopeId=alpha'));
  assert.equal(log[0].action, 'membership.remove'); assert.equal(log[0].detail.teamDeleted, true); assert.deepEqual(log[0].detail.members, ['ben']);
  // account changes
  ok(await admin.request(`/api/users/${ids.cat}`, 'PATCH', { disabled: true }));
  ok(await admin.request(`/api/users/${ids.cat}`, 'PATCH', { disabled: false }));
  ok(await admin.request(`/api/users/${ids.cat}`, 'PATCH', { password: 'a-brand-new-pass' }));
  const bm = ok(await admin.request('/api/modules/alpha/members', 'POST', { subjectType: 'user', subjectId: ids.cat, role: 'viewer' }), 201);
  const t2 = ok(await admin.request('/api/teams', 'POST', { name: 'Seat' }), 201);
  ok(await admin.request(`/api/teams/${t2.id}/members`, 'POST', { userId: ids.cat }), 201);
  ok(await admin.request(`/api/users/${ids.cat}`, 'DELETE'));
  const all = f.store.auditLog({}).map(a => a.action);
  for (const a of ['user.disable', 'user.enable', 'user.password.reset', 'user.delete']) assert.ok(all.includes(a), a);
  const del = f.store.auditLog({}).find(a => a.action === 'user.delete');
  assert.deepEqual([del.detail.membershipsRemoved, del.detail.teamSeatsRemoved], [1, 1]);
  assert.ok(!JSON.stringify(f.store.auditLog({})).includes('a-brand-new-pass'));
  log = ok(await ann.request('/api/audit?scopeType=module&scopeId=alpha'));
  assert.ok(log.some(e => e.action === 'membership.remove' && e.subject.name === 'cat' && e.detail.userDeleted));
  assert.ok(bm.id);
  // legacy role sync is audited in the Augastam product scope
  const leg = await makeUser(admin, 'leg', 'tester');
  ok(await admin.request(`/api/users/${leg.id}`, 'PATCH', { role: 'viewer' }));
  ok(await admin.request(`/api/users/${leg.id}`, 'PATCH', { role: 'member' }));
  const prod = ok(await admin.request('/api/audit?scopeType=product&scopeId=augastam')).filter(e => e.detail?.legacy).map(e => e.action).reverse();
  assert.deepEqual(prod, ['membership.add', 'membership.update', 'membership.remove']);
});

test('finding 6b: leaving a module without any lead is reported (noLead flag and audit entry)', async t => {
  const { f, admin, ids, grant } = await world(t);
  assert.equal(ok(await admin.request('/api/modules/alpha/members'))[0].noLead, false);
  const alpha = await admin.request('/api/modules/alpha/members');
  assert.equal(alpha.response.headers.get('x-no-lead'), 'false');
  // ann is the only lead of Alpha once the admin's own entry is gone; disabling her account leaves it leaderless
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201);
  const root = ok(await admin.request('/api/modules/alpha/members')).find(m => m.subject.name === 'Administrator');
  ok(await admin.request('/api/users', 'POST', { username: 'root2', password: 'second-admin-pass', role: 'admin' }), 201);
  const second = await signedIn(f, 'root2', 'second-admin-pass');
  ok(await second.request(`/api/memberships/${root.id}`, 'DELETE'));
  ok(await admin.request(`/api/users/${ids.ann}`, 'PATCH', { disabled: true }));
  const list = await admin.request('/api/modules/alpha/members');
  assert.equal(list.response.headers.get('x-no-lead'), 'true'); assert.ok(list.value.every(m => m.noLead === true));
  assert.ok(ok(await admin.request('/api/audit?scopeType=module&scopeId=alpha')).some(e => e.action === 'module.noLead' && e.detail.reason === 'account disabled'));
});
test('finding 7: legacy role changes update in place, keep overrides and expiry and never fail', async t => {
  const { f, admin, ids, grant, login } = await world(t);
  const leg = await makeUser(admin, 'leg', 'tester');
  ok(await grant('product', 'augastam', 'ben', 'owner'), 201);
  const ben = await login('ben');
  const lm = ok(await admin.request('/api/products/augastam/members')).find(m => m.subject.id === leg.id);
  const until1 = soon(86400000);
  ok(await ben.request(`/api/memberships/${lm.id}`, 'PATCH', { role: 'tester', overrides: { 'case.review': false }, expiresAt: until1 }));
  // the owner's edit made it a deliberate membership: the legacy mapping leaves it exactly as edited
  ok(await admin.request(`/api/users/${leg.id}`, 'PATCH', { role: 'ba' }));
  const after = f.store.memberships().filter(m => m.subjectId === leg.id);
  assert.equal(after.length, 1);
  assert.deepEqual([after[0].role, after[0].overrides, after[0].expiresAt], ['tester', { 'case.review': false }, until1]);
  // a user who already has a normal membership on Augastam: no UNIQUE failure, still one row
  ok(await grant('product', 'augastam', 'dan', 'viewer'), 201);
  ok(await admin.request(`/api/users/${ids.dan}`, 'PATCH', { role: 'tester' }));
  assert.equal(f.store.memberships().filter(m => m.subjectId === ids.dan).length, 1);
  // a deliberately created membership is never touched by the legacy mapping; the audit says it was kept
  assert.equal(f.store.memberships().find(m => m.subjectId === ids.dan).role, 'viewer');
  assert.ok(f.store.auditLog({ scopeType: 'product', scopeId: 'augastam' }).some(e => e.action === 'membership.kept' && e.subject.name === 'dan' && e.detail.note === 'kept existing membership'));
  ok(await admin.request('/api/users', 'POST', { username: 'zed', password: 'password-zed1', role: 'tester' }), 201);
  // moving a user off the legacy roles removes only the membership the legacy role created
  ok(await admin.request(`/api/users/${ids.dan}`, 'PATCH', { role: 'member' }));
  assert.equal(f.store.memberships().filter(m => m.subjectId === ids.dan).length, 1);
});

test('finding 8: hidden and missing things are indistinguishable; ids are not predictable; env and agent scoping', async t => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-portal-test-env-'));
  t.after(() => fs.rmSync(authDir, { recursive: true, force: true }));
  const envs = [{ id: 'local', name: 'Local', url: 'http://application.invalid', authDir }, { id: 'zeta-env', name: 'Zeta env', url: 'http://zeta.invalid', authDir, productId: 'zeta' }];
  const { f, admin, ids, grant, login } = await world(t, { environments: envs });
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201);
  const ann = await login('ann');
  ok(await admin.request('/api/modules/beta/cases', 'POST', manual('BE-001')), 201);
  const run = ok(await admin.request('/api/runs', 'POST', { moduleId: 'beta', environmentId: 'local', mode: 'manual', caseIds: ['BE-001'], name: 'b' }), 201);
  const betaLead = f.store.membershipsFor('module', 'beta')[0].id;
  const pairs = [['/api/runs/' + run.id, '/api/runs/00000000-0000-0000-0000-000000000000'], ['/api/modules/beta/cases', '/api/modules/nonexistent/cases'],
    ['/api/memberships/' + betaLead, '/api/memberships/nope'], ['/api/products/zeta/members', '/api/products/nonexistent/members']];
  for (const [hidden, missing] of pairs) {
    const a = await ann.request(hidden, hidden.includes('memberships') ? 'DELETE' : 'GET'), b = await ann.request(missing, hidden.includes('memberships') ? 'DELETE' : 'GET');
    assert.deepEqual([a.status, a.value], [404, { error: 'Not found.' }], hidden);
    assert.deepEqual([b.status, b.value], [a.status, a.value], missing);
  }
  assert.ok(f.store.memberships().every(m => !String(m.id).startsWith('legacy-')));
  const leg = await makeUser(admin, 'leg', 'tester');
  assert.ok(!f.store.memberships().find(m => m.subjectId === leg.id).id.startsWith('legacy-'));
  assert.equal((await ann.request(`/api/memberships/legacy-${leg.id}`, 'DELETE')).value.error, 'Not found.');
  // coverage: an environment of another product is not a valid choice
  assert.equal((await ann.request('/api/modules/alpha/coverage?environmentId=zeta-env')).status, 400);
  assert.equal((await ann.request('/api/modules/alpha/coverage?environmentId=local')).status, 200);
  void ids;
});

test('finding 8b: the agent status does not reveal which module is busy to people who cannot see it', async t => {
  const never = () => { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => { setImmediate(() => child.emit('exit', null)); return true; }; return child; };
  const { admin, grant, login } = await world(t, { agentOptions: { spawn: never, probe: async id => ({ id, label: id, available: id === 'claude', version: '1' }) } });
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201);
  const ann = await login('ann');
  const up = await admin.request('/api/modules/beta/intake/files', 'POST', Buffer.from('rules\n'), { 'x-file-name': 'r.txt', 'content-type': 'application/octet-stream' });
  ok(up, 201);
  await until(async () => (await admin.request('/api/modules/beta/intake')).value.files[0].extract === 'ok');
  const job = ok(await admin.request('/api/modules/beta/agent/jobs', 'POST', { agent: 'claude', kind: 'analyze' }), 202);
  const seenByAdmin = ok(await admin.request('/api/agent/status')).busy;
  assert.deepEqual([seenByAdmin.moduleId, seenByAdmin.jobId], ['beta', job.id]);
  assert.deepEqual(ok(await ann.request('/api/agent/status')).busy, { busy: true });
});

test('finding 9: login profile identity is shown only to people who can run tests in the product', async t => {
  const saved = process.env.AUGASTAM_USER; process.env.AUGASTAM_USER = 'svc-login-user';
  t.after(() => { if (saved === undefined) delete process.env.AUGASTAM_USER; else process.env.AUGASTAM_USER = saved; });
  const { admin, grant, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'viewer'), 201); ok(await grant('module', 'alpha', 'ben', 'tester'), 201);
  const profile = async c => ok(await c.request('/api/bootstrap')).environments[0];
  assert.equal((await profile(admin)).login.username, 'svc-login-user');
  assert.equal((await profile(await login('ben'))).login.username, 'svc-login-user');
  const hidden = await profile(await login('ann'));
  assert.deepEqual(hidden.login, { username: '', tenant: '', facility: '', role: '' });
  assert.ok(hidden.name && hidden.url && hidden.session);
});
