import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { boot, signedIn, makeUser } from './support.mjs';
import { openStore } from '../store.mjs';

const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const manual = (id, extra = {}) => ({ id, title: `Case ${id}`, mode: 'manual', category: 'Gate', priority: 'P1', steps: [{ action: 'Do it', expected: 'It works' }], ...extra });
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.value)); return r.value; };
const caseOf = (cases, id) => cases.find(c => c.id === id);

// Two products, three modules (alpha+beta in Augastam, gamma in Zeta), plain member accounts.
async function world(t, extra = {}) {
  const f = await boot(t, { bootstrap: ADMIN, ...extra });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const ids = {}, pw = {};
  for (const name of ['ann', 'ben', 'cat', 'dan', 'eve']) { const u = await makeUser(admin, name, 'member'); ids[name] = u.id; pw[name] = u.password; }
  ok(await admin.request('/api/products', 'POST', { name: 'Zeta' }), 201);
  ok(await admin.request('/api/modules', 'POST', { name: 'Alpha', prefix: 'AL', area: 'A' }), 201);
  ok(await admin.request('/api/modules', 'POST', { name: 'Beta', prefix: 'BE', area: 'B' }), 201);
  ok(await admin.request('/api/modules', 'POST', { name: 'Gamma', prefix: 'GA', area: 'G', productId: 'zeta' }), 201);
  const grant = (scope, id, user, role, extraBody = {}) => admin.request(`/api/${scope}s/${id}/members`, 'POST', { subjectType: 'user', subjectId: ids[user], role, ...extraBody });
  const login = name => signedIn(f, name, pw[name]);
  return { f, admin, ids, pw, grant, login };
}

test('creating a module makes the creator its lead; members cannot create modules', async t => {
  const { admin, ids, grant, login } = await world(t);
  const members = ok(await admin.request('/api/modules/alpha/members'));
  assert.equal(members.length, 1); assert.equal(members[0].role, 'lead'); assert.equal(members[0].subject.type, 'user');
  ok(await grant('product', 'augastam', 'ann', 'viewer'), 201);
  const ann = await login('ann');
  assert.equal((await ann.request('/api/modules', 'POST', { name: 'Nope', prefix: 'NO', area: 'A' })).status, 403);
  ok(await grant('product', 'augastam', 'ben', 'owner'), 201);
  const ben = await login('ben');
  ok(await ben.request('/api/modules', 'POST', { name: 'By Owner', prefix: 'BO', area: 'A' }), 201);
  assert.equal(ok(await ben.request('/api/modules/by-owner/members')).some(m => m.subject.id === ids.ben && m.role === 'lead'), true);
  // an owner of Augastam cannot create a module in Zeta, and Zeta is invisible to them
  assert.equal((await ben.request('/api/modules', 'POST', { name: 'Sneaky', prefix: 'SN', area: 'A', productId: 'zeta' })).status, 404);
});

test('cross-module isolation: a lead of alpha gets 404 for beta on every module route, listings and downloads', async t => {
  const { f, admin, ids, grant, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201);
  ok(await admin.request('/api/modules/beta/cases', 'POST', manual('BE-001')), 201);
  ok(await admin.request('/api/modules/alpha/cases', 'POST', manual('AL-001')), 201);
  const upload = await admin.request('/api/modules/beta/intake/files', 'POST', Buffer.from('secret beta rules\n'), { 'x-file-name': 'beta.txt', 'content-type': 'application/octet-stream' });
  const fileId = ok(upload, 201).id;
  const betaRun = ok(await admin.request('/api/runs', 'POST', { moduleId: 'beta', environmentId: 'local', mode: 'manual', caseIds: ['BE-001'], name: 'beta run' }), 201);
  const alphaRun = ok(await admin.request('/api/runs', 'POST', { moduleId: 'alpha', environmentId: 'local', mode: 'manual', caseIds: ['AL-001'], name: 'alpha run' }), 201);
  const ann = await login('ann');

  const m = '/api/modules/beta';
  const probes = [
    ['GET', `${m}/cases`], ['GET', `${m}/export`], ['GET', `${m}/export?format=xlsx`], ['GET', `${m}/coverage`], ['GET', `${m}/intake`], ['GET', `${m}/insights`], ['GET', `${m}/pack`],
    ['GET', `${m}/intake/files/${fileId}/download`], ['GET', `${m}/intake/files/${fileId}/text`], ['DELETE', `${m}/intake/files/${fileId}`], ['POST', `${m}/intake/files`, Buffer.from('x')],
    ['POST', `${m}/intake/analyze`, {}], ['GET', `${m}/intake/analyze/abc`], ['PUT', `${m}/insights`, { summary: 'x' }],
    ['GET', `${m}/agent/jobs`], ['GET', `${m}/agent/jobs/abc`], ['POST', `${m}/agent/jobs`, { agent: 'claude' }], ['POST', `${m}/agent/jobs/abc/cancel`, {}], ['GET', `${m}/agent/jobs/abc/files?path=x`],
    ['POST', `${m}/cases`, manual('BE-002')], ['PUT', `${m}/cases/BE-001`, manual('BE-001')], ['DELETE', `${m}/cases/BE-001`], ['POST', `${m}/cases/review`, { ids: ['BE-001'], decision: 'approved' }],
    ['POST', `${m}/cases/bulk`, { caseIds: ['BE-001'], action: 'disable' }], ['POST', `${m}/import`, { data: [manual('BE-009')] }], ['POST', `${m}/ai-generate`, {}],
    ['PUT', `${m}/requirements`, { requirements: [] }], ['PUT', `${m}/templates`, {}], ['DELETE', `${m}/templates/x`], ['PUT', m, { name: 'Hijack', area: 'x' }],
    ['GET', `${m}/members`], ['POST', `${m}/members`, { subjectType: 'user', subjectId: ids.ann, role: 'viewer' }],
    ['GET', `/api/runs/${betaRun.id}`], ['GET', `/api/runs/${betaRun.id}/export?format=json`], ['GET', `/api/runs/${betaRun.id}/files/x.json`], ['POST', `/api/runs/${betaRun.id}/results`, { id: 'BE-001', status: 'PASS', actual: 'x' }],
    ['POST', `/api/runs/${betaRun.id}/complete`, {}], ['POST', `/api/runs/${betaRun.id}/cancel`, {}], ['PUT', `/api/runs/${betaRun.id}/triage/BE-001`, {}], ['PUT', `/api/runs/${betaRun.id}/report`, {}],
    ['POST', `/api/runs/${betaRun.id}/rerun-failures`, {}], ['POST', '/api/runs', { moduleId: 'beta', environmentId: 'local', mode: 'manual', caseIds: ['BE-001'], name: 'x' }],
  ];
  for (const [method, route, body] of probes) {
    const r = await ann.request(route, method, body, Buffer.isBuffer(body) ? { 'x-file-name': 'x.txt', 'content-type': 'application/octet-stream' } : {});
    assert.equal(r.status, 404, `${method} ${route} -> ${r.status} ${JSON.stringify(r.value)}`);
  }
  // nothing was changed by those attempts
  assert.equal(f.store.cases('beta').length, 1); assert.equal(f.store.module('beta').name, 'Beta');
  // her own module works
  ok(await ann.request('/api/modules/alpha/cases')); ok(await ann.request('/api/modules/alpha/pack')); assert.equal((await ann.request(`/api/runs/${alphaRun.id}`)).status, 200);
  // listings
  const boot1 = ok(await ann.request('/api/bootstrap'));
  assert.deepEqual(boot1.modules.map(x => x.id), ['alpha']); assert.deepEqual(boot1.runs.map(r => r.id), [alphaRun.id]); assert.deepEqual(boot1.products.map(p => p.id), ['augastam']);
  assert.equal(boot1.products[0].moduleCount, 1); assert.equal(boot1.products[0].runCount, 1);
  assert.deepEqual(ok(await ann.request('/api/runs')).map(r => r.id), [alphaRun.id]);
  assert.deepEqual(ok(await ann.request('/api/products')).map(p => p.id), ['augastam']);
  assert.equal((await ann.request('/api/bootstrap?product=zeta')).status, 404);
  const access = ok(await ann.request('/api/me/access'));
  assert.equal(access.admin, false); assert.deepEqual(Object.keys(access.modules), ['alpha']); assert.ok(access.modules.alpha.includes('members.manage'));
  assert.deepEqual(Object.keys(access.products), ['augastam']);
  // platform actions stay admin-only
  for (const [method, route, body] of [['GET', '/api/users'], ['POST', '/api/users', { username: 'zz', password: 'password-zz1', role: 'member' }], ['POST', '/api/products', { name: 'Mine' }], ['POST', '/api/environments', {}]]) {
    assert.equal((await ann.request(route, method, body)).status, 403, route);
  }
});

test('cross-product isolation: product-level access does not reach another product', async t => {
  const { grant, login } = await world(t);
  ok(await grant('product', 'augastam', 'ann', 'owner'), 201);
  ok(await grant('product', 'zeta', 'ben', 'viewer'), 201);
  const ann = await login('ann'), ben = await login('ben');
  assert.deepEqual(ok(await ann.request('/api/bootstrap')).modules.map(m => m.id).sort(), ['alpha', 'beta', 'registration']);
  assert.equal((await ann.request('/api/modules/zeta-gamma/cases')).status, 404);
  assert.equal((await ann.request('/api/products/zeta/members')).status, 404);
  assert.equal((await ann.request('/api/audit?scopeType=product&scopeId=zeta')).status, 404);
  const benBoot = ok(await ben.request('/api/bootstrap'));
  assert.deepEqual(benBoot.products.map(p => p.id), ['zeta']);
  assert.equal(benBoot.product.id, 'zeta'); // default falls through to the first visible product
  assert.equal((await ben.request('/api/modules/alpha/cases')).status, 404);
  assert.equal((await ben.request('/api/modules/zeta-gamma/cases')).status, 200);
  assert.equal((await ben.request('/api/bootstrap?product=augastam')).status, 404);
  // a user with no access at all sees an empty portal, not an error
  const eve = await login('eve');
  const empty = ok(await eve.request('/api/bootstrap'));
  assert.equal(empty.product, null); assert.deepEqual(empty.modules, []); assert.deepEqual(empty.products, []); assert.deepEqual(empty.runs, []);
  assert.equal((await eve.request('/api/modules/alpha/cases')).status, 404);
  assert.deepEqual(ok(await eve.request('/api/me/access')), { admin: false, products: {}, modules: {} });
});

test('module-only viewer: read access, no writes (403), other modules are invisible', async t => {
  const { admin, grant, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'viewer'), 201);
  ok(await admin.request('/api/modules/alpha/cases', 'POST', manual('AL-001')), 201);
  const ann = await login('ann');
  ok(await ann.request('/api/modules/alpha/cases'));
  const denied = [['POST', '/api/modules/alpha/cases', manual('AL-002')], ['PUT', '/api/modules/alpha/cases/AL-001', manual('AL-001')], ['DELETE', '/api/modules/alpha/cases/AL-001'],
    ['PUT', '/api/modules/alpha/insights', { summary: 'x' }], ['POST', '/api/modules/alpha/cases/review', { ids: ['AL-001'], decision: 'approved' }], ['PUT', '/api/modules/alpha', { name: 'x', area: 'y' }],
    ['GET', '/api/modules/alpha/members'], ['POST', '/api/modules/alpha/agent/jobs', { agent: 'claude' }], ['POST', '/api/modules/alpha/intake/analyze', {}],
    ['POST', '/api/runs', { moduleId: 'alpha', environmentId: 'local', mode: 'manual', caseIds: ['AL-001'], name: 'x' }]];
  for (const [method, route, body] of denied) assert.equal((await ann.request(route, method, body)).status, 403, `${method} ${route}`);
  assert.equal((await ann.request('/api/directory')).status, 403);
  assert.equal((await ann.request('/api/teams')).status, 403);
});

test('no privilege escalation: roles, overrides, product scope and ceilings', async t => {
  const { admin, ids, grant, login } = await world(t);
  // ann is a lead of alpha but her own direct membership removes case.delete and run.start
  ok(await grant('module', 'alpha', 'ann', 'lead', { overrides: { 'case.delete': false, 'run.start': false } }), 201);
  const ann = await login('ann');
  const give = (role, overrides) => ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'user', subjectId: ids.ben, role, overrides });
  assert.equal((await give('lead')).status, 403);
  assert.equal((await give('tester')).status, 403);
  assert.equal((await give('viewer', { 'run.start': true })).status, 403);
  assert.equal((await give('viewer', { 'case.delete': true })).status, 403);
  assert.equal((await give('owner')).status, 400);
  assert.equal((await give('viewer', { 'module.create': true })).status, 400);
  assert.equal((await give('viewer', { 'made.up': true })).status, 400);
  assert.equal((await give('god')).status, 400);
  const ben = ok(await give('ba', { 'case.edit': false }), 201);
  assert.equal(ben.effective.includes('case.edit'), false); assert.ok(ben.effective.includes('case.create'));
  // she cannot touch product scope or take over someone more powerful
  assert.equal((await ann.request('/api/products/augastam/members', 'POST', { subjectType: 'user', subjectId: ids.ben, role: 'viewer' })).status, 403);
  const adminMember = ok(await admin.request('/api/modules/alpha/members')).find(m => m.subject.name === 'Administrator');
  assert.ok(adminMember);
  assert.equal((await ann.request(`/api/memberships/${adminMember.id}`, 'PATCH', { role: 'viewer' })).status, 403); // would lower someone with more power than she has
  assert.equal((await ann.request(`/api/memberships/${adminMember.id}`, 'DELETE')).status, 403);
  // promoting someone via PATCH is checked as well
  assert.equal((await ann.request(`/api/memberships/${ben.id}`, 'PATCH', { role: 'lead' })).status, 403);
  assert.equal((await ann.request(`/api/memberships/${ben.id}`, 'PATCH', { role: 'viewer' })).status, 200);
  // team grants are checked the same way
  const team = ok(await admin.request('/api/teams', 'POST', { name: 'Everyone' }), 201);
  assert.equal((await ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'team', subjectId: team.id, role: 'lead' })).status, 403);
  assert.equal((await ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'team', subjectId: team.id, role: 'viewer' })).status, 201);
  // a user cannot edit their own membership, nor add themselves elsewhere
  const own = ok(await admin.request('/api/modules/alpha/members')).find(m => m.subject.id === ids.ann);
  assert.equal((await ann.request(`/api/memberships/${own.id}`, 'PATCH', { overrides: {} })).status, 403);
  assert.equal((await ann.request(`/api/memberships/${own.id}`, 'DELETE')).status, 403);
  assert.equal((await ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'user', subjectId: ids.ann, role: 'viewer' })).status, 403);
});

test('product owner delegation: owners grant within their ceiling and manage product access', async t => {
  const { ids, grant, login } = await world(t);
  ok(await grant('product', 'augastam', 'ann', 'owner'), 201);
  const ann = await login('ann');
  assert.equal((await ann.request('/api/products/augastam/members', 'POST', { subjectType: 'user', subjectId: ids.ben, role: 'owner' })).status, 201);
  assert.equal((await ann.request('/api/modules/beta/members', 'POST', { subjectType: 'user', subjectId: ids.cat, role: 'lead' })).status, 201);
  const dirHits = ok(await ann.request('/api/directory?q=da'));
  assert.deepEqual(dirHits.map(u => u.username), ['dan']); assert.deepEqual(Object.keys(dirHits[0]).sort(), ['displayName', 'id', 'username']);
  assert.equal((await ann.request('/api/users')).status, 403);
});

test('last-lead rule: an administrator may remove the last lead, and it is flagged and audited', async t => {
  const { admin, grant, login } = await world(t);
  const root = ok(await admin.request('/api/modules/alpha/members'))[0];
  assert.equal(root.noLead, false);
  // someone who manages access but is not a lead cannot touch the lead's entry at all
  ok(await grant('module', 'alpha', 'ben', 'lead', { overrides: { 'module.settings': false } }), 201);
  const ben = await login('ben');
  assert.equal((await ben.request(`/api/memberships/${root.id}`, 'DELETE')).status, 403);
  assert.equal((await ben.request(`/api/memberships/${root.id}`, 'PATCH', { role: 'viewer' })).status, 403);
  // an administrator is not blocked (even from removing their own automatic lead entry), but nothing is silent
  ok(await admin.request(`/api/memberships/${root.id}`, 'DELETE'));
  const list = await admin.request('/api/modules/alpha/members');
  assert.equal(list.response.headers.get('x-no-lead'), 'true'); assert.ok(list.value.every(m => m.noLead === true));
  assert.ok(ok(await admin.request('/api/audit?scopeType=module&scopeId=alpha')).some(e => e.action === 'module.noLead'));
});

test('last-lead rule through a team: only an administrator can delete or empty the only lead team', async t => {
  const { admin, ids, grant, login } = await world(t);
  const root = ok(await admin.request('/api/modules/alpha/members'))[0];
  ok(await grant('module', 'alpha', 'ben', 'lead', { overrides: { 'module.settings': false } }), 201);
  const ben = await login('ben');
  const team = ok(await ben.request('/api/teams', 'POST', { name: 'Leads' }), 201);
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.ann }), 201);
  ok(await admin.request('/api/modules/alpha/members', 'POST', { subjectType: 'team', subjectId: team.id, role: 'lead' }), 201);
  ok(await admin.request(`/api/memberships/${root.id}`, 'DELETE'));            // the team is now the only lead
  assert.equal((await ben.request(`/api/teams/${team.id}`, 'DELETE')).status, 403);
  assert.equal((await ben.request(`/api/teams/${team.id}/members/${ids.ann}`, 'DELETE')).status, 403);
  assert.equal(ok(await admin.request('/api/teams')).find(x => x.id === team.id).memberCount, 1);
  ok(await admin.request(`/api/teams/${team.id}/members/${ids.ann}`, 'DELETE'));  // admins are not blocked, but it is recorded
  assert.ok(ok(await admin.request('/api/audit?scopeType=module&scopeId=alpha')).some(e => e.action === 'module.noLead'));
  ok(await admin.request(`/api/teams/${team.id}`, 'DELETE'));
});

test('expired memberships are ignored immediately and can be extended or cleared', async t => {
  const { f, admin, grant, login } = await world(t);
  const past = new Date(Date.now() - 60000).toISOString(), future = new Date(Date.now() + 3600000).toISOString();
  // access that is already over cannot be granted or edited into existence ...
  assert.equal((await grant('module', 'alpha', 'ann', 'viewer', { expiresAt: past })).status, 400);
  const m = ok(await grant('module', 'alpha', 'ann', 'viewer', { expiresAt: future }), 201);
  assert.equal((await admin.request(`/api/memberships/${m.id}`, 'PATCH', { expiresAt: past })).status, 400);
  // ... so simulate time passing by moving the stored expiry
  const expire = at => f.store.saveMembership({ ...f.store.membership(m.id), expiresAt: at });
  expire(past);
  const ann = await login('ann');
  assert.equal((await ann.request('/api/modules/alpha/cases')).status, 404);
  assert.deepEqual(ok(await ann.request('/api/bootstrap')).modules, []);
  assert.equal((await grant('module', 'alpha', 'ann', 'viewer', { expiresAt: 'not-a-date' })).status, 400);
  ok(await admin.request(`/api/memberships/${m.id}`, 'PATCH', { expiresAt: future }));
  assert.equal((await ann.request('/api/modules/alpha/cases')).status, 200);
  assert.equal(ok(await admin.request('/api/modules/alpha/members')).find(x => x.id === m.id).expiresAt, future);
  expire(past);
  assert.equal((await ann.request('/api/modules/alpha/cases')).status, 404);
  ok(await admin.request(`/api/memberships/${m.id}`, 'PATCH', { expiresAt: null }));
  assert.equal((await ann.request('/api/modules/alpha/cases')).status, 200);
  // expired product ownership also stops inheritance
  const p = ok(await grant('product', 'augastam', 'ben', 'owner', { expiresAt: future }), 201);
  f.store.saveMembership({ ...f.store.membership(p.id), expiresAt: past });
  assert.equal((await (await login('ben')).request('/api/modules/beta/cases')).status, 404);
});

test('teams: access follows membership instantly; direct membership beats team; removal revokes', async t => {
  const { admin, ids, login } = await world(t);
  const team = ok(await admin.request('/api/teams', 'POST', { name: 'QA Team', description: 'testers' }), 201);
  assert.equal(team.memberCount, 0);
  ok(await admin.request('/api/modules/alpha/members', 'POST', { subjectType: 'team', subjectId: team.id, role: 'tester' }), 201);
  const dan = await login('dan');
  assert.equal((await dan.request('/api/modules/alpha/cases')).status, 404);                 // not in the team yet
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.dan }), 201);
  assert.equal((await dan.request('/api/modules/alpha/cases')).status, 200);                 // same session, now allowed
  assert.equal((await dan.request('/api/modules/alpha/cases', 'POST', manual('AL-001'))).status, 201);
  assert.equal(ok(await admin.request('/api/teams')).find(x => x.id === team.id).members[0].username, 'dan');
  // direct membership replaces the team's grant at module scope
  const direct = ok(await admin.request('/api/modules/alpha/members', 'POST', { subjectType: 'user', subjectId: ids.dan, role: 'viewer' }), 201);
  assert.equal((await dan.request('/api/modules/alpha/cases', 'POST', manual('AL-002'))).status, 403);
  ok(await admin.request(`/api/memberships/${direct.id}`, 'DELETE'));
  assert.equal((await dan.request('/api/modules/alpha/cases', 'POST', manual('AL-002'))).status, 201);
  // remove from the team: gone at once
  ok(await admin.request(`/api/teams/${team.id}/members/${ids.dan}`, 'DELETE'));
  assert.equal((await dan.request('/api/modules/alpha/cases')).status, 404);
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.dan }), 201);
  assert.equal((await dan.request('/api/modules/alpha/cases')).status, 200);
  // delete the team: membership rows vanish, access revoked
  ok(await admin.request(`/api/teams/${team.id}`, 'DELETE'));
  assert.equal((await dan.request('/api/modules/alpha/cases')).status, 404);
  assert.equal(ok(await admin.request('/api/modules/alpha/members')).some(m => m.subject.type === 'team'), false);
});

test('team administration: creator or admin only; names unique; members must exist', async t => {
  const { admin, ids, grant, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201); ok(await grant('module', 'beta', 'ben', 'lead'), 201);
  const ann = await login('ann'), ben = await login('ben');
  const team = ok(await ann.request('/api/teams', 'POST', { name: 'Ann team' }), 201);
  assert.equal(team.createdBy, 'ann');
  assert.equal((await ann.request('/api/teams', 'POST', { name: 'ann TEAM' })).status, 409);
  assert.equal((await ben.request(`/api/teams/${team.id}`, 'PATCH', { name: 'stolen' })).status, 403);
  assert.equal((await ben.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.ben })).status, 403);
  assert.equal((await ben.request(`/api/teams/${team.id}`, 'DELETE')).status, 403);
  assert.equal((await ann.request(`/api/teams/${team.id}/members`, 'POST', { userId: 'nobody' })).status, 404);
  assert.equal(ok(await ann.request(`/api/teams/${team.id}`, 'PATCH', { description: 'd' })).description, 'd');
  assert.equal((await ann.request('/api/teams/none', 'PATCH', {})).status, 404);
  assert.equal(ok(await admin.request(`/api/teams/${team.id}`, 'PATCH', { name: 'Renamed' })).name, 'Renamed');
  assert.equal((await (await login('cat')).request('/api/teams')).status, 403);
});

test('disabled users lose everything; deleting a user removes memberships and team seats', async t => {
  const { admin, ids, grant, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'tester'), 201);
  const team = ok(await admin.request('/api/teams', 'POST', { name: 'T' }), 201);
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.ann }), 201);
  const ann = await login('ann');
  assert.equal((await ann.request('/api/modules/alpha/cases')).status, 200);
  ok(await admin.request(`/api/users/${ids.ann}`, 'PATCH', { disabled: true }));
  assert.equal((await ann.request('/api/modules/alpha/cases')).status, 401);
  ok(await admin.request(`/api/users/${ids.ann}`, 'PATCH', { disabled: false }));
  assert.equal((await (await login('ann')).request('/api/modules/alpha/cases')).status, 200);
  ok(await admin.request(`/api/users/${ids.ann}`, 'DELETE'));
  assert.equal(ok(await admin.request('/api/modules/alpha/members')).some(m => m.subject.id === ids.ann), false);
  assert.equal(ok(await admin.request('/api/teams')).find(x => x.id === team.id).memberCount, 0);
});

test('permissions are computed per request, never cached in the session', async t => {
  const { admin, grant, login } = await world(t);
  const ann = await login('ann');
  assert.equal((await ann.request('/api/modules/alpha/cases')).status, 404);
  const m = ok(await grant('module', 'alpha', 'ann', 'viewer'), 201);
  assert.equal((await ann.request('/api/modules/alpha/cases')).status, 200);
  assert.equal((await ann.request('/api/modules/alpha/cases', 'POST', manual('AL-001'))).status, 403);
  ok(await admin.request(`/api/memberships/${m.id}`, 'PATCH', { role: 'ba' }));
  assert.equal((await ann.request('/api/modules/alpha/cases', 'POST', manual('AL-001'))).status, 201);
  assert.ok(ok(await ann.request('/api/me/access')).modules.alpha.includes('case.create'));
  ok(await admin.request(`/api/memberships/${m.id}`, 'PATCH', { overrides: { 'case.create': false } }));
  assert.equal((await ann.request('/api/modules/alpha/cases', 'POST', manual('AL-002'))).status, 403);
  ok(await admin.request(`/api/memberships/${m.id}`, 'DELETE'));
  assert.equal((await ann.request('/api/modules/alpha/cases')).status, 404);
  assert.equal((await ann.request('/api/session')).status, 200);
});

test('second approver: nobody approves their own case; the module lead can switch the rule off', async t => {
  const { admin, grant, login } = await world(t, { strict: true });
  ok(await grant('module', 'alpha', 'ann', 'tester'), 201); ok(await grant('module', 'alpha', 'ben', 'tester'), 201); ok(await grant('module', 'alpha', 'cat', 'lead'), 201);
  const ann = await login('ann'), ben = await login('ben'), cat = await login('cat');
  assert.equal(ok(await admin.request('/api/bootstrap')).modules.find(m => m.id === 'alpha').settings.requireSecondApprover, true);
  const made = ok(await ann.request('/api/modules/alpha/cases', 'POST', manual('AL-001')), 201);
  assert.equal(made.reviewStatus, 'draft');                                                    // a reviewer's own case is not auto-approved
  const review = (c, decision = 'approved', ids2 = ['AL-001']) => c.request('/api/modules/alpha/cases/review', 'POST', { ids: ids2, decision });
  const r = await review(ann); assert.equal(r.status, 403); assert.equal(r.value.error, 'Another person must approve this case.');
  assert.equal((await review(ann, 'rejected')).status, 403);
  assert.equal((await ben.request('/api/modules/alpha/cases/AL-001', 'PUT', { ...made, title: 'edited by ben' })).status, 200);
  assert.equal((await review(ben)).status, 403);                                               // the last editor cannot approve either
  assert.equal((await review(cat)).status, 200);
  assert.equal(caseOf(ok(await ann.request('/api/modules/alpha/cases')), 'AL-001').reviewedBy.user, 'cat');
  // admin is not exempt for cases they authored
  ok(await admin.request('/api/modules/alpha/cases', 'POST', manual('AL-002')), 201);
  assert.equal((await review(admin, 'approved', ['AL-002'])).status, 403);
  // a batch is all-or-nothing
  ok(await ann.request('/api/modules/alpha/cases', 'POST', manual('AL-003')), 201);
  ok(await ben.request('/api/modules/alpha/cases', 'POST', manual('AL-004')), 201);
  assert.equal((await review(cat, 'approved', ['AL-002', 'AL-003'])).status, 200);
  assert.equal((await review(ann, 'approved', ['AL-004', 'AL-003'])).status, 403);
  assert.equal(caseOf(ok(await ann.request('/api/modules/alpha/cases')), 'AL-004').reviewStatus, 'draft');
  // only module.settings may change the rule; the change is audited
  ok(await ann.request('/api/modules/alpha/cases', 'POST', manual('AL-006')), 201);
  assert.equal((await review(ann, 'approved', ['AL-006'])).status, 403);
  const alpha = ok(await admin.request('/api/bootstrap')).modules.find(m => m.id === 'alpha');
  assert.equal((await ann.request('/api/modules/alpha', 'PUT', { name: alpha.name, area: alpha.area, version: alpha.version, settings: { requireSecondApprover: false } })).status, 403);
  assert.equal((await cat.request('/api/modules/alpha', 'PUT', { version: alpha.version, settings: { requireSecondApprover: 'no' } })).status, 400);
  const off = ok(await cat.request('/api/modules/alpha', 'PUT', { name: alpha.name, area: alpha.area, version: alpha.version, settings: { requireSecondApprover: false } }));
  assert.equal(off.settings.requireSecondApprover, false);
  assert.equal((await review(ann, 'approved', ['AL-006'])).status, 200);
  const log = ok(await cat.request('/api/audit?scopeType=module&scopeId=alpha'));
  const setting = log.find(e => e.action === 'module.settings');
  assert.deepEqual([setting.actor, setting.detail.requireSecondApprover.to], ['cat', false]);
  // reviewers creating cases under the relaxed rule get the old behaviour back
  assert.equal(ok(await ann.request('/api/modules/alpha/cases', 'POST', manual('AL-007')), 201).reviewStatus, 'approved');
});

test('audit log: changes are recorded and readable only by those who manage the scope', async t => {
  const { admin, ids, grant, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201); ok(await grant('module', 'alpha', 'ben', 'viewer'), 201);
  const ann = await login('ann');
  const bm = ok(await admin.request('/api/modules/alpha/members')).find(m => m.subject.id === ids.ben);
  ok(await ann.request(`/api/memberships/${bm.id}`, 'PATCH', { role: 'ba' }));
  ok(await ann.request(`/api/memberships/${bm.id}`, 'DELETE'));
  const log = ok(await ann.request('/api/audit?scopeType=module&scopeId=alpha'));
  assert.deepEqual(log.slice(0, 2).map(e => e.action), ['membership.remove', 'membership.update']);
  assert.ok(log.some(e => e.action === 'membership.add' && e.subject.name === 'ann'));
  assert.ok(log.some(e => e.action === 'module.create'));
  assert.deepEqual(Object.keys(log[0]).sort(), ['action', 'actor', 'at', 'detail', 'scopeId', 'scopeType', 'subject']);
  assert.equal(log[0].actor, 'ann'); assert.equal(log[1].detail.to.role, 'ba'); assert.equal(log[1].detail.from.role, 'viewer');
  assert.equal((await (await login('cat')).request('/api/audit?scopeType=module&scopeId=alpha')).status, 404);
  assert.equal((await ann.request('/api/audit?scopeType=module&scopeId=beta')).status, 404);
  assert.equal((await ann.request('/api/audit')).status, 403);
  assert.equal((await ann.request('/api/audit?scopeType=platform&scopeId=x')).status, 403);
  const all = ok(await admin.request('/api/audit'));
  assert.ok(all.length >= log.length && all.length <= 200);
  assert.ok(ok(await admin.request('/api/audit?scopeType=product&scopeId=zeta')).some(e => e.action === 'product.create'));
  const team = ok(await admin.request('/api/teams', 'POST', { name: 'Audited' }), 201);
  assert.ok(ok(await admin.request(`/api/audit?scopeType=team&scopeId=${team.id}`)).some(e => e.action === 'team.create'));
});

test('access catalogue, me/access for an admin and legacy role mapping on POST /api/users', async t => {
  const { f, admin } = await world(t);
  const cat = ok(await admin.request('/api/access/roles'));
  assert.deepEqual(cat.roles.map(r => r.id), ['viewer', 'ba', 'tester', 'lead', 'owner']);
  assert.ok(cat.roles.every(r => r.label && r.description && Array.isArray(r.permissions)));
  assert.ok(cat.permissions.every(p => p.id && p.label && p.group) && cat.permissions.some(p => p.id === 'module.create'));
  const me = ok(await admin.request('/api/me/access'));
  assert.equal(me.admin, true); assert.ok(me.modules.alpha.includes('case.delete')); assert.ok(me.products.zeta.includes('module.create'));
  const legacy = ok(await admin.request('/api/users', 'POST', { username: 'tina', password: 'password-tina', role: 'tester' }), 201);
  assert.equal(legacy.role, 'tester');
  const mem = f.store.memberships().find(m => m.subjectId === legacy.id);
  assert.deepEqual([mem.scopeType, mem.scopeId, mem.role], ['product', 'augastam', 'tester']);
  ok(await admin.request(`/api/users/${legacy.id}`, 'PATCH', { role: 'viewer' }));
  assert.equal(f.store.memberships().find(m => m.subjectId === legacy.id).role, 'viewer');
  ok(await admin.request(`/api/users/${legacy.id}`, 'PATCH', { role: 'member' }));
  assert.equal(f.store.memberships().some(m => m.subjectId === legacy.id), false);
  const tina = await signedIn(f, 'tina', 'password-tina');
  assert.equal((await tina.request('/api/modules/registration/cases')).status, 404);
  const member = ok(await admin.request('/api/users', 'POST', { username: 'mia', password: 'password-mia1', role: 'member' }), 201);
  assert.equal(member.role, 'member'); assert.equal(f.store.memberships().some(m => m.subjectId === member.id), false);
  assert.equal((await admin.request('/api/users', 'POST', { username: 'bad', password: 'password-bad1', role: 'owner' })).status, 400);
  // a legacy viewer keeps day-one behaviour on the seeded registration module
  const vic = await makeUser(admin, 'vic', 'viewer'); const v = await signedIn(f, 'vic', vic.password);
  assert.equal((await v.request('/api/modules/registration/cases')).status, 200);
  assert.equal((await v.request('/api/modules/registration/cases', 'POST', manual('X-1'))).status, 403);
});

test('migration: legacy tester/ba/viewer users become Augastam product memberships once, idempotently', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-portal-test-migrate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let store = openStore(dir);
  for (const [id, role] of [['u-t', 'tester'], ['u-b', 'ba'], ['u-v', 'viewer'], ['u-a', 'admin'], ['u-m', 'member']]) store.saveUser({ id, username: id, role, displayName: id, passwordHash: 'x' });
  store.db.exec('DELETE FROM meta; DELETE FROM memberships;');
  store.db.exec(`UPDATE modules SET document=json_remove(document,'$.settings')`);
  store.close();
  store = openStore(dir);
  const found = store.memberships().map(m => [m.subjectId, m.scopeType, m.scopeId, m.role]).sort();
  assert.deepEqual(found, [['u-b', 'product', 'augastam', 'ba'], ['u-t', 'product', 'augastam', 'tester'], ['u-v', 'product', 'augastam', 'viewer']]);
  assert.deepEqual(store.module('registration').settings, { requireSecondApprover: true });
  store.deleteMembership(store.memberships().find(m => m.subjectId === 'u-t').id); store.close();
  store = openStore(dir);
  assert.equal(store.memberships().length, 2);                                              // an admin's removal is not undone at next start
  store.close();
  const raw = new DatabaseSync(path.join(dir, 'portal.sqlite'));
  for (const table of ['teams', 'team_members', 'memberships', 'audit_log']) assert.ok(raw.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table), table);
  raw.close();
});
