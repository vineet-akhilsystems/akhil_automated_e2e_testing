import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedIn, makeUser } from './support.mjs';

const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const manual = (id, extra = {}) => ({ id, title: `Case ${id}`, mode: 'manual', category: 'Gate', priority: 'P1', steps: [{ action: 'Do it', expected: 'It works' }], ...extra });
const status = async (p, route, method, body) => (await p.request(route, method, body)).status;
const M = '/api/modules/alpha';

// Delete rule: lead/admin delete anything in the module; a tester only what they created or uploaded; viewers and non-members nothing.
async function world(t) {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const ids = {}, clients = {};
  for (const name of ['lee', 'tia', 'tom', 'vic', 'nan']) {
    const u = await makeUser(admin, name, 'member'); ids[name] = u.id;
    clients[name] = { id: u.id, password: u.password };
  }
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Alpha', prefix: 'AL', area: 'A' })).status, 201);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Beta', prefix: 'BE', area: 'B' })).status, 201);
  for (const [name, role] of [['lee', 'lead'], ['tia', 'tester'], ['tom', 'tester'], ['vic', 'viewer']]) {
    assert.equal((await admin.request(`${M}/members`, 'POST', { subjectType: 'user', subjectId: ids[name], role })).status, 201);
  }
  const login = name => signedIn(f, name, clients[name].password);
  return { f, admin, login, lee: await login('lee'), tia: await login('tia'), tom: await login('tom'), vic: await login('vic'), nan: await login('nan') };
}
const create = async (p, id, extra) => assert.equal((await p.request(`${M}/cases`, 'POST', manual(id, extra))).status, 201);
const audited = (f, action) => f.store.auditLog({ scopeType: 'module', scopeId: 'alpha' }).filter(e => e.action === action);

test('single delete: tester own case only, lead any, viewer and non-member refused', async t => {
  const { f, admin, lee, tia, tom, vic, nan } = await world(t);
  await create(tia, 'AL-001'); await create(tom, 'AL-002');
  f.store.saveCase('alpha', manual('AL-900')); // seeded: no createdBy
  assert.equal(f.store.case('alpha', 'AL-900').createdBy, undefined);
  assert.equal(await status(tia, `${M}/cases/AL-002`, 'DELETE'), 403);
  assert.equal(await status(tia, `${M}/cases/AL-900`, 'DELETE'), 403);
  assert.equal(await status(vic, `${M}/cases/AL-001`, 'DELETE'), 403);
  assert.equal(await status(nan, `${M}/cases/AL-001`, 'DELETE'), 404);
  assert.ok(f.store.case('alpha', 'AL-001') && f.store.case('alpha', 'AL-002') && f.store.case('alpha', 'AL-900'));
  assert.equal(await status(tia, `${M}/cases/AL-001`, 'DELETE'), 200);
  assert.equal(f.store.case('alpha', 'AL-001'), undefined);
  const entry = audited(f, 'case.delete').find(e => e.detail.id === 'AL-001');
  assert.ok(entry);
  assert.equal(await status(lee, `${M}/cases/AL-002`, 'DELETE'), 200);
  assert.equal(await status(lee, `${M}/cases/AL-900`, 'DELETE'), 200);
  await create(tom, 'AL-003');
  assert.equal(await status(admin, `${M}/cases/AL-003`, 'DELETE'), 200);
  assert.equal(await status(tia, `${M}/cases/AL-404`, 'DELETE'), 404);
});

test('own case still cannot be deleted while another case depends on it (409)', async t => {
  const { f, tia } = await world(t);
  await create(tia, 'AL-010');
  await create(tia, 'AL-011', { title: 'Uses {{first@AL-010}}' });
  assert.equal(await status(tia, `${M}/cases/AL-010`, 'DELETE'), 409);
  assert.ok(f.store.case('alpha', 'AL-010'));
  assert.equal((await tia.request(`${M}/cases/bulk`, 'POST', { action: 'delete', caseIds: ['AL-010'] })).status, 409);
  assert.equal((await tia.request(`${M}/cases/bulk`, 'POST', { action: 'delete', caseIds: ['AL-010', 'AL-011'] })).status, 200);
  assert.equal(f.store.cases('alpha').length, 0);
});

test('bulk delete: tester own cases ok, a mixed selection is rejected whole, lead deletes any', async t => {
  const { f, lee, tia, tom, vic, nan } = await world(t);
  for (const id of ['AL-021', 'AL-022']) await create(tia, id);
  await create(tom, 'AL-023');
  f.store.saveCase('alpha', manual('AL-900'));
  const bulk = (p, caseIds) => p.request(`${M}/cases/bulk`, 'POST', { action: 'delete', caseIds });
  assert.equal((await bulk(tia, ['AL-021', 'AL-023'])).status, 403);
  assert.equal((await bulk(tia, ['AL-021', 'AL-900'])).status, 403);
  assert.equal(f.store.cases('alpha').length, 4);
  assert.equal((await bulk(vic, ['AL-021'])).status, 403);
  assert.equal((await bulk(nan, ['AL-021'])).status, 404);
  const own = await bulk(tia, ['AL-021', 'AL-022']);
  assert.equal(own.status, 200); assert.equal(own.value.updated, 2);
  assert.deepEqual(f.store.cases('alpha').map(c => c.id).sort(), ['AL-023', 'AL-900']);
  assert.ok(audited(f, 'case.bulk').some(e => e.detail.action === 'delete' && e.detail.count === 2));
  assert.equal((await bulk(lee, ['AL-023', 'AL-900'])).status, 200);
  assert.equal(f.store.cases('alpha').length, 0);
});

test('intake files: tester removes own upload only, lead removes any', async t => {
  const { lee, tia, tom, vic } = await world(t);
  const up = async (p, name) => { const r = await p.request(`${M}/intake/files`, 'POST', Buffer.from(`rules ${name}\n`), { 'x-file-name': name, 'content-type': 'application/octet-stream' }); assert.equal(r.status, 201, JSON.stringify(r.value)); };
  await up(tia, 'a.txt'); await up(tom, 'b.txt'); await up(tom, 'c.txt');
  const files = (await lee.request(`${M}/intake`)).value.files, idOf = n => files.find(f => f.name === n).id;
  assert.equal(await status(tia, `${M}/intake/files/${idOf('b.txt')}`, 'DELETE'), 403);
  assert.equal(await status(vic, `${M}/intake/files/${idOf('a.txt')}`, 'DELETE'), 403);
  assert.equal(await status(tia, `${M}/intake/files/${idOf('a.txt')}`, 'DELETE'), 200);
  assert.equal(await status(lee, `${M}/intake/files/${idOf('b.txt')}`, 'DELETE'), 200);
  assert.equal(await status(lee, `${M}/intake/files/${idOf('c.txt')}`, 'DELETE'), 200);
});

test('permission overrides: case.delete without case.edit keeps today\'s behavior; viewers stay refused', async t => {
  const { f, admin, login, tia } = await world(t);
  const mem = async (name, role, overrides) => (await admin.request(`${M}/members`, 'POST', { subjectType: 'user', subjectId: (await admin.request('/api/users')).value.find(u => u.username === name).id, role, overrides }));
  // lee is already a lead; replace with a membership whose Edit cases tick is off
  const users = (await admin.request('/api/users')).value, leeId = users.find(u => u.username === 'lee').id;
  const lee = (await admin.request(`${M}/members`)).value.find(m => m.subject.id === leeId);
  assert.equal((await admin.request(`/api/memberships/${lee.id}`, 'DELETE')).status, 200);
  assert.equal((await mem('lee', 'lead', { 'case.edit': false })).status, 201);
  assert.equal((await mem('nan', 'viewer', { 'case.delete': true })).status, 201);
  const leeC = await login('lee'), nanC = await login('nan'), vicC = await login('vic');
  await create(tia, 'AL-031'); await create(tia, 'AL-032'); await create(tia, 'AL-033', { title: 'Uses {{first@AL-032}}' });
  assert.equal(await status(leeC, `${M}/cases/AL-031`, 'DELETE'), 200);
  assert.equal(await status(leeC, `${M}/cases/AL-032`, 'DELETE'), 409);
  assert.equal(await status(leeC, `${M}/cases/AL-404`, 'DELETE'), 404);
  assert.equal(await status(nanC, `${M}/cases/AL-404`, 'DELETE'), 404);
  assert.equal(await status(nanC, `${M}/cases/AL-032`, 'DELETE'), 409);
  assert.equal(await status(nanC, `${M}/cases/AL-033`, 'DELETE'), 200);
  assert.equal(await status(vicC, `${M}/cases/AL-404`, 'DELETE'), 403);
  assert.equal(await status(vicC, `${M}/cases/AL-032`, 'DELETE'), 403);
  assert.equal(await status(tia, `${M}/cases/AL-404`, 'DELETE'), 404);
  assert.equal(await status(nanC, `${M}/cases/AL-032`, 'DELETE'), 200);
  assert.equal(f.store.cases('alpha').length, 0);
});
