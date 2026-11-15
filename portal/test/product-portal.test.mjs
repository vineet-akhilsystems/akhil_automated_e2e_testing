import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { boot, signedIn } from './support.mjs';
import { createQueue } from '../queue.mjs';
import { instructions } from '../agent.mjs';

// Task 2 review: a non-Augastam module through the callers that only know a module id, reserved products, and folder clashes.
const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const tmp = (t, prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const put = (root, rel, text) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
async function world(t, extra = {}) {
  const f = await boot(t, { bootstrap: ADMIN, ...extra });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  return { f, admin };
}
const newModule = (admin, name, productId, prefix = 'BIL') => admin.request('/api/modules', 'POST', { name, productId, prefix, area: 'Setup' });

test('POST /api/products rejects names reserved for shared folders', async t => {
  const { admin } = await world(t);
  for (const name of ['Tools', 'Knowledge', 'Shared', 'Fixtures', 'Discovery', 'Smoke']) {
    const r = await admin.request('/api/products', 'POST', { name });
    assert.equal(r.status, 400, name); assert.match(r.value.error, /reserved for shared folders/, name);
  }
  assert.equal((await admin.request('/api/products', 'POST', { name: 'Medlab' })).status, 201);
});

test('readiness for a stored module whose product is reserved is a plain 409, not a 500', async t => {
  const { f, admin } = await world(t);
  f.store.saveProduct({ id: 'tools', name: 'Tools' });
  f.store.saveModule({ id: 'tools-billing', productId: 'tools', name: 'Billing', area: 'Setup', prefix: 'TB', adapter: null, config: { bases: {}, requirements: [] } });
  const r = await admin.request('/api/modules/tools-billing/readiness');
  assert.equal(r.status, 409); assert.match(r.value.error, /cannot be located.*reserved/);
});

test('module creation is blocked when two ids would share one folder in a product', async t => {
  const { admin } = await world(t);
  assert.equal((await newModule(admin, 'Bar', 'augastam', 'BAR')).status, 201);
  const clash = await newModule(admin, 'Augastam Bar', 'augastam', 'ABR');
  assert.equal(clash.status, 409); assert.match(clash.value.error, /folder "bar" is already used by module "Bar"/);
  // the same name in another product is a different folder
  assert.equal((await newModule(admin, 'Bar', 'miracle', 'MBR')).status, 201);
});

test('readiness, tree and automation-version routes use the module product (miracle) for folders', async t => {
  const layoutRoot = tmp(t, 'prod-layout-root-'), automationRoot = tmp(t, 'prod-auto-root-');
  const seen = [];
  const { admin } = await world(t, { layoutRoot, automationRoot, automationFingerprint: (root, productId, dir) => { seen.push([productId, dir]); return { hash: 'a'.repeat(64), files: [], truncated: false }; }, automationGit: async () => ({}) });
  assert.equal((await newModule(admin, 'Billing', 'miracle')).status, 201); // id miracle-billing, folder billing
  // readiness resolves the miracle folder without throwing (miracle has no login automation yet, so discovery is reported as blocked)
  const ready = await admin.request('/api/modules/miracle-billing/readiness');
  assert.equal(ready.status, 200); assert.equal(ready.value.stages.find(x => x.id === 'discovery').status, 'blocked');
  // tree route reads qa/miracle/billing/tree.json under the automation root
  assert.equal((await admin.request('/api/modules/miracle-billing/tree')).status, 404);
  put(automationRoot, 'qa/miracle/billing/tree.json', JSON.stringify({ module: 'miracle-billing', version: 1, nodes: [{ id: 'root', name: 'Root', kind: 'root' }] }));
  const tree = await admin.request('/api/modules/miracle-billing/tree');
  assert.equal(tree.status, 200); assert.equal(tree.value.file, 'qa/miracle/billing/tree.json');
  // automation versions: the fingerprint is taken for (miracle, miracle-billing)
  assert.equal((await admin.request('/api/modules/miracle-billing/automation-versions')).status, 200);
  assert.ok(seen.length > 0 && seen.every(([p, d]) => p === 'miracle' && d === 'miracle-billing'), JSON.stringify(seen));
});

test('the agent brief names the product-scoped spec and qa folders of a miracle module', () => {
  const brief = instructions({ kind: 'automation', module: { id: 'miracle-billing', productId: 'miracle', name: 'Billing', area: 'Fin', config: {} }, hasAdapterSchema: false });
  assert.ok(brief.includes('tests/miracle/billing/cases.spec.ts'));
  assert.ok(brief.includes('qa/miracle/billing/adapter.json'));
  assert.ok(!brief.includes('tests/modules/') && !brief.includes('tests/augastam/'));
});

test('the queue passes the run product to Playwright as PORTAL_PRODUCT_ID', async t => {
  const dir = tmp(t, 'queue-product-');
  const runs = new Map(), launches = [];
  const store = { runs: () => [...runs.values()], run: id => runs.get(id), saveRun: r => { runs.set(r.id, structuredClone(r)); } };
  const launch = (command, args, opts) => { const child = new EventEmitter(); child.stdout = null; child.pid = 0; launches.push({ args, opts, child }); return child; };
  const queue = createQueue(store, dir, [{ id: 'e', url: 'http://x.invalid', authDir: path.join(dir, 'auth') }], launch, null, () => null, { staggerMs: 5, workers: 1 });
  const run = { id: 'run-miracle', environmentId: 'e', kind: 'tests', mode: 'automated', status: 'queued', productId: 'miracle',
    module: { id: 'miracle-billing', productId: 'miracle', adapter: 'registration', config: {} }, cases: [{ id: 'A', title: 'A' }], results: [] };
  store.saveRun(run); queue.pump(); await new Promise(r => setTimeout(r, 30));
  assert.equal(launches.length, 1);
  assert.equal(launches[0].opts.env.PORTAL_PRODUCT_ID, 'miracle'); assert.equal(launches[0].opts.env.PORTAL_MODULE_ID, 'miracle-billing');
  launches[0].child.emit('exit', 0);
});
