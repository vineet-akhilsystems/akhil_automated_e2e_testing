import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedIn, makeUser } from './support.mjs';
import { PERMISSION_IDS, ROLES, permissionsOf, effectiveModulePermissions } from '../access.mjs';

// The second-approver rule is rights-based: 'case.approve.own' (Admins by default, anyone else when granted) lets a reviewer approve their own work.
const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const manual = (id, extra = {}) => ({ id, title: `Case ${id}`, mode: 'manual', category: 'Gate', priority: 'P1', steps: [{ action: 'Do it', expected: 'It works' }], ...extra });
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.value)); return r.value; };
const ONLY = 'Another person must approve this case.';
const M = '/api/modules/alpha';

async function world(t) {
  const f = await boot(t, { bootstrap: ADMIN, strict: true });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const ids = {}, pw = {};
  for (const name of ['ann', 'ben', 'cat', 'dan']) { const u = await makeUser(admin, name, 'member'); ids[name] = u.id; pw[name] = u.password; }
  ok(await admin.request('/api/modules', 'POST', { name: 'Alpha', prefix: 'AL', area: 'A' }), 201);
  const grant = (user, role, body = {}) => admin.request(`${M}/members`, 'POST', { subjectType: 'user', subjectId: ids[user], role, ...body });
  const login = name => signedIn(f, name, pw[name]);
  const review = (c, idsList, decision = 'approved') => c.request(`${M}/cases/review`, 'POST', { ids: idsList, decision });
  const audit = async action => ok(await admin.request('/api/audit?scopeType=module&scopeId=alpha')).filter(e => e.action === action);
  return { f, admin, ids, grant, login, review, audit };
}

test('unit: case.approve.own is in the catalogue, held by admins, and by no preset role', () => {
  assert.ok(PERMISSION_IDS.includes('case.approve.own'));
  for (const role of Object.values(ROLES)) assert.ok(!role.permissions.includes('case.approve.own'), role.id);
  assert.ok(effectiveModulePermissions({ role: 'admin' }, { id: 'x' }).has('case.approve.own'));
  assert.ok(permissionsOf('lead', { 'case.approve.own': true }).has('case.approve.own'));
  assert.ok(!permissionsOf('lead', {}).has('case.approve.own'));
});

test('admin: new cases are approved on creation, recorded as self-approved, and run like any approved case', async t => {
  const { admin, audit } = await world(t);
  assert.equal(ok(await admin.request('/api/bootstrap')).modules.find(m => m.id === 'alpha').settings.requireSecondApprover, true);   // default setting
  const made = ok(await admin.request(`${M}/cases`, 'POST', manual('AL-001')), 201);
  assert.equal(made.reviewStatus, 'approved');
  assert.deepEqual([made.reviewedBy.user, made.reviewedBy.decision, made.reviewedBy.self], ['root', 'approved', true]);
  assert.equal((await audit('case.create'))[0].detail.selfApproved, true);
  const run = await admin.request('/api/runs', 'POST', { moduleId: 'alpha', environmentId: 'local', mode: 'manual', caseIds: ['AL-001'], name: 'self approved' });
  assert.equal(run.status, 201, JSON.stringify(run.value));
});

test('admin: edit after approval keeps the approval; a draft can be approved or rejected by its author, with the audit trail', async t => {
  const { f, admin, review, audit } = await world(t);
  const made = ok(await admin.request(`${M}/cases`, 'POST', manual('AL-001')), 201);
  const edited = ok(await admin.request(`${M}/cases/AL-001`, 'PUT', { ...made, title: 'Changed title', version: made.version }));
  assert.equal(edited.reviewStatus, 'approved');
  assert.equal(edited.contentBy.user, 'root');
  ok(await admin.request(`${M}/cases`, 'POST', manual('AL-002', { reviewStatus: 'draft' })), 201);
  ok(await admin.request(`${M}/cases`, 'POST', manual('AL-003', { reviewStatus: 'draft' })), 201);
  assert.equal(f.store.case('alpha', 'AL-002').reviewStatus, 'draft');
  ok(await review(admin, ['AL-002']));
  const c2 = f.store.case('alpha', 'AL-002');
  assert.deepEqual([c2.reviewStatus, c2.reviewedBy.decision, c2.reviewedBy.self], ['approved', 'approved', true]);
  ok(await review(admin, ['AL-003'], 'rejected'));
  assert.deepEqual([f.store.case('alpha', 'AL-003').reviewStatus, f.store.case('alpha', 'AL-003').reviewedBy.self], ['rejected', true]);
  const reviews = await audit('case.review');
  assert.ok(reviews.length >= 2 && reviews.every(e => e.detail.selfApproved === true));
});

test('admin: bulk approve handles many of their own cases in one request', async t => {
  const { f, admin, review, audit } = await world(t);
  for (const n of [1, 2, 3]) ok(await admin.request(`${M}/cases`, 'POST', manual(`AL-00${n}`, { reviewStatus: 'draft' })), 201);
  ok(await review(admin, ['AL-001', 'AL-002', 'AL-003']));
  assert.deepEqual(['AL-001', 'AL-002', 'AL-003'].map(id => f.store.case('alpha', id).reviewStatus), ['approved', 'approved', 'approved']);
  assert.deepEqual((await audit('case.review'))[0].detail.selfApprovedIds, ['AL-001', 'AL-002', 'AL-003']);
});

test('approving someone else\'s case is not marked as a self-approval', async t => {
  const { f, admin, grant, login, review, audit } = await world(t);
  ok(await grant('ann', 'ba'), 201);
  const ann = await login('ann');
  ok(await ann.request(`${M}/cases`, 'POST', manual('AL-001')), 201);
  assert.equal(f.store.case('alpha', 'AL-001').reviewStatus, 'draft');
  ok(await review(admin, ['AL-001']));
  const c = f.store.case('alpha', 'AL-001');
  assert.deepEqual([c.reviewStatus, c.reviewedBy.user, c.reviewedBy.self], ['approved', 'root', undefined]);
  assert.equal((await audit('case.review'))[0].detail.selfApproved, undefined);
});

test('a lead without the right is still held to the rule; the right can be granted per person and revoked again', async t => {
  const { f, admin, grant, login, review, audit } = await world(t);
  const m = ok(await grant('cat', 'lead'), 201);
  const cat = await login('cat');
  const made = ok(await cat.request(`${M}/cases`, 'POST', manual('AL-001')), 201);
  assert.equal(made.reviewStatus, 'draft');
  const refused = await review(cat, ['AL-001']);
  assert.deepEqual([refused.status, refused.value.error], [403, ONLY]);
  assert.equal((await review(cat, ['AL-001'], 'rejected')).status, 403);
  assert.ok(!ok(await cat.request('/api/me/access')).modules.alpha.includes('case.approve.own'));
  // grant it as a per-person override
  ok(await admin.request(`/api/memberships/${m.id}`, 'PATCH', { overrides: { 'case.approve.own': true } }));
  assert.ok(ok(await cat.request('/api/me/access')).modules.alpha.includes('case.approve.own'));
  ok(await review(cat, ['AL-001']));
  assert.equal(f.store.case('alpha', 'AL-001').reviewedBy.self, true);
  const own = ok(await cat.request(`${M}/cases`, 'POST', manual('AL-002')), 201);          // now approved on creation
  assert.equal(own.reviewStatus, 'approved');
  const edited = ok(await cat.request(`${M}/cases/AL-002`, 'PUT', { ...own, title: 'Edited', version: own.version }));
  assert.equal(edited.reviewStatus, 'approved');
  assert.ok((await audit('case.review')).some(e => e.actor === 'cat' && e.detail.selfApproved === true));
  // revoke: the rule applies again, and an edit sends the case back to review
  ok(await admin.request(`/api/memberships/${m.id}`, 'PATCH', { overrides: {} }));
  const back = ok(await cat.request(`${M}/cases/AL-002`, 'PUT', { ...edited, title: 'Edited again', version: edited.version }));
  assert.equal(back.reviewStatus, 'draft');
  const again = await review(cat, ['AL-002']);
  assert.deepEqual([again.status, again.value.error], [403, ONLY]);
});

test('the right does not make someone a reviewer: without case.review they still cannot approve', async t => {
  const { f, grant, login, review } = await world(t);
  ok(await grant('ann', 'ba', { overrides: { 'case.approve.own': true } }), 201);
  const ann = await login('ann');
  const made = ok(await ann.request(`${M}/cases`, 'POST', manual('AL-001')), 201);
  assert.equal(made.reviewStatus, 'draft');                                                   // not a reviewer: back to draft as always
  const r = await review(ann, ['AL-001']);
  assert.equal(r.status, 403); assert.notEqual(r.value.error, ONLY);                          // refused for the missing review right, not the rule
  assert.equal(f.store.case('alpha', 'AL-001').reviewStatus, 'draft');
  const edited = ok(await ann.request(`${M}/cases/AL-001`, 'PUT', { ...made, title: 'x', version: made.version }));
  assert.equal(edited.reviewStatus, 'draft');
});

test('a team or product-level grant carries the right to its members, and only to them', async t => {
  const { f, admin, ids, grant, login, review } = await world(t);
  const team = ok(await admin.request('/api/teams', 'POST', { name: 'Self approvers' }), 201);
  ok(await admin.request(`${M}/members`, 'POST', { subjectType: 'team', subjectId: team.id, role: 'tester', overrides: { 'case.approve.own': true } }), 201);
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.dan }), 201);
  ok(await grant('ben', 'tester'), 201);
  const dan = await login('dan'), ben = await login('ben');
  assert.equal(ok(await dan.request(`${M}/cases`, 'POST', manual('AL-001')), 201).reviewStatus, 'approved');
  assert.equal(ok(await ben.request(`${M}/cases`, 'POST', manual('AL-002')), 201).reviewStatus, 'draft');
  assert.equal((await review(ben, ['AL-002'])).status, 403);
  ok(await review(dan, ['AL-001'], 'rejected'));
  assert.equal(f.store.case('alpha', 'AL-001').reviewedBy.self, true);
  ok(await admin.request('/api/products/augastam/members', 'POST', { subjectType: 'user', subjectId: ids.cat, role: 'tester', overrides: { 'case.approve.own': true } }), 201);
  const cat = await login('cat');
  assert.equal(ok(await cat.request(`${M}/cases`, 'POST', manual('AL-003')), 201).reviewStatus, 'approved');
});

test('grant cap: nobody can hand out the right without holding it, and expiry caps apply', async t => {
  const { admin, ids, grant, login } = await world(t);
  const lead = ok(await grant('ann', 'lead'), 201);
  const ann = await login('ann');
  const give = (body = {}) => ann.request(`${M}/members`, 'POST', { subjectType: 'user', subjectId: ids.ben, role: 'tester', overrides: { 'case.approve.own': true }, ...body });
  assert.equal((await give()).status, 403);                                                   // ann does not hold it
  const until = new Date(Date.now() + 3600000).toISOString();
  ok(await admin.request(`/api/memberships/${lead.id}`, 'PATCH', { overrides: { 'case.approve.own': true }, expiresAt: until }));
  assert.equal((await give({ expiresAt: new Date(Date.now() + 7200000).toISOString() })).status, 403);   // would outlive ann's own right
  const granted = await give({ expiresAt: new Date(Date.now() + 1800000).toISOString() });
  assert.equal(granted.status, 201, JSON.stringify(granted.value));
});

test('import: an admin\'s imported cases land approved (self-approved) unless marked draft, and drafts can then be approved by the admin', async t => {
  const { f, admin, grant, login, review } = await world(t);
  const cases = [manual('AL-001'), manual('AL-002', { reviewStatus: 'draft' })];
  assert.equal((await admin.request(`${M}/import`, 'POST', { format: 'json', data: { cases } })).status, 201);
  const a = f.store.case('alpha', 'AL-001'), b = f.store.case('alpha', 'AL-002');
  assert.deepEqual([a.reviewStatus, a.reviewedBy.self, b.reviewStatus], ['approved', true, 'draft']);
  ok(await review(admin, ['AL-002']));
  assert.equal(f.store.case('alpha', 'AL-002').reviewStatus, 'approved');
  // a tester without the right importing the same shape gets drafts only
  ok(await grant('ben', 'tester'), 201);
  const ben = await login('ben');
  assert.equal((await ben.request(`${M}/import`, 'POST', { format: 'json', data: { cases: [manual('AL-010')] } })).status, 201);
  assert.equal(f.store.case('alpha', 'AL-010').reviewStatus, 'draft');
  assert.equal((await review(ben, ['AL-010'])).status, 403);
});

test('turning the module rule off still works and records no self flag', async t => {
  const { f, admin } = await world(t);
  ok(await admin.request(M, 'PUT', { settings: { requireSecondApprover: false }, version: f.store.module('alpha').version }));
  const made = ok(await admin.request(`${M}/cases`, 'POST', manual('AL-001')), 201);
  assert.deepEqual([made.reviewStatus, made.reviewedBy.self], ['approved', undefined]);
});
