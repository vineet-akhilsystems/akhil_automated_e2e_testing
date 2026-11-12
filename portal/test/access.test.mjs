import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, PERMISSION_IDS, permissionsOf, effectiveModulePermissions as eff, effectiveProductPermissions as effP, roleList } from '../access.mjs';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const user = { id: 'u1', role: 'member' };
const M = { id: 'mod-a', productId: 'p1' };
const mem = (over) => ({ id: Math.random().toString(36).slice(2), subjectType: 'user', subjectId: 'u1', scopeType: 'module', scopeId: 'mod-a', role: 'viewer', overrides: {}, ...over });
const list = s => [...s].sort();

test('preset roles are cumulative bundles', () => {
  const p = id => new Set(ROLES[id].permissions);
  for (const [lower, higher] of [['viewer', 'ba'], ['ba', 'tester'], ['tester', 'lead'], ['lead', 'owner']]) {
    for (const perm of p(lower)) assert.ok(p(higher).has(perm), `${higher} includes ${lower}:${perm}`);
  }
  assert.deepEqual(list(p('viewer')), ['module.view', 'report.view']);
  assert.ok(!p('tester').has('case.delete') && p('lead').has('case.delete'));
  assert.ok(p('lead').has('members.manage') && !p('tester').has('members.manage'));
  assert.ok(p('owner').has('module.create') && !p('lead').has('module.create'));
  assert.ok(roleList().every(r => r.permissions.every(x => PERMISSION_IDS.includes(x))));
});

test('role matrix at module scope', () => {
  for (const role of ['viewer', 'ba', 'tester', 'lead']) {
    assert.deepEqual(list(eff(user, M, [mem({ role })], [], NOW)), list(ROLES[role].permissions), role);
  }
});

test('overrides add and remove single permissions', () => {
  const added = eff(user, M, [mem({ role: 'viewer', overrides: { 'run.start': true } })], [], NOW);
  assert.ok(added.has('run.start') && added.has('module.view') && !added.has('case.edit'));
  const removed = eff(user, M, [mem({ role: 'tester', overrides: { 'case.review': false } })], [], NOW);
  assert.ok(!removed.has('case.review') && removed.has('run.start'));
  // unknown permission ids are ignored
  assert.deepEqual(list(permissionsOf('viewer', { 'nope.nothing': true })), ['module.view', 'report.view']);
  // removing module.view hides everything
  assert.equal(eff(user, M, [mem({ role: 'tester', overrides: { 'module.view': false } })], [], NOW).size, 0);
});

test('direct membership beats team memberships at module scope', () => {
  const memberships = [mem({ role: 'viewer' }), mem({ subjectType: 'team', subjectId: 't1', role: 'lead' })];
  assert.deepEqual(list(eff(user, M, memberships, ['t1'], NOW)), list(ROLES.viewer.permissions));
  // direct override can remove what the team would grant
  const m2 = [mem({ role: 'viewer', overrides: { 'report.view': false } }), mem({ subjectType: 'team', subjectId: 't1', role: 'tester' })];
  assert.deepEqual(list(eff(user, M, m2, ['t1'], NOW)), ['module.view']);
});

test('union of several team memberships; teams the user is not in are ignored', () => {
  const memberships = [mem({ subjectType: 'team', subjectId: 't1', role: 'viewer' }), mem({ subjectType: 'team', subjectId: 't2', role: 'ba' }), mem({ subjectType: 'team', subjectId: 't3', role: 'lead' })];
  assert.deepEqual(list(eff(user, M, memberships, ['t1', 't2'], NOW)), list(ROLES.ba.permissions));
  assert.deepEqual(list(eff(user, M, memberships, [{ id: 't1' }, { id: 't3' }], NOW)), list(ROLES.lead.permissions));
  assert.equal(eff(user, M, memberships, [], NOW).size, 0);
});

test('product memberships inherit onto every module of that product only', () => {
  const owner = [mem({ scopeType: 'product', scopeId: 'p1', role: 'owner' })];
  const p = eff(user, M, owner, [], NOW);
  assert.ok(p.has('case.delete') && p.has('members.manage') && !p.has('module.create'), 'module result strips product-only ids');
  assert.deepEqual(list(effP(user, 'p1', owner, [], NOW)), list(ROLES.owner.permissions));
  assert.equal(eff(user, { id: 'mod-z', productId: 'p2' }, owner, [], NOW).size, 0);
  assert.equal(effP(user, 'p2', owner, [], NOW).size, 0);
  // product viewer + module tester = union
  const both = [mem({ scopeType: 'product', scopeId: 'p1', role: 'viewer' }), mem({ role: 'tester' })];
  assert.ok(eff(user, M, both, [], NOW).has('run.start'));
  assert.ok(!eff(user, { id: 'mod-b', productId: 'p1' }, both, [], NOW).has('run.start'));
  assert.ok(eff(user, { id: 'mod-b', productId: 'p1' }, both, [], NOW).has('module.view'));
  // product via team
  assert.ok(eff(user, M, [mem({ subjectType: 'team', subjectId: 't1', scopeType: 'product', scopeId: 'p1', role: 'ba' })], ['t1'], NOW).has('case.create'));
  // any product membership makes the product visible
  assert.ok(effP(user, 'p1', [mem({ scopeType: 'product', scopeId: 'p1', role: 'viewer' })], [], NOW).has('product.view'));
});

test('module membership does not leak to a sibling module', () => {
  const memberships = [mem({ role: 'lead' })];
  assert.equal(eff(user, { id: 'mod-b', productId: 'p1' }, memberships, [], NOW).size, 0);
  assert.equal(effP(user, 'p1', memberships, [], NOW).size, 0);
});

test('expired memberships are ignored; future ones count', () => {
  const past = mem({ role: 'lead', expiresAt: '2026-11-09T11:59:59Z' }), future = mem({ role: 'viewer', expiresAt: '2026-12-01T00:00:00Z' });
  assert.equal(eff(user, M, [past], [], NOW).size, 0);
  assert.deepEqual(list(eff(user, M, [past, future], [], NOW)), list(ROLES.viewer.permissions));
  assert.equal(effP(user, 'p1', [mem({ scopeType: 'product', scopeId: 'p1', role: 'owner', expiresAt: '2020-01-01T00:00:00Z' })], [], NOW).size, 0);
  // an expired direct membership no longer beats the team grant
  const m = [mem({ role: 'viewer', expiresAt: '2020-01-01T00:00:00Z' }), mem({ subjectType: 'team', subjectId: 't1', role: 'tester' })];
  assert.ok(eff(user, M, m, ['t1'], NOW).has('run.start'));
});

test('admin has everything; others without membership have nothing', () => {
  const admin = { id: 'a', role: 'admin' };
  assert.ok(eff(admin, M, [], [], NOW).has('case.delete'));
  assert.equal(eff(admin, M, [], [], NOW).has('module.create'), false);
  assert.ok(effP(admin, 'any', [], [], NOW).has('module.create'));
  assert.equal(eff(user, M, [], [], NOW).size, 0);
  assert.equal(effP(user, 'p1', [], [], NOW).size, 0);
  // memberships of someone else do nothing
  assert.equal(eff(user, M, [mem({ subjectId: 'other', role: 'lead' })], [], NOW).size, 0);
});

test('hidden means no module.view: a team grant without view gives nothing', () => {
  const m = [mem({ subjectType: 'team', subjectId: 't1', role: 'tester', overrides: { 'module.view': false } })];
  assert.equal(eff(user, M, m, ['t1'], NOW).size, 0);
});
