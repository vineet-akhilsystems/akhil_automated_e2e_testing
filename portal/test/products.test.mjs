import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { boot, signedIn, makeUser } from './support.mjs';
import { openStore } from '../store.mjs';
import { environmentSettings } from '../environment-settings.mjs';

const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const manualCase = (id = 'CS-001') => ({ id, title: 'Create a record', mode: 'manual', category: 'General', priority: 'P1', input: {}, steps: [{ action: 'Do it.', expected: 'It works.' }] });
const credentials = { username: 'u', password: 'p', tenant: 't', facility: 'f', role: 'r' };
const mod = (name, productId, prefix = 'BIL') => ({ name, productId, prefix, area: 'Setup' });

test('seed products exist and listing carries counts', async t => {
  const f = await boot(t);
  const list = (await f.request('/api/products')).value;
  assert.deepEqual(list.map(p => [p.id, p.name, p.description]), [['augastam', 'Augastam', 'Augastam EMR'], ['miracle', 'Miracle', 'Miracle']]);
  const aug = list[0], mir = list[1];
  assert.deepEqual(Object.keys(aug).sort(), ['description', 'environmentCount', 'id', 'lastRunAt', 'moduleCount', 'name', 'runCount']);
  assert.equal(aug.moduleCount, 1); assert.equal(aug.environmentCount, 1); assert.equal(aug.runCount, 0); assert.equal(aug.lastRunAt, null);
  assert.deepEqual([mir.moduleCount, mir.environmentCount, mir.runCount], [0, 0, 0]);
});

test('seeding is idempotent across restarts and keeps added products', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-store-test-'));
  try {
    let s = openStore(dir); s.saveProduct({ id: 'extra', name: 'Extra' }); s.close();
    s = openStore(dir);
    assert.deepEqual(s.products().map(p => p.id), ['augastam', 'miracle', 'extra']);
    assert.equal(s.module('registration').productId, 'augastam');
    s.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('migration gives modules, runs and profiles without productId to augastam and keeps versions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-store-test-'));
  try {
    const db = new DatabaseSync(path.join(dir, 'portal.sqlite'));
    db.exec(`CREATE TABLE modules (id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE cases (module_id TEXT NOT NULL REFERENCES modules(id), id TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(module_id,id));
      CREATE TABLE runs (id TEXT PRIMARY KEY, document TEXT NOT NULL);`);
    const legacy = { id: 'legacy', name: 'Legacy', version: 7, config: { bases: {}, requirements: [] } };
    db.prepare('INSERT INTO modules VALUES (?,?)').run('legacy', JSON.stringify(legacy));
    db.prepare('INSERT INTO runs VALUES (?,?)').run('r1', JSON.stringify({ id: 'r1', module: legacy, status: 'passed', createdAt: 'x' }));
    db.close();
    let s = openStore(dir);
    assert.equal(s.module('legacy').productId, 'augastam'); assert.equal(s.module('legacy').version, 7);
    assert.equal(s.run('r1').productId, 'augastam'); assert.equal(s.run('r1').productName, 'Augastam');
    s.close();
    s = openStore(dir); // running it again changes nothing
    assert.equal(s.module('legacy').version, 7); assert.equal(s.modules().length, 1);
    s.close();

    const settings = environmentSettings(dir);
    settings.save({ id: 'old', name: 'Old', url: 'https://x.example.test', version: 0, credentials }, undefined);
    const file = path.join(dir, 'environment-settings.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(saved[0].productId, 'augastam');
    delete saved[0].productId; fs.writeFileSync(file, JSON.stringify(saved));
    assert.equal(settings.list()[0].productId, 'augastam');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Billing in both products gets distinct ids; Registration stays augastam-only', async t => {
  const f = await boot(t);
  const a = await f.request('/api/modules', 'POST', mod('Billing'));
  assert.equal(a.status, 201, JSON.stringify(a.value)); assert.equal(a.value.id, 'billing'); assert.equal(a.value.productId, 'augastam');
  const m = await f.request('/api/modules', 'POST', mod('Billing', 'miracle'));
  assert.equal(m.status, 201, JSON.stringify(m.value)); assert.equal(m.value.id, 'miracle-billing'); assert.equal(m.value.productId, 'miracle');
  assert.equal((await f.request('/api/modules', 'POST', mod('Billing', 'miracle'))).status, 409);
  assert.equal((await f.request('/api/modules', 'POST', mod('Billing'))).status, 409);
  assert.equal((await f.request('/api/modules', 'POST', mod('Ghost', 'nope'))).status, 404);
  const aug = (await f.request('/api/bootstrap?product=augastam')).value, mir = (await f.request('/api/bootstrap?product=miracle')).value;
  assert.deepEqual(aug.modules.map(x => x.id), ['registration', 'billing']);
  assert.deepEqual(mir.modules.map(x => x.id), ['miracle-billing']);
  const reg = aug.modules.find(x => x.id === 'registration');
  assert.equal(reg.productId, 'augastam'); assert.equal(reg.adapter, 'registration');
  assert.ok(reg.caseCount > 0);
  assert.ok(!mir.modules.some(x => x.id === 'registration'));
});

test('bootstrap filters by product and reports product and products', async t => {
  const f = await boot(t);
  const def = (await f.request('/api/bootstrap')).value;
  assert.equal(def.product.id, 'augastam'); assert.deepEqual(Object.keys(def.product).sort(), ['description', 'id', 'name']);
  assert.deepEqual(def.products.map(p => p.id), ['augastam', 'miracle']);
  assert.deepEqual(def.environments.map(e => [e.id, e.productId]), [['local', 'augastam']]);
  const mir0 = (await f.request('/api/bootstrap?product=miracle')).value;
  assert.deepEqual([mir0.product.id, mir0.modules.length, mir0.environments.length, mir0.runs.length], ['miracle', 0, 0, 0]);
  assert.equal((await f.request('/api/bootstrap?product=nope')).status, 404);

  const env = await f.request('/api/environments', 'POST', { id: 'miracle-uat', name: 'Miracle UAT', url: 'https://miracle.example.test', version: 0, credentials, productId: 'miracle' });
  assert.equal(env.status, 201, JSON.stringify(env.value)); assert.equal(env.value.productId, 'miracle');
  const m = (await f.request('/api/modules', 'POST', mod('Billing', 'miracle'))).value;
  assert.equal((await f.request(`/api/modules/${m.id}/cases`, 'POST', manualCase())).status, 201);
  const run = await f.request('/api/runs', 'POST', { name: 'Miracle run', moduleId: m.id, environmentId: 'miracle-uat', mode: 'manual', caseIds: ['CS-001'] });
  assert.equal(run.status, 201, JSON.stringify(run.value));
  assert.equal(run.value.productId, 'miracle'); assert.equal(run.value.productName, 'Miracle');

  const mir = (await f.request('/api/bootstrap?product=miracle')).value, aug = (await f.request('/api/bootstrap?product=augastam')).value;
  assert.deepEqual(mir.environments.map(e => e.id), ['miracle-uat']);
  assert.deepEqual(mir.runs.map(r => r.id), [run.value.id]);
  assert.deepEqual(aug.environments.map(e => e.id), ['local']); assert.deepEqual(aug.runs, []);
  assert.ok(!aug.modules.some(x => x.productId === 'miracle'));
  const p = mir.products.find(x => x.id === 'miracle');
  assert.deepEqual([p.moduleCount, p.runCount, p.environmentCount], [1, 1, 1]); assert.equal(p.lastRunAt, run.value.createdAt);
  assert.equal((await f.request('/api/runs?product=augastam')).value.length, 0);
});

test('a profile cannot run another product\'s module, in either direction', async t => {
  const f = await boot(t);
  await f.request('/api/environments', 'POST', { id: 'miracle-uat', name: 'Miracle UAT', url: 'https://miracle.example.test', version: 0, credentials, productId: 'miracle' });
  const m = (await f.request('/api/modules', 'POST', mod('Billing', 'miracle'))).value;
  const a = (await f.request('/api/modules', 'POST', mod('Billing'))).value;
  for (const id of [m.id, a.id]) await f.request(`/api/modules/${id}/cases`, 'POST', manualCase());
  const miracleOnAugastam = await f.request('/api/runs', 'POST', { name: 'x', moduleId: m.id, environmentId: 'local', mode: 'manual', caseIds: ['CS-001'] });
  assert.equal(miracleOnAugastam.status, 409); assert.match(miracleOnAugastam.value.error, /same product/);
  const augastamOnMiracle = await f.request('/api/runs', 'POST', { name: 'x', moduleId: a.id, environmentId: 'miracle-uat', mode: 'manual', caseIds: ['CS-001'] });
  assert.equal(augastamOnMiracle.status, 409);
  assert.equal((await f.request('/api/runs', 'POST', { name: 'ok', moduleId: a.id, environmentId: 'local', mode: 'manual', caseIds: ['CS-001'] })).status, 201);
  assert.equal((await f.request('/api/environments', 'POST', { id: 'bad', name: 'Bad', url: 'https://b.example.test', version: 0, credentials, productId: 'nope' })).status, 404);
  assert.equal((await f.request('/api/environments', 'POST', { id: 'miracle-uat', name: 'Miracle UAT', url: 'https://miracle.example.test', version: 1, credentials: { ...credentials, password: '' }, productId: 'augastam' })).status, 409);
});

test('application login refresh is only built for augastam profiles', async t => {
  const f = await boot(t);
  await f.request('/api/environments', 'POST', { id: 'miracle-uat', name: 'Miracle UAT', url: 'https://miracle.example.test', version: 0, credentials, productId: 'miracle' });
  const r = await f.request('/api/environments/miracle-uat/auth', 'POST', {});
  assert.equal(r.status, 409);
  assert.equal(r.value.error, 'Login automation for this product has not been built yet. Manual testing and intake work now; ask a developer to add the login adapter.');
});

test('only an administrator can create products; ids come from the name', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const tester = await makeUser(admin, 'tess', 'tester'), viewer = await makeUser(admin, 'vic', 'viewer');
  const t1 = await signedIn(f, 'tess', tester.password), v1 = await signedIn(f, 'vic', viewer.password);
  assert.equal((await t1.request('/api/products', 'POST', { name: 'Nope' })).status, 403);
  assert.equal((await v1.request('/api/products')).status, 200);
  assert.equal((await t1.request('/api/products')).status, 200);
  assert.equal((await f.client().request('/api/products')).status, 401);
  const created = await admin.request('/api/products', 'POST', { name: 'Health Hub', description: 'Hub' });
  assert.equal(created.status, 201); assert.deepEqual(created.value, { id: 'health-hub', name: 'Health Hub', description: 'Hub' });
  assert.equal((await admin.request('/api/products', 'POST', { name: 'health hub' })).status, 409);
  assert.equal((await admin.request('/api/products', 'POST', { name: 'Augastam' })).status, 409);
  assert.equal((await admin.request('/api/products', 'POST', { name: '123' })).status, 400);
  const m = await admin.request('/api/modules', 'POST', mod('Billing', 'health-hub'));
  assert.equal(m.value.id, 'health-hub-billing');
  assert.equal((await admin.request('/api/bootstrap?product=health-hub')).value.modules.length, 1);
});

test('module pack still downloads for a non-augastam module', async t => {
  const f = await boot(t);
  const m = (await f.request('/api/modules', 'POST', mod('Billing', 'miracle'))).value;
  const pack = await f.request(`/api/modules/${m.id}/pack?files=0`);
  assert.equal(pack.status, 200);
  assert.ok(Buffer.from(pack.value).includes(Buffer.from('manifest.json')));
});
