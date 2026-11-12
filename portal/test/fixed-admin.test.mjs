import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPortal } from '../server.mjs';

// A real server start (bootstrap: true) reads PORTAL_ADMIN_USER / PORTAL_ADMIN_PASSWORD and keeps that
// administrator fixed: restored on every start, and not changeable through the UI/API.
async function start(dir, t) {
  const p = createPortal({ dataDir: dir, bootstrap: true, environments: [{ id: 'local', name: 'Local', url: 'http://application.invalid', authDir: path.join(dir, 'auth') }] });
  await new Promise(resolve => p.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${p.server.address().port}`;
  let cookie = '';
  const request = async (route, method = 'GET', body) => {
    const r = await fetch(base + route, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, value: await r.json().catch(() => null) };
  };
  return { p, request, login: (u, pw) => request('/api/login', 'POST', { username: u, password: pw }) };
}

test('fixed administrator: created from settings, protected, and restored or renamed on every start', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-fixed-admin-'));
  const saved = [process.env.PORTAL_ADMIN_USER, process.env.PORTAL_ADMIN_PASSWORD];
  t.after(() => {
    for (const [k, v] of [['PORTAL_ADMIN_USER', saved[0]], ['PORTAL_ADMIN_PASSWORD', saved[1]]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  process.env.PORTAL_ADMIN_USER = 'akhil'; process.env.PORTAL_ADMIN_PASSWORD = 'Fixed-Pass-123';

  let s = await start(dir, t);
  assert.equal((await s.login('akhil', 'Fixed-Pass-123')).status, 200);
  const me = (await s.request('/api/session')).value.user;
  assert.equal(me.role, 'admin');

  // The account cannot be changed from inside the app.
  assert.equal((await s.request('/api/me/password', 'POST', { current: 'Fixed-Pass-123', next: 'Something-else-9' })).status, 409);
  assert.equal((await s.request(`/api/users/${me.id}`, 'PATCH', { disabled: true })).status, 409);
  assert.equal((await s.request(`/api/users/${me.id}`, 'PATCH', { role: 'member' })).status, 409);
  assert.equal((await s.request(`/api/users/${me.id}`, 'PATCH', { password: 'Another-pass-77' })).status, 409);
  assert.equal((await s.request(`/api/users/${me.id}`, 'DELETE')).status, 409);
  assert.equal((await s.login('akhil', 'Fixed-Pass-123')).status, 200, 'still signs in after the refused changes');

  // Display name edits stay allowed.
  assert.equal((await s.request(`/api/users/${me.id}`, 'PATCH', { displayName: 'Akhil Systems Admin' })).status, 200);
  await s.p.close();

  // Restart with the same settings: nothing changes, one account.
  s = await start(dir, t);
  assert.equal((await s.login('akhil', 'Fixed-Pass-123')).status, 200);
  assert.equal((await s.request('/api/users')).value.length, 1);
  await s.p.close();

  // Change the settings and restart: the SAME account is renamed and gets the new password.
  process.env.PORTAL_ADMIN_USER = 'akhil-systems'; process.env.PORTAL_ADMIN_PASSWORD = 'New-Fixed-Pass-456';
  s = await start(dir, t);
  assert.equal((await s.login('akhil', 'Fixed-Pass-123')).status, 401);
  assert.equal((await s.login('akhil-systems', 'Fixed-Pass-123')).status, 401);
  const again = await s.login('akhil-systems', 'New-Fixed-Pass-456');
  assert.equal(again.status, 200);
  const users = (await s.request('/api/users')).value;
  assert.equal(users.length, 1, 'renamed in place, not duplicated');
  assert.equal(users[0].id, me.id);
  await s.p.close();
});

test('an invalid fixed-admin password does not stop an existing portal from starting', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-fixed-admin-bad-'));
  const saved = [process.env.PORTAL_ADMIN_USER, process.env.PORTAL_ADMIN_PASSWORD];
  t.after(() => {
    for (const [k, v] of [['PORTAL_ADMIN_USER', saved[0]], ['PORTAL_ADMIN_PASSWORD', saved[1]]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  process.env.PORTAL_ADMIN_USER = 'akhil'; process.env.PORTAL_ADMIN_PASSWORD = 'Fixed-Pass-123';
  let s = await start(dir, t); await s.p.close();
  process.env.PORTAL_ADMIN_PASSWORD = 'short'; // below the 8 character minimum
  s = await start(dir, t);
  assert.equal((await s.login('akhil', 'Fixed-Pass-123')).status, 200, 'the previous fixed login keeps working');
  await s.p.close();
});

test('fixed tester: an existing "tester" account gets the admin password on every start and is protected', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-fixed-tester-'));
  const keys = ['PORTAL_ADMIN_USER', 'PORTAL_ADMIN_PASSWORD', 'PORTAL_TESTER_USER', 'PORTAL_TESTER_PASSWORD'];
  const saved = keys.map(k => process.env[k]);
  t.after(() => { keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }); fs.rmSync(dir, { recursive: true, force: true }); });
  process.env.PORTAL_ADMIN_USER = 'admin'; process.env.PORTAL_ADMIN_PASSWORD = 'Fixed-Pass-123';
  delete process.env.PORTAL_TESTER_USER; delete process.env.PORTAL_TESTER_PASSWORD;

  // First start: no tester configured or present, so none is created.
  let s = await start(dir, t);
  assert.equal((await s.login('admin', 'Fixed-Pass-123')).status, 200);
  assert.equal((await s.request('/api/users')).value.length, 1);
  // An ordinary tester account (BA role) created the normal way, with its own password.
  const created = await s.request('/api/users', 'POST', { username: 'tester', password: 'Own-Password-9', role: 'ba' });
  assert.equal(created.status, 201);
  await s.p.close();

  // Restart: the existing tester becomes fixed to the admin password and keeps its BA role.
  s = await start(dir, t);
  assert.equal((await s.login('tester', 'Own-Password-9')).status, 401, 'old own password no longer works');
  const login = await s.login('tester', 'Fixed-Pass-123');
  assert.equal(login.status, 200, 'tester signs in with the admin password');
  const me = (await s.request('/api/session')).value.user;
  assert.equal(me.role, 'ba');
  assert.equal((await s.request('/api/me/password', 'POST', { current: 'Fixed-Pass-123', next: 'Something-else-9' })).status, 409);
  await s.p.close();

  // A separate tester password and username can be configured.
  process.env.PORTAL_TESTER_USER = 'qa-tester'; process.env.PORTAL_TESTER_PASSWORD = 'Tester-Pass-456';
  s = await start(dir, t);
  assert.equal((await s.login('tester', 'Fixed-Pass-123')).status, 401);
  assert.equal((await s.login('qa-tester', 'Tester-Pass-456')).status, 200, 'same account renamed with its own password');
  assert.equal((await s.login('admin', 'Fixed-Pass-123')).status, 200, 'admin unaffected');
  await s.p.close();
});

test('fixed accounts heal at sign-in when the stored password drifted, and a wrong password is still refused', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const { hashPassword } = await import('../users.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-fixed-heal-'));
  const keys = ['PORTAL_ADMIN_USER', 'PORTAL_ADMIN_PASSWORD', 'PORTAL_TESTER_USER', 'PORTAL_TESTER_PASSWORD'];
  const saved = keys.map(k => process.env[k]);
  t.after(() => { keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }); fs.rmSync(dir, { recursive: true, force: true }); });
  process.env.PORTAL_ADMIN_USER = 'admin'; process.env.PORTAL_ADMIN_PASSWORD = 'Fixed-Pass-123';
  delete process.env.PORTAL_TESTER_USER; delete process.env.PORTAL_TESTER_PASSWORD;

  const s = await start(dir, t);
  assert.equal((await s.login('admin', 'Fixed-Pass-123')).status, 200);
  // Simulate drift: something rewrites the stored hash behind the portal's back.
  const db = new DatabaseSync(path.join(dir, 'portal.sqlite'));
  const row = db.prepare('SELECT id, document FROM users WHERE username = ?').get('admin');
  db.prepare('UPDATE users SET document = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(row.document), passwordHash: hashPassword('Something-Else-999') }), row.id);
  db.close();

  assert.equal((await s.login('admin', 'Wrong-Password-1')).status, 401, 'a wrong password is still refused');
  assert.equal((await s.login('admin', 'Fixed-Pass-123')).status, 200, 'the configured password works again without a restart');
  await s.p.close();
});
