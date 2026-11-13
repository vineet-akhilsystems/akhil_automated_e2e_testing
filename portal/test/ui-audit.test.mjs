import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedIn } from './support.mjs';

// Rules added after the UI audit: things that used to succeed silently and were wrong.
const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const creds = { username: 'u', password: 'p', tenant: 't', facility: 'f', role: 'r' };

test('a case prefix is unique inside a product, but another product may reuse it', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Fin' })).status, 201);
  const clash = await admin.request('/api/modules', 'POST', { name: 'Billing two', prefix: 'bil', area: 'Fin' });
  assert.equal(clash.status, 409); assert.match(clash.value.error, /prefix BIL is already used by Billing/);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Fin', productId: 'miracle' })).status, 201, 'a different product is a different numbering space');
});

test('adding a login profile never overwrites one that already has that ID', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const make = (extra = {}) => admin.request('/api/environments', 'POST', { id: 'qa-one', name: 'QA one', url: 'https://qa.example.test', version: 0, credentials: creds, productId: 'augastam', create: true, ...extra });
  assert.equal((await make()).status, 201);
  const again = await make({ name: 'Someone else', url: 'https://other.example.test' });
  assert.equal(again.status, 409); assert.match(again.value.error, /already exists/);
  // an edit (no create flag) is still allowed
  const edit = await admin.request('/api/environments', 'POST', { id: 'qa-one', name: 'QA renamed', url: 'https://qa.example.test', version: 1, credentials: { ...creds, password: '' }, productId: 'augastam' });
  assert.equal(edit.status, 200); assert.equal(edit.value.name, 'QA renamed');
  // a blank field is named the way the form names it
  const blank = await admin.request('/api/environments', 'POST', { id: 'qa-two', name: 'Two', url: 'https://two.example.test', version: 0, credentials: { ...creds, tenant: '  ' }, productId: 'augastam', create: true });
  assert.equal(blank.status, 400); assert.equal(blank.value.error, 'Enter the tenant.');
});

test('a new shared data template cannot replace an existing one; editing still can', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Reg', prefix: 'RGT', area: 'Front', adapter: 'registration' })).status, 201);
  const put = async (extra = {}) => { const m = (await admin.request('/api/modules/reg')).value ?? f.store.module('reg'); return admin.request('/api/modules/reg/templates', 'PUT', { name: 'my-tpl', input: {}, version: f.store.module('reg').version, ...extra }); };
  assert.equal((await put({ create: true })).status, 200);
  const dup = await put({ create: true }); assert.equal(dup.status, 409); assert.match(dup.value.error, /already exists/);
  assert.equal((await put()).status, 200, 'an edit (no create flag) is allowed');
});

test('a blank display name falls back to the username', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const made = await admin.request('/api/users', 'POST', { username: 'sam', password: 'a-long-password-1', role: 'member', displayName: '   ' });
  assert.equal(made.status, 201); assert.equal(made.value.displayName, 'sam');
});
