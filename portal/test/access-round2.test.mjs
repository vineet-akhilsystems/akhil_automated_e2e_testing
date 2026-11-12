import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { boot, signedIn, makeUser, until } from './support.mjs';

// Regression tests for round 2 of the access-control security review (N1-N10 and the audit gaps).
const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const manual = (id, extra = {}) => ({ id, title: `Case ${id}`, mode: 'manual', category: 'Gate', priority: 'P1', steps: [{ action: 'Do it', expected: 'It works' }], ...extra });
const auto = (id, extra = {}) => ({ id, title: `Auto ${id}`, mode: 'automated', category: 'T', priority: 'P1', action: 'fill', input: { first_name: 'Alpha', last_name: 'Beta' }, expected: { outcome: 'field-state', values: { first_name: 'Alpha' } }, steps: [], ...extra });
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
  const grant = (scope, id, user, role, body = {}) => admin.request(`/api/${scope}s/${id}/members`, 'POST', { subjectType: 'user', subjectId: ids[user], role, ...body });
  const grantTeam = (scope, id, teamId, role, body = {}) => admin.request(`/api/${scope}s/${id}/members`, 'POST', { subjectType: 'team', subjectId: teamId, role, ...body });
  const login = name => signedIn(f, name, pw[name]);
  return { f, admin, ids, pw, grant, grantTeam, login };
}
const actions = (f, scopeType, scopeId) => f.store.auditLog({ scopeType, scopeId }).map(e => e.action);

test('N1: the expiry cap ignores a team grant that the actor\'s direct membership shadows', async t => {
  const { admin, ids, grant, grantTeam, login } = await world(t);
  const team = ok(await admin.request('/api/teams', 'POST', { name: 'Shadow' }), 201);
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.ann }), 201);
  ok(await grantTeam('module', 'alpha', team.id, 'lead'), 201);                    // non-expiring, but shadowed by her direct tester entry
  ok(await grant('module', 'alpha', 'ann', 'tester'), 201);
  ok(await grant('product', 'augastam', 'ann', 'lead', { expiresAt: soon(3600000) }), 201);   // her real managing power
  const ann = await login('ann');
  assert.ok(ok(await ann.request('/api/me/access')).modules.alpha.includes('members.manage'));
  assert.equal((await ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'user', subjectId: ids.dan, role: 'lead' })).status, 403);
  assert.equal((await ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'user', subjectId: ids.dan, role: 'lead', expiresAt: soon(7200000) })).status, 403);
  assert.equal((await ann.request('/api/modules/alpha/members', 'POST', { subjectType: 'user', subjectId: ids.dan, role: 'lead', expiresAt: soon(1800000) })).status, 201);
});

test('N2: nobody adds themselves to a team; the cap fails closed; already-expired grants are refused', async t => {
  const { f, admin, ids, grant, grantTeam, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201);
  ok(await grant('module', 'beta', 'ann', 'tester', { expiresAt: soon(3600000) }), 201);
  const ann = await login('ann');
  const team = ok(await ann.request('/api/teams', 'POST', { name: 'Beta readers' }), 201);
  ok(await grantTeam('module', 'beta', team.id, 'viewer'), 201);                    // attached by someone else, no expiry
  assert.equal((await ann.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.ann })).status, 403);
  // she holds viewer on beta only until her own entry ends, so she may not bring anyone in on a non-expiring grant
  assert.equal((await ann.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.dan })).status, 403);
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.dan }), 201);
  // a team whose only grants are already over still counts: its creator may not join (or add) freely
  const old = ok(await ann.request('/api/teams', 'POST', { name: 'Old owners' }), 201);
  const g = ok(await grantTeam('product', 'zeta', old.id, 'owner', { expiresAt: soon(3600000) }), 201);
  f.store.saveMembership({ ...f.store.membership(g.id), expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await ann.request(`/api/teams/${old.id}/members`, 'POST', { userId: ids.ann })).status, 403);
  assert.equal((await ann.request(`/api/teams/${old.id}/members`, 'POST', { userId: ids.ben })).status, 403);
  // even an administrator cannot grant access that has already ended
  assert.equal((await grant('module', 'beta', 'cat', 'viewer', { expiresAt: new Date(Date.now() - 1000).toISOString() })).status, 400);
});

test('N3: whoever last changed a case\'s content cannot approve it, even after someone else edits metadata', async t => {
  const { f, grant, login } = await world(t, { strict: true });
  for (const u of ['ben', 'cat', 'dan']) ok(await grant('module', 'alpha', u, 'tester'), 201);
  const ben = await login('ben'), cat = await login('cat'), dan = await login('dan');
  const M = '/api/modules/alpha';
  ok(await cat.request(`${M}/cases`, 'POST', manual('AL-002')), 201);
  ok(await dan.request(`${M}/cases/review`, 'POST', { ids: ['AL-002'], decision: 'approved' }));
  const steps = [{ action: 'Do nothing', expected: 'Pass anyway' }];
  let c = f.store.case('alpha', 'AL-002');
  assert.equal(ok(await ben.request(`${M}/cases/AL-002`, 'PUT', { ...manual('AL-002', { steps }), version: c.version })).reviewStatus, 'draft');
  assert.equal(f.store.case('alpha', 'AL-002').contentBy.user, 'ben');
  c = f.store.case('alpha', 'AL-002');
  ok(await cat.request(`${M}/cases/AL-002`, 'PUT', { ...manual('AL-002', { steps, priority: 'P0' }), version: c.version }));   // metadata only
  assert.equal(f.store.case('alpha', 'AL-002').contentBy.user, 'ben');                                                          // unchanged by that edit
  const r = await ben.request(`${M}/cases/review`, 'POST', { ids: ['AL-002'], decision: 'approved' });
  assert.deepEqual([r.status, r.value.error], [403, 'Another person must approve this case.']);
  assert.equal((await ben.request('/api/runs', 'POST', { moduleId: 'alpha', environmentId: 'local', mode: 'manual', caseIds: ['AL-002'], name: 'r' })).status, 409);
  assert.equal((await dan.request(`${M}/cases/review`, 'POST', { ids: ['AL-002'], decision: 'approved' })).status, 200);
  assert.equal(f.store.case('alpha', 'AL-002').contentBy.user, 'ben');                                                          // approval keeps it
  // the client cannot forge it
  c = f.store.case('alpha', 'AL-002');
  const forged = ok(await cat.request(`${M}/cases/AL-002`, 'PUT', { ...manual('AL-002', { steps, priority: 'P2' }), contentBy: { user: 'nobody' }, version: c.version }));
  assert.equal(forged.contentBy.user, 'ben');
});

test('N4: the person whose template edit reset cases cannot approve them; template edits are always audited', async t => {
  const { f, admin, grant, login } = await world(t, { strict: true });
  for (const u of ['ben', 'cat', 'dan']) ok(await grant('module', 'registration', u, 'tester'), 201);
  const ben = await login('ben'), cat = await login('cat'), dan = await login('dan');
  const M = '/api/modules/registration';
  const put = (c, name, input) => c.request(`${M}/templates`, 'PUT', { name, input, version: f.store.module('registration').version });
  ok(await put(admin, 'tpl', { first_name: 'Alpha' }));
  ok(await cat.request(`${M}/cases`, 'POST', auto('ZZ-010', { base: 'tpl' })), 201);
  ok(await dan.request(`${M}/cases/review`, 'POST', { ids: ['ZZ-010'], decision: 'approved' }));
  assert.deepEqual(ok(await put(ben, 'tpl', { first_name: 'Hacked', gender: 'Male' })).resetCases, ['ZZ-010']);
  assert.equal(f.store.case('registration', 'ZZ-010').contentBy.user, 'ben');
  assert.equal((await ben.request(`${M}/cases/review`, 'POST', { ids: ['ZZ-010'], decision: 'approved' })).status, 403);
  assert.equal((await dan.request(`${M}/cases/review`, 'POST', { ids: ['ZZ-010'], decision: 'approved' })).status, 200);
  // order of a template's keys is part of its content
  const reorder = ok(await put(dan, 'tpl', { gender: 'Male', first_name: 'Hacked' }));
  assert.deepEqual(reorder.resetCases, ['ZZ-010']);
  ok(await put(admin, 'unused', { first_name: 'X' }));
  ok(await ben.request(`${M}/templates/unused`, 'DELETE'));
  const log = actions(f, 'module', 'registration');
  for (const a of ['template.update', 'template.delete', 'cases.reset']) assert.ok(log.includes(a), a);
});

test('N5: the legacy role mapping never changes a membership someone set up deliberately', async t => {
  const { f, admin, ids, grant } = await world(t);
  const owner = ok(await grant('product', 'augastam', 'ben', 'owner', { overrides: { 'case.delete': false } }), 201);
  ok(await admin.request(`/api/users/${ids.ben}`, 'PATCH', { role: 'viewer' }));
  const kept = f.store.membership(owner.id);
  assert.deepEqual([kept.role, kept.overrides, kept.legacy], ['owner', { 'case.delete': false }, undefined]);
  ok(await admin.request(`/api/users/${ids.ben}`, 'PATCH', { role: 'member' }));
  assert.equal(f.store.membership(owner.id).role, 'owner');
  const log = f.store.auditLog({ scopeType: 'product', scopeId: 'augastam' }).filter(e => e.action === 'membership.kept');
  assert.equal(log.length, 2); assert.equal(log[0].detail.note, 'kept existing membership'); assert.equal(log[0].detail.existingRole, 'owner');
  // a mapping-created membership is still maintained
  const leg = await makeUser(admin, 'leg', 'tester');
  ok(await admin.request(`/api/users/${leg.id}`, 'PATCH', { role: 'viewer' }));
  assert.equal(f.store.memberships().find(m => m.subjectId === leg.id).role, 'viewer');
});

test('N6: a profile of a product the caller cannot see looks exactly like a missing profile', async t => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-portal-test-env-'));
  t.after(() => fs.rmSync(authDir, { recursive: true, force: true }));
  const envs = [{ id: 'local', name: 'Local', url: 'http://application.invalid', authDir }, { id: 'zeta-env', name: 'Zeta Secret Env', url: 'http://zeta.invalid', authDir, productId: 'zeta' }];
  const { admin, grant, login } = await world(t, { environments: envs });
  ok(await grant('module', 'alpha', 'ann', 'tester'), 201);
  ok(await admin.request('/api/modules/alpha/cases', 'POST', manual('AL-001')), 201);
  const ann = await login('ann');
  const run = environmentId => ann.request('/api/runs', 'POST', { moduleId: 'alpha', environmentId, mode: 'manual', caseIds: ['AL-001'], name: 'x' });
  const hidden = await run('zeta-env'), missing = await run('nonexistent');
  assert.deepEqual([hidden.status, hidden.value], [400, { error: 'Choose a configured environment.' }]);
  assert.deepEqual([hidden.status, hidden.value], [missing.status, missing.value]);
  assert.ok(!JSON.stringify(hidden.value).includes('Zeta'));
  // someone who can see both products still gets the helpful explanation
  ok(await admin.request('/api/products/zeta/members', 'POST', { subjectType: 'user', subjectId: (await admin.request('/api/users')).value.find(u => u.username === 'ann').id, role: 'viewer' }), 201);
  assert.equal((await run('zeta-env')).status, 409);
});

test('N7: removing team members or disabling users stays fast with hundreds of modules and thousands of memberships', async t => {
  const { f, admin, ids, grant } = await world(t);
  const s = f.store, users = [];
  for (let i = 0; i < 300; i++) { const id = randomUUID(); s.saveUser({ id, username: `u${i}`, role: 'member', displayName: `u${i}`, passwordHash: 'x', createdAt: '' }); users.push(id); }
  const teams = [];
  for (let i = 0; i < 50; i++) { const id = randomUUID(); s.saveTeam({ id, name: `team${i}`, createdBy: 'root', createdById: 'x' }); for (let j = 0; j < 5; j++) s.addTeamMember(id, users[(i * 5 + j) % 300]); teams.push(id); }
  s.transaction(() => {
    for (let i = 0; i < 300; i++) {
      const mid = `m${i}`; s.saveModule({ id: mid, productId: 'augastam', name: mid, prefix: 'MM', area: 'A', config: { bases: {}, requirements: [] } });
      for (let j = 0; j < 9; j++) s.saveMembership({ id: randomUUID(), subjectType: j < 7 ? 'user' : 'team', subjectId: j < 7 ? users[(i + j) % 300] : teams[(i + j) % 50], scopeType: 'module', scopeId: mid, role: j === 0 ? 'lead' : 'tester', overrides: {} });
    }
  });
  assert.ok(s.memberships().length > 2500 && s.modules().length > 300);
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201);
  const timed = async fn => { const t0 = performance.now(); const r = await fn(); return [r, performance.now() - t0]; };
  const T = ok(await admin.request('/api/teams', 'POST', { name: 'perf' }), 201);
  ok(await admin.request(`/api/teams/${T.id}/members`, 'POST', { userId: ids.dan }), 201);
  ok(await admin.request(`/api/modules/m1/members`, 'POST', { subjectType: 'team', subjectId: T.id, role: 'tester' }), 201);
  const [remove, removeMs] = await timed(() => admin.request(`/api/teams/${T.id}/members/${ids.dan}`, 'DELETE'));
  assert.equal(remove.status, 200); assert.ok(removeMs < 800, `team member removal took ${Math.round(removeMs)} ms`);
  const [disable, disableMs] = await timed(() => admin.request(`/api/users/${users[3]}`, 'PATCH', { disabled: true }));
  assert.equal(disable.status, 200); assert.ok(disableMs < 800, `disabling a user took ${Math.round(disableMs)} ms`);
  const [rename, renameMs] = await timed(() => admin.request(`/api/users/${ids.dan}`, 'PATCH', { displayName: 'Dan' }));
  assert.equal(rename.status, 200); assert.ok(renameMs < 800, `renaming took ${Math.round(renameMs)} ms`);
});

test('N8: an expiring lead can still reduce access; administrators are not blocked by self or last-lead rules', async t => {
  const { admin, ids, grant, login } = await world(t);
  ok(await grant('module', 'alpha', 'ann', 'lead', { expiresAt: soon(3600000) }), 201);
  const dan = ok(await grant('module', 'alpha', 'dan', 'tester'), 201);
  const ann = await login('ann');
  assert.equal((await ann.request(`/api/memberships/${dan.id}`, 'PATCH', { overrides: { 'run.start': false } })).status, 200);
  assert.equal((await ann.request(`/api/memberships/${dan.id}`, 'PATCH', { role: 'viewer', overrides: {} })).status, 200);
  assert.equal((await ann.request(`/api/memberships/${dan.id}`, 'PATCH', { expiresAt: soon(1800000) })).status, 200);   // sooner is also a reduction
  // raising it again is held to her own end date
  assert.equal((await ann.request(`/api/memberships/${dan.id}`, 'PATCH', { role: 'tester', expiresAt: null })).status, 403);
  assert.equal((await ann.request(`/api/memberships/${dan.id}`, 'PATCH', { role: 'tester' })).status, 200);   // still within her own end date
  assert.equal((await ann.request(`/api/memberships/${dan.id}`, 'PATCH', { expiresAt: soon(7200000) })).status, 403);
  // administrators: own auto-created lead entry, a team that is the only lead, its last member
  const own = ok(await admin.request('/api/modules/beta/members')).find(m => m.subject.name === 'Administrator');
  const team = ok(await admin.request('/api/teams', 'POST', { name: 'Beta leads' }), 201);
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.cat }), 201);
  ok(await admin.request('/api/modules/beta/members', 'POST', { subjectType: 'team', subjectId: team.id, role: 'lead' }), 201);
  ok(await admin.request(`/api/memberships/${own.id}`, 'DELETE'));
  ok(await admin.request(`/api/teams/${team.id}/members/${ids.cat}`, 'DELETE'));
  ok(await admin.request(`/api/teams/${team.id}`, 'DELETE'));
  assert.ok(ok(await admin.request('/api/audit?scopeType=module&scopeId=beta')).some(e => e.action === 'module.noLead'));
});

test('N9: only enabled members of a lead team count, and a direct grant that shadows the team does not', async t => {
  const { admin, ids, grant, grantTeam } = await world(t);
  const root = ok(await admin.request('/api/modules/alpha/members'))[0];
  const team = ok(await admin.request('/api/teams', 'POST', { name: 'Lead team' }), 201);
  ok(await admin.request(`/api/teams/${team.id}/members`, 'POST', { userId: ids.dan }), 201);
  ok(await grantTeam('module', 'alpha', team.id, 'lead'), 201);
  ok(await admin.request(`/api/memberships/${root.id}`, 'DELETE'));
  const header = async () => (await admin.request('/api/modules/alpha/members')).response.headers.get('x-no-lead');
  assert.equal(await header(), 'false');
  // a direct viewer entry replaces dan's team grant on this module, so the team no longer provides a lead
  const direct = ok(await grant('module', 'alpha', 'dan', 'viewer'), 201);
  assert.equal(await header(), 'true');
  ok(await admin.request(`/api/memberships/${direct.id}`, 'DELETE'));
  assert.equal(await header(), 'false');
  // disabling the team's only member leaves the module leaderless: flagged and audited
  ok(await admin.request(`/api/users/${ids.dan}`, 'PATCH', { disabled: true }));
  assert.equal(await header(), 'true');
  assert.ok(ok(await admin.request('/api/audit?scopeType=module&scopeId=alpha')).some(e => e.action === 'module.noLead' && e.detail.reason === 'account disabled'));
});

test('N10: reordering a case\'s input keys changes its content and needs a new approval', async t => {
  const { f, grant, login } = await world(t, { strict: true });
  for (const u of ['ben', 'cat', 'dan']) ok(await grant('module', 'registration', u, 'tester'), 201);
  const ben = await login('ben'), cat = await login('cat'), dan = await login('dan');
  const M = '/api/modules/registration';
  ok(await cat.request(`${M}/cases`, 'POST', auto('ZZ-020')), 201);
  ok(await dan.request(`${M}/cases/review`, 'POST', { ids: ['ZZ-020'], decision: 'approved' }));
  const c = f.store.case('registration', 'ZZ-020');
  const swapped = auto('ZZ-020', { input: { last_name: 'Beta', first_name: 'Alpha' }, version: c.version });
  const r = ok(await ben.request(`${M}/cases/ZZ-020`, 'PUT', swapped));
  assert.equal(r.reviewStatus, 'draft'); assert.equal(r.contentBy.user, 'ben');
  assert.deepEqual(Object.keys(f.store.case('registration', 'ZZ-020').input), ['last_name', 'first_name']);
});

const never = () => { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => { setImmediate(() => child.emit('exit', null)); return true; }; return child; };

test('audit gaps: reviews, case/module/run/intake/agent/environment/password changes are all recorded without secrets', async t => {
  const { f, admin, ids, pw, grant, login } = await world(t, { agentOptions: { spawn: never, probe: async id => ({ id, label: id, available: id === 'claude', version: '1' }) } });
  ok(await grant('module', 'alpha', 'ann', 'lead'), 201);
  const ann = await login('ann');
  const M = '/api/modules/alpha';
  // cases
  ok(await ann.request(`${M}/cases`, 'POST', manual('AL-001')), 201);
  ok(await ann.request(`${M}/cases`, 'POST', manual('AL-002')), 201);
  const cur = f.store.case('alpha', 'AL-001');
  ok(await ann.request(`${M}/cases/AL-001`, 'PUT', { ...manual('AL-001', { priority: 'P0' }), version: cur.version }));
  ok(await ann.request(`${M}/cases/AL-001`, 'PUT', { ...manual('AL-001', { title: 'New title' }), version: f.store.case('alpha', 'AL-001').version }));
  ok(await ann.request(`${M}/cases/bulk`, 'POST', { caseIds: ['AL-001', 'AL-002'], action: 'priority', value: 'P2' }));
  ok(await ann.request(`${M}/cases/review`, 'POST', { ids: ['AL-001'], decision: 'approved', note: 'secret reviewer note' }));
  ok(await ann.request(`${M}/import`, 'POST', { data: [manual('AL-003')] }), 201);
  ok(await ann.request(`${M}/cases/AL-003`, 'DELETE'));
  ok(await ann.request(`${M}/requirements`, 'PUT', { requirements: [{ id: 'R1', title: 'One' }], version: f.store.module('alpha').version }));
  ok(await ann.request(M, 'PUT', { name: 'Alpha renamed', area: 'A', version: f.store.module('alpha').version }));
  // runs
  const run = ok(await ann.request('/api/runs', 'POST', { moduleId: 'alpha', environmentId: 'local', mode: 'manual', caseIds: ['AL-002'], name: 'r' }), 201);
  ok(await ann.request(`/api/runs/${run.id}/results`, 'POST', { id: 'AL-002', status: 'FAIL', actual: 'broke' }));
  ok(await ann.request(`/api/runs/${run.id}/complete`, 'POST', {}));
  ok(await ann.request(`/api/runs/${run.id}/triage/AL-002`, 'PUT', { severity: 'High' }));
  ok(await ann.request(`/api/runs/${run.id}/report`, 'PUT', { title: 'Report' }));
  // intake and agent
  ok(await ann.request(`${M}/intake/files`, 'POST', Buffer.from('rules\n'), { 'x-file-name': 'r.txt', 'content-type': 'application/octet-stream' }), 201);
  const fileId = (await ann.request(`${M}/intake`)).value.files[0].id;
  await until(async () => (await ann.request(`${M}/intake`)).value.files[0].extract === 'ok');
  ok(await ann.request(`${M}/insights`, 'PUT', { summary: 'S', cases: [] }), 201);
  const job = ok(await ann.request(`${M}/agent/jobs`, 'POST', { agent: 'claude', kind: 'analyze', force: true }), 202);
  ok(await ann.request(`${M}/agent/jobs/${job.id}/cancel`, 'POST', {}));
  ok(await ann.request(`${M}/intake/files/${fileId}`, 'DELETE'));
  const seen = actions(f, 'module', 'alpha');
  for (const a of ['membership.add', 'case.create', 'case.update', 'case.bulk', 'case.review', 'case.import', 'case.delete', 'module.requirements', 'module.update', 'run.create', 'run.complete', 'run.triage', 'run.report',
    'intake.upload', 'intake.delete', 'insights.save', 'agent.start', 'agent.cancel']) assert.ok(seen.includes(a), a);
  const log = f.store.auditLog({ scopeType: 'module', scopeId: 'alpha' });
  assert.ok(log.some(e => e.action === 'membership.add' && e.detail.auto === true));
  assert.deepEqual(log.filter(e => e.action === 'case.update').map(e => e.detail.contentChanged).reverse(), [false, true]);
  const review = log.find(e => e.action === 'case.review'); assert.deepEqual([review.detail.decision, review.detail.noteGiven], ['approved', true]);
  assert.ok(!JSON.stringify(log).includes('secret reviewer note'));
  // environments: field names only
  const body = { id: 'ba-uat', name: 'BA UAT', url: 'https://uat.example.test', version: 0, credentials: { username: 'ba@example.test', password: 'fixture-only-password-42', tenant: 'Test tenant', facility: 'F', role: 'BA' } };
  const created = ok(await admin.request('/api/environments', 'POST', body), 201);
  ok(await admin.request('/api/environments', 'POST', { ...body, version: created.version, credentials: { ...body.credentials, tenant: 'Other tenant', password: 'another-secret-password-77' } }));
  ok(await admin.request('/api/environments/ba-uat/auth', 'POST', {}), 201);
  const product = f.store.auditLog({ scopeType: 'product', scopeId: 'augastam' });
  const update = product.find(e => e.action === 'environment.update');
  assert.deepEqual(update.detail.fieldsChanged.sort(), ['password', 'tenant']);
  assert.ok(product.some(e => e.action === 'environment.create') && product.some(e => e.action === 'environment.auth.refresh'));
  for (const secret of ['fixture-only-password-42', 'another-secret-password-77', 'Other tenant', 'ba@example.test']) assert.ok(!JSON.stringify(f.store.auditLog({})).includes(secret), secret);
  // accounts
  const dan = await login('dan');
  ok(await dan.request('/api/me/password', 'POST', { current: pw.dan, next: 'brand-new-secret-pass' }));
  ok(await admin.request(`/api/users/${ids.cat}`, 'PATCH', { displayName: 'Catherine' }));
  const platform = actions(f, 'platform', '');
  assert.ok(platform.includes('user.password.change') && platform.includes('user.displayName'));
  assert.ok(!JSON.stringify(f.store.auditLog({})).includes('brand-new-secret-pass'));
  // the audit table is indexed for the scope lookups
  const index = f.store.db.prepare(`SELECT sql FROM sqlite_master WHERE name='audit_scope_seq'`).get();
  assert.match(index.sql, /scope_type,scope_id,seq/);
});
