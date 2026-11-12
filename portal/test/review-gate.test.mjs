import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedIn, makeUser } from './support.mjs';

const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const manual = (id, extra = {}) => ({ id, title: `Case ${id}`, mode: 'manual', category: 'Gate', priority: 'P1', steps: [{ action: 'Do it', expected: 'It works' }], ...extra });

async function setup(t) {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const t1 = await makeUser(admin, 'tess', 'tester'), b1 = await makeUser(admin, 'bob', 'ba');
  const tester = await signedIn(f, 'tess', t1.password), ba = await signedIn(f, 'bob', b1.password);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Gate', prefix: 'GT', area: 'A' })).status, 201);
  return { f, admin, tester, ba };
}
const run = (c, caseIds, name = 'gate run') => c.request('/api/runs', 'POST', { moduleId: 'gate', environmentId: 'local', mode: 'manual', caseIds, name });

test('BA cases start as draft and cannot be run until a tester approves them', async t => {
  const { tester, ba } = await setup(t);
  const made = await ba.request('/api/modules/gate/cases', 'POST', manual('GT-001', { reviewStatus: 'approved' }));
  assert.equal(made.status, 201); assert.equal(made.value.reviewStatus, 'draft'); assert.equal(made.value.createdBy.user, 'bob');
  const blocked = await run(tester, ['GT-001']);
  assert.equal(blocked.status, 409); assert.match(blocked.value.error, /GT-001/);
  assert.equal((await ba.request('/api/modules/gate/cases/review', 'POST', { ids: ['GT-001'], decision: 'approved' })).status, 403);
  const rev = await tester.request('/api/modules/gate/cases/review', 'POST', { ids: ['GT-001'], decision: 'approved', note: 'looks right' });
  assert.deepEqual([rev.status, rev.value.updated], [200, 1]);
  const stored = (await tester.request('/api/modules/gate/cases')).value[0];
  assert.deepEqual([stored.reviewStatus, stored.reviewedBy.user, stored.reviewedBy.note, stored.reviewedBy.decision], ['approved', 'tess', 'looks right', 'approved']);
  const ok = await run(tester, ['GT-001']);
  assert.equal(ok.status, 201); assert.equal(ok.value.createdBy.user, 'tess');
});

test('rejected cases cannot run; editing an approved case as BA sends it back to draft; tester edits keep approval', async t => {
  const { tester, ba } = await setup(t);
  await tester.request('/api/modules/gate/cases', 'POST', manual('GT-001'));
  await tester.request('/api/modules/gate/cases', 'POST', manual('GT-002'));
  assert.equal((await tester.request('/api/modules/gate/cases')).value[0].reviewStatus, 'approved'); // reviewers' own cases are approved
  await tester.request('/api/modules/gate/cases/review', 'POST', { ids: ['GT-002'], decision: 'rejected' });
  assert.equal((await run(tester, ['GT-002'])).status, 409);
  const gt1 = (await tester.request('/api/modules/gate/cases')).value[0];
  const edited = await ba.request('/api/modules/gate/cases/GT-001', 'PUT', { ...gt1, title: 'Changed by BA', reviewStatus: 'approved' });
  assert.equal(edited.status, 200); assert.equal(edited.value.reviewStatus, 'draft');
  assert.equal((await run(tester, ['GT-001'])).status, 409);
  await tester.request('/api/modules/gate/cases/review', 'POST', { ids: ['GT-001'], decision: 'approved' });
  const again = (await tester.request('/api/modules/gate/cases')).value[0];
  const byTester = await tester.request('/api/modules/gate/cases/GT-001', 'PUT', { ...again, title: 'Tweaked by tester' });
  assert.equal(byTester.value.reviewStatus, 'approved');
  assert.equal((await tester.request('/api/modules/gate/cases/review', 'POST', { ids: ['NOPE'], decision: 'approved' })).status, 404);
  assert.equal((await tester.request('/api/modules/gate/cases/review', 'POST', { ids: ['GT-001'], decision: 'maybe' })).status, 400);
});

test('legacy cases without reviewStatus run as approved; dependencies must be approved too', async t => {
  const { f, tester, ba } = await setup(t);
  f.store.saveCase('gate', manual('GT-010')); // stored the way pre-feature cases were
  assert.equal(f.store.case('gate', 'GT-010').reviewStatus, undefined);
  assert.equal((await run(tester, ['GT-010'])).status, 201);
  // a draft prerequisite blocks an otherwise approved dependent case
  await ba.request('/api/modules/gate/cases', 'POST', manual('GT-011'));
  await tester.request('/api/modules/gate/cases', 'POST', manual('GT-012', { notes: 'uses {{id@GT-011}}' }));
  const r = await run(tester, ['GT-012']);
  assert.equal(r.status, 409); assert.match(r.value.error, /GT-011/);
});

test('bulk review and admin-only deletion', async t => {
  const { admin, tester, ba } = await setup(t);
  for (const id of ['GT-001', 'GT-002', 'GT-003']) await ba.request('/api/modules/gate/cases', 'POST', manual(id));
  assert.equal((await tester.request('/api/modules/gate/cases/review', 'POST', { ids: ['GT-001', 'GT-002', 'GT-003'], decision: 'approved' })).value.updated, 3);
  assert.equal((await tester.request('/api/modules/gate/cases/GT-003', 'DELETE')).status, 403);
  assert.equal((await tester.request('/api/modules/gate/cases/bulk', 'POST', { caseIds: ['GT-003'], action: 'delete' })).status, 403);
  assert.equal((await admin.request('/api/modules/gate/cases/GT-003', 'DELETE')).status, 200);
  const boot = (await tester.request('/api/bootstrap')).value;
  assert.equal(boot.modules.find(m => m.id === 'gate').draftCount, 0);
});

test('re-run failures creates a new run with only the failed cases', async t => {
  const { f, tester } = await setup(t);
  await tester.request('/api/modules/gate/cases', 'POST', manual('GT-001'));
  await tester.request('/api/modules/gate/cases', 'POST', manual('GT-002'));
  const created = (await run(tester, ['GT-001', 'GT-002'], 'first')).value;
  assert.equal((await tester.request(`/api/runs/${created.id}/rerun-failures`, 'POST')).status, 409); // still open
  await tester.request(`/api/runs/${created.id}/results`, 'POST', { id: 'GT-001', status: 'PASS', actual: 'fine' });
  await tester.request(`/api/runs/${created.id}/results`, 'POST', { id: 'GT-002', status: 'FAIL', actual: 'broken' });
  assert.equal((await tester.request(`/api/runs/${created.id}/complete`, 'POST')).status, 200);
  const re = await tester.request(`/api/runs/${created.id}/rerun-failures`, 'POST');
  assert.equal(re.status, 201); assert.equal(re.value.total, 1); assert.equal(re.value.rerunOf, created.id);
  assert.deepEqual(f.store.run(re.value.id).cases.map(c => c.id), ['GT-002']);
  const clean = (await run(tester, ['GT-001'], 'clean')).value;
  await tester.request(`/api/runs/${clean.id}/results`, 'POST', { id: 'GT-001', status: 'PASS', actual: 'ok' });
  await tester.request(`/api/runs/${clean.id}/complete`, 'POST');
  assert.equal((await tester.request(`/api/runs/${clean.id}/rerun-failures`, 'POST')).status, 409); // nothing failed
});
