import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedIn, makeUser } from './support.mjs';
import { hashPassword, verifyPassword } from '../users.mjs';

const ADMIN = { username: 'root', password: 'correct-horse-battery' };

test('scrypt hashes verify, salt per hash, and never store plaintext', () => {
  const a = hashPassword('s3cret-pass'), b = hashPassword('s3cret-pass');
  assert.match(a, /^scrypt\$/); assert.notEqual(a, b); assert.ok(!a.includes('s3cret-pass'));
  assert.ok(verifyPassword('s3cret-pass', a)); assert.ok(!verifyPassword('wrong', a)); assert.ok(!verifyPassword('x', 'garbage'));
});

test('bootstrap admin from options, login, roles and permission enforcement', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const anon = f.client();
  assert.equal((await anon.request('/api/bootstrap')).status, 401);
  const session = (await anon.request('/api/session')).value;
  assert.deepEqual([session.authenticated, session.authRequired, session.mode], [false, true, 'users']);
  assert.equal((await anon.login('root', 'nope')).status, 401);
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const me = (await admin.request('/api/session')).value;
  assert.equal(me.user.role, 'admin'); assert.ok(!JSON.stringify(me).includes('passwordHash'));
  const tester = await makeUser(admin, 'tess', 'tester'), ba = await makeUser(admin, 'bob', 'ba'), viewer = await makeUser(admin, 'vic', 'viewer');
  assert.ok(!JSON.stringify((await admin.request('/api/users')).value).includes('passwordHash'));
  assert.equal((await admin.request('/api/users', 'POST', { username: 'tess', password: 'password-x1', role: 'ba' })).status, 409);
  assert.equal((await admin.request('/api/users', 'POST', { username: 'zed', password: 'short', role: 'ba' })).status, 400);
  assert.equal((await admin.request('/api/users', 'POST', { username: 'zed', password: 'long-enough-1', role: 'god' })).status, 400);

  const v = await signedIn(f, 'vic', viewer.password), b = await signedIn(f, 'bob', ba.password), s = await signedIn(f, 'tess', tester.password);
  assert.equal((await v.request('/api/bootstrap')).status, 200);
  assert.equal((await v.request('/api/users')).status, 403);
  assert.equal((await v.request('/api/modules', 'POST', { name: 'X Mod', prefix: 'XM' })).status, 403);
  assert.equal((await b.request('/api/modules', 'POST', { name: 'X Mod', prefix: 'XM', area: 'A' })).status, 403); // ba lacks module.create
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'X Mod', prefix: 'XM', area: 'A' })).status, 201);
  assert.equal((await b.request('/api/environments', 'POST', {})).status, 403);
  assert.equal((await b.request('/api/runs', 'POST', { moduleId: 'registration', environmentId: 'local', mode: 'manual', caseIds: ['X'], name: 'n' })).status, 403); // ba lacks run.start
  assert.equal((await b.request('/api/runs', 'POST', {})).status, 400);
  assert.equal((await s.request('/api/users')).status, 403);
  assert.equal((await s.request('/api/runs', 'POST', {})).status, 400); // allowed through to validation
});

test('admin manages users: disable ends sessions, last admin protected, password change', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const u = await makeUser(admin, 'dana', 'tester');
  const dana = await signedIn(f, 'dana', u.password);
  assert.equal((await dana.request('/api/bootstrap')).status, 200);
  assert.equal((await admin.request(`/api/users/${u.id}`, 'PATCH', { disabled: true })).status, 200);
  assert.equal((await dana.request('/api/bootstrap')).status, 401);
  assert.equal((await f.client().login('dana', u.password)).status, 401);
  await admin.request(`/api/users/${u.id}`, 'PATCH', { disabled: false, role: 'viewer' });
  const again = await signedIn(f, 'dana', u.password);
  assert.equal((await again.request('/api/session')).value.user.role, 'viewer');
  assert.equal((await again.request('/api/me/password', 'POST', { current: 'bad', next: 'brand-new-pass' })).status, 403);
  assert.equal((await again.request('/api/me/password', 'POST', { current: u.password, next: 'brand-new-pass' })).status, 200);
  assert.equal((await f.client().login('dana', u.password)).status, 401);
  assert.equal((await f.client().login('dana', 'brand-new-pass')).status, 200);
  const me = (await admin.request('/api/session')).value.user;
  assert.equal((await admin.request(`/api/users/${me.id}`, 'PATCH', { role: 'viewer' })).status, 409);
  assert.equal((await admin.request(`/api/users/${me.id}`, 'DELETE')).status, 409);
  assert.equal((await admin.request(`/api/users/${u.id}`, 'DELETE')).status, 200);
});

test('generated bootstrap password is logged once; token mode still works while no users exist', async t => {
  const lines = [];
  // The machine's .env may define PORTAL_ADMIN_*; this test is about the no-env path.
  const saved = [process.env.PORTAL_ADMIN_USER, process.env.PORTAL_ADMIN_PASSWORD];
  delete process.env.PORTAL_ADMIN_USER; delete process.env.PORTAL_ADMIN_PASSWORD;
  t.after(() => { if (saved[0] !== undefined) process.env.PORTAL_ADMIN_USER = saved[0]; if (saved[1] !== undefined) process.env.PORTAL_ADMIN_PASSWORD = saved[1]; });
  const g = await boot(t, { bootstrap: true, logger: l => lines.push(l) });
  const line = lines.find(l => l.includes('one-time password')); assert.ok(line);
  const password = /password: (\S+)/.exec(line)[1];
  const c = await signedIn(g, 'admin', password);
  assert.equal((await c.request('/api/session')).value.mustChangePassword, true);

  const tk = await boot(t, { token: 'a-test-access-key-of-sufficient-length' });
  const anon = tk.client();
  assert.equal((await anon.request('/api/bootstrap')).status, 401);
  assert.equal((await anon.request('/api/login', 'POST', { token: 'wrong' })).status, 401);
  assert.equal((await anon.request('/api/login', 'POST', { token: 'a-test-access-key-of-sufficient-length' })).status, 200);
  const s = (await anon.request('/api/session')).value;
  assert.equal(s.mode, 'token'); assert.equal(s.user.role, 'admin');
  // creating the first user switches the portal to account mode
  assert.equal((await anon.request('/api/users', 'POST', { username: 'amy', password: 'password-amy1', role: 'admin' })).status, 201);
  assert.equal((await anon.request('/api/bootstrap')).status, 401);
  assert.equal((await tk.client().login('amy', 'password-amy1')).status, 200);
});

test('health endpoint needs no login', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const r = await f.client().request('/api/health');
  assert.equal(r.status, 200); assert.equal(r.value.status, 'ok');
});
