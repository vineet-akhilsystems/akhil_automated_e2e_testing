import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './support.mjs';
import { normalizeAppVersion, describeVersion } from '../versioning.mjs';
import { describeVersion as clientDescribe } from '../public/components/version.js';

const credentials = { username: 'u', password: 'p', tenant: 't', facility: 'f', role: 'r' };
const profile = (extra = {}) => ({ id: 'ba-uat', name: 'BA UAT', url: 'https://uat.example.test', version: 0, credentials, ...extra });
const manualCase = { id: 'FAC-001', title: 'Create a facility', mode: 'manual', category: 'Facility', priority: 'P1', input: {}, steps: [{ action: 'Do it.', expected: 'It works.' }] };

test('normalizeAppVersion trims, accepts 1.58 and 2.0.66+hotfix, rejects <script> and 41 characters', () => {
  assert.equal(normalizeAppVersion('  1.58 '), '1.58');
  assert.equal(normalizeAppVersion('2.0.66+hotfix'), '2.0.66+hotfix');
  assert.equal(normalizeAppVersion('release_2/b-3'), 'release_2/b-3');
  for (const empty of [undefined, null, '', '   ']) assert.equal(normalizeAppVersion(empty), '');
  assert.throws(() => normalizeAppVersion('<script>'), e => e.status === 400);
  assert.throws(() => normalizeAppVersion('1'.repeat(41)), e => e.status === 400);
  assert.equal(normalizeAppVersion('1'.repeat(40)).length, 40);
  assert.throws(() => normalizeAppVersion(158), e => e.status === 400);
});

test('a login profile saves and returns its appVersion', async t => {
  const f = await boot(t);
  const created = await f.request('/api/environments', 'POST', profile({ appVersion: ' 1.58 ' }));
  assert.equal(created.status, 201); assert.equal(created.value.appVersion, '1.58');
  const edited = await f.request('/api/environments', 'POST', profile({ version: 1, name: 'BA UAT 2', credentials: { ...credentials, password: '' } }));
  assert.equal(edited.status, 200); assert.equal(edited.value.appVersion, '1.58', 'omitting appVersion keeps it');
  const cleared = await f.request('/api/environments', 'POST', profile({ version: 2, appVersion: '', credentials: { ...credentials, password: '' } }));
  assert.equal(cleared.value.appVersion, '');
  assert.equal((await f.request('/api/environments', 'POST', profile({ version: 3, appVersion: '<b>', credentials: { ...credentials, password: '' } }))).status, 400);
  assert.equal((await f.request('/api/bootstrap?product=augastam')).value.environments.find(e => e.id === 'ba-uat').appVersion, '');
});

async function setup(f, appVersion) {
  await f.request('/api/modules', 'POST', { name: 'Facility Setup', area: 'Setup', prefix: 'FAC' });
  await f.request('/api/modules/facility-setup/cases', 'POST', manualCase);
  await f.request('/api/environments', 'POST', profile({ appVersion }));
}
const startRun = (f, body) => f.request('/api/runs', 'POST', { name: 'R', moduleId: 'facility-setup', mode: 'manual', caseIds: ['FAC-001'], ...body });

test('createRun stores the profile version and a per-run override wins', async t => {
  const f = await boot(t);
  await f.request('/api/modules', 'POST', { name: 'Facility Setup', area: 'Setup', prefix: 'FAC' });
  await f.request('/api/modules/facility-setup/cases', 'POST', manualCase);
  await f.request('/api/environments', 'POST', profile({ appVersion: '1.58' }));
  const run = body => f.request('/api/runs', 'POST', { name: 'R', moduleId: 'facility-setup', mode: 'manual', caseIds: ['FAC-001'], ...body });
  assert.deepEqual((await run({ environmentId: 'ba-uat' })).value.appVersion, { label: '1.58', source: 'profile' });
  assert.deepEqual((await run({ environmentId: 'ba-uat', appVersion: ' 1.59 ' })).value.appVersion, { label: '1.59', source: 'run' });
  assert.equal((await run({ environmentId: 'local' })).value.appVersion, undefined);
  assert.equal((await run({ environmentId: 'ba-uat', appVersion: '<x>' })).status, 400);
});

test('describeVersion handles none, typed only, typed plus profile plus automation', () => {
  assert.equal(describeVersion({}), 'version unknown');
  assert.equal(describeVersion({ appVersion: { label: '1.58', source: 'run' } }), '1.58 (typed)');
  assert.equal(describeVersion({ appVersion: { label: '1.58' }, profile: { hash: 'abcdef123456' }, automationVersion: { number: 3 } }), '1.58 (typed) · profile abcdef (detected) · automation v3');
});

test('the browser copy of describeVersion matches the server copy for many inputs', () => {
  const inputs = [undefined, null, {}, { appVersion: {} }, { appVersion: { label: '1.58', source: 'run' } }, { appVersion: { label: '2.0 beta 3', source: 'profile' } },
    { profile: { hash: 'abc' } }, { profile: { hash: 'abcdef' } }, { profile: { hash: 'abcdef123456' } }, { profile: {} },
    { automationVersion: { number: 0 } }, { automationVersion: { number: 1 } }, { automationVersion: { number: 12 } },
    { appVersion: { label: '1.58 hotfix' }, profile: { hash: 'abcdef123456' }, automationVersion: { number: 12 } }];
  for (const run of inputs) assert.equal(clientDescribe(run), describeVersion(run), JSON.stringify(run));
  assert.equal(describeVersion({ profile: { hash: 'abc' } }), 'profile abc (detected)');
  assert.equal(describeVersion({ automationVersion: { number: 0 } }), 'version unknown');
});

test('a whitespace-only run override counts as blank and the profile version is used', async t => {
  const f = await boot(t); await setup(f, '1.58');
  const r = await startRun(f, { environmentId: 'ba-uat', appVersion: '   ' });
  assert.deepEqual(r.value.appVersion, { label: '1.58', source: 'profile' });
});

test('a re-run keeps the original run version and never reads the profile again', async t => {
  const f = await boot(t); await setup(f, '1.58');
  const changeProfile = async (version, appVersion) => assert.equal((await f.request('/api/environments', 'POST', profile({ version, appVersion, credentials: { ...credentials, password: '' } }))).status, 200);
  const rerun = async id => {
    assert.equal((await f.request(`/api/runs/${id}/results`, 'POST', { id: 'FAC-001', status: 'FAIL', actual: 'bad' })).status, 200);
    assert.equal((await f.request(`/api/runs/${id}/complete`, 'POST', {})).status, 200);
    const again = await f.request(`/api/runs/${id}/rerun-failures`, 'POST', { appVersion: '9.9', inheritVersion: { label: 'forged', source: 'run' } });
    assert.equal(again.status, 201); return again.value;
  };
  const override = await startRun(f, { environmentId: 'ba-uat', appVersion: '1.59' });
  const fromProfile = await startRun(f, { environmentId: 'ba-uat' });
  await changeProfile(1, '2.0');
  assert.deepEqual((await rerun(override.value.id)).appVersion, { label: '1.59', source: 'run' });
  assert.deepEqual((await rerun(fromProfile.value.id)).appVersion, { label: '1.58', source: 'profile' });
  const none = await startRun(f, { environmentId: 'local' });
  assert.equal((await rerun(none.value.id)).appVersion, undefined);
  // and a run created with no version stays without one after its profile gains one
  await f.request('/api/environments', 'POST', profile({ id: 'blank', name: 'Blank' }));
  const blank = await startRun(f, { environmentId: 'blank' });
  await f.request('/api/environments', 'POST', profile({ id: 'blank', name: 'Blank', version: 1, appVersion: '3.0', credentials: { ...credentials, password: '' } }));
  assert.equal((await rerun(blank.value.id)).appVersion, undefined);
});

test('changing the application version is recorded in the profile audit detail', async t => {
  const f = await boot(t);
  await f.request('/api/environments', 'POST', profile());
  await f.request('/api/environments', 'POST', profile({ version: 1, appVersion: '1.60', credentials: { ...credentials, password: '' } }));
  const entry = f.store.auditLog({ scopeType: 'product', scopeId: 'augastam' }).find(e => e.action === 'environment.update');
  assert.ok(entry.detail.fieldsChanged.includes('appVersion'));
  assert.ok(!JSON.stringify(entry.detail).includes('1.60'));
});

// ---- Task 2: configuration profile fingerprint ----
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createQueue } from '../queue.mjs';
import { normalizeConfig, profileFingerprint, profileFromKeys, PROFILE_URL } from '../profile.mjs';
import { createRequire } from 'node:module';
import * as shared from '../../tests/shared/profile-hash.mjs';

const form = (over = {}) => ({ id: 'f1', updatedAt: '2026-01-01', fields: [{ name: 'a', required: false, meta: { z: 1, a: 2, token: 'x' } }, { name: 'b' }], ...over });

test('normalizeConfig is independent of key order and ignores volatile keys', () => {
  const a = normalizeConfig({ b: 1, a: { y: 2, x: 3, CreatedAt: 'now' }, list: [{ z: 1, a: 2 }, 5], Token: 't' });
  const b = normalizeConfig({ list: [{ a: 2, z: 1 }, 5], a: { x: 3, y: 2, createdat: 'later' }, b: 1 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(normalizeConfig([3, 1, 2]), [3, 1, 2]);
});

test('profileFingerprint is equal for shuffled and re-stamped input and different when a field required flag changes', () => {
  const base = profileFingerprint({ formSchema: form(), webpart: { w: 1 } });
  const shuffled = profileFingerprint({ webpart: { w: 1 }, formSchema: { fields: [{ meta: { a: 2, z: 1 }, required: false, name: 'a' }, { name: 'b' }], updatedAt: '2030-05-05', id: 'f1' } });
  assert.equal(shuffled.hash, base.hash);
  assert.deepEqual(shuffled.parts, base.parts);
  assert.match(base.hash, /^[0-9a-f]{64}$/);
  const flipped = profileFingerprint({ formSchema: form({ fields: [{ name: 'a', required: true, meta: { z: 1, a: 2 } }, { name: 'b' }] }), webpart: { w: 1 } });
  assert.notEqual(flipped.hash, base.hash);
  assert.notEqual(flipped.parts.formSchema, base.parts.formSchema);
  assert.equal(flipped.parts.webpart, base.parts.webpart);
});

test('lookups part changes when an option is added', () => {
  const one = profileFingerprint({ lookups: { 'lookups:/a?id=1': { options: ['x'] } } });
  const two = profileFingerprint({ lookups: { 'lookups:/a?id=1': { options: ['x', 'y'] } } });
  assert.notEqual(one.parts.lookups, two.parts.lookups);
  assert.notEqual(one.hash, two.hash);
});

test('portal and fixture-side fingerprint code are the same module and agree; urls map to parts', () => {
  const input = { lookups: { k: [1, { b: 1, a: 2 }] }, workflow: { w: true } };
  assert.deepEqual(profileFingerprint(input), shared.profileFingerprint(input));
  assert.equal(shared.partForUrl('https://x/configuration-service/reference-lookup/latest-version?lookup_id=3'), 'lookups');
  assert.equal(shared.partForUrl('https://x/configuration-service/workflow/get-workflow'), 'workflow');
  assert.equal(shared.partForUrl('https://x/other'), undefined);
  assert.ok(PROFILE_URL.test('configuration-service/webpart/latest-version'));
  assert.equal(shared.responseKey('https://x/configuration-service/reference-lookup/latest-version?b=2&a=1&etag=9'), shared.responseKey('https://x/configuration-service/reference-lookup/latest-version?a=1&b=2'));
});

// Key-level hashes: what the fixture ships and the portal unions.
const U = 'https://x/configuration-service/';
const keyed = list => Object.fromEntries(list.map(([url, body]) => [shared.entryKey(url), shared.hashBody(body)]));

test('response-key hashes: arrival order, volatile fields and cache busters do not matter', () => {
  const r1 = [U + 'reference-lookup/latest-version?lookup_id=1', { options: ['a'], updatedAt: 1 }];
  const r2 = [U + 'reference-lookup/latest-version?lookup_id=2', { options: ['b'] }];
  const r3 = [U + 'form-schema/latest-version?type=x', { fields: [{ name: 'n', required: false }] }];
  const forward = keyed([r1, r2, r3]), backward = keyed([r3, r2, r1]);
  assert.deepEqual(Object.keys(forward).sort(), Object.keys(backward).sort());
  assert.deepEqual(profileFromKeys(forward), profileFromKeys(backward));
  const busted = keyed([[U + 'reference-lookup/latest-version?lookup_id=1&_=99&ts=5&nocache=1', { options: ['a'], updatedAt: 2 }], r2, r3]);
  assert.deepEqual(profileFromKeys(busted), profileFromKeys(forward));
  assert.ok(Object.keys(forward).every(k => /^(lookups|formSchema)\|\//.test(k)));
  assert.ok(Object.values(forward).every(h => /^[0-9a-f]{64}$/.test(h)));
});

test('key-level fingerprint changes when a required flag flips or a lookup option is added', () => {
  const schema = required => [U + 'form-schema/latest-version?type=x', { fields: [{ name: 'n', required }] }];
  const lookup = options => [U + 'reference-lookup/latest-version?lookup_id=1', { options }];
  const base = profileFromKeys(keyed([schema(false), lookup(['a'])]));
  const flipped = profileFromKeys(keyed([schema(true), lookup(['a'])]));
  const added = profileFromKeys(keyed([schema(false), lookup(['a', 'b'])]));
  assert.notEqual(flipped.hash, base.hash); assert.notEqual(flipped.parts.formSchema, base.parts.formSchema); assert.equal(flipped.parts.lookups, base.parts.lookups);
  assert.notEqual(added.hash, base.hash); assert.notEqual(added.parts.lookups, base.parts.lookups); assert.equal(added.parts.formSchema, base.parts.formSchema);
  assert.deepEqual(shared.profileFromKeys(keyed([schema(false), lookup(['a'])])), base);
});

// ---- reporter merge ----
const Reporter = createRequire(import.meta.url)('../reporter.cjs');
const H = c => c.repeat(64);
function report(dir, attachments, id) {
  process.env.PORTAL_RUN_DIR = dir; delete process.env.PORTAL_RUN_ROOT; delete process.env.PORTAL_SHARD_INDEX;
  new Reporter().onTestEnd({ id, title: `${id} t`, annotations: [] }, { status: 'passed', duration: 1, retry: 0, attachments, startTime: new Date() });
}
const att = body => ({ name: 'profile.json', contentType: 'application/json', body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) });

test('reporter unions profile keys, first hash wins with a conflict recorded, malformed attachments ignored, no .tmp left', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-reporter-'));
  report(dir, [att({ keys: { 'lookups|/a?id=1': H('a'), 'webpart|/w': H('b') }, count: 2 }), att('{not json'), att({ keys: ['x'] }), att({ keys: { bad: 'zz' }, count: 1 })], 'T1');
  report(dir, [att({ keys: { 'lookups|/a?id=1': H('c'), 'lookups|/a?id=2': H('d') }, count: 2 })], 'T2');
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
  assert.deepEqual(doc.keys, { 'lookups|/a?id=1': H('a'), 'webpart|/w': H('b'), 'lookups|/a?id=2': H('d') });
  assert.deepEqual(doc.conflicts, ['lookups|/a?id=1']);
  assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')), []);
  const none = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-reporter-'));
  report(none, [att('garbage')], 'T3');
  assert.ok(fs.existsSync(path.join(none, 'events.jsonl')), 'events are still written');
});

// ---- queue ----
function queueFixture(workers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-queue-'));
  const runs = new Map();
  const store = { runs: () => [...runs.values()], run: id => runs.get(id), saveRun: r => { runs.set(r.id, structuredClone(r)); } };
  const launches = [];
  const launch = (command, args, opts) => { const child = new EventEmitter(); child.stdout = null; child.pid = 0; launches.push({ opts, child }); return child; };
  const queue = createQueue(store, dir, [{ id: 'e', url: 'http://x.invalid', authDir: path.join(dir, 'auth') }], launch, null, () => null, { staggerMs: 5, workers });
  return { store, launches, queue };
}
const pause = ms => new Promise(r => setTimeout(r, ms));
const profileRun = (id, cases) => ({ id, environmentId: 'e', kind: 'tests', mode: 'automated', status: 'queued', module: { id: 'registration', adapter: 'registration', config: {} }, cases, results: [] });
const onlyRun = f => f.store.runs()[0];
const pass = (id) => JSON.stringify({ id, status: 'PASS', durationMs: 1 }) + '\n';

test('queue unions keys over shards: subset shards are stable and share the union hash', async () => {
  const f = queueFixture(2);
  const cs = [{ id: 'A', title: 'A' }, { id: 'B', title: 'B' }];
  f.store.saveRun(profileRun('rp', cs)); f.queue.pump(); await pause(40);
  const k0 = { 'lookups|/a': H('1'), 'webpart|/w': H('2') }, k1 = { 'lookups|/b': H('3'), 'webpart|/w': H('2') };
  f.launches.forEach((l, i) => {
    const d = l.opts.env.PORTAL_RUN_DIR;
    fs.writeFileSync(path.join(d, 'events.jsonl'), pass(cs[i].id));
    fs.writeFileSync(path.join(d, 'profile.json'), JSON.stringify({ keys: i ? k1 : k0, count: 2 }));
  });
  f.launches.forEach(l => l.child.emit('exit', 0)); await pause(30);
  const p = onlyRun(f).profile;
  assert.equal(p.stable, true); assert.equal(p.shards, 2); assert.equal(p.conflicts, undefined);
  assert.deepEqual(p.keys, { ...k0, ...k1 });
  assert.deepEqual({ hash: p.hash, parts: p.parts }, profileFromKeys({ ...k0, ...k1 }));
});

test('queue: a conflicting key makes stable false and is listed; the lowest shard index wins', async () => {
  const f = queueFixture(2);
  const cs = [{ id: 'A', title: 'A' }, { id: 'B', title: 'B' }];
  f.store.saveRun(profileRun('rc', cs)); f.queue.pump(); await pause(40);
  f.launches.forEach((l, i) => {
    const d = l.opts.env.PORTAL_RUN_DIR;
    fs.writeFileSync(path.join(d, 'events.jsonl'), pass(cs[i].id));
    fs.writeFileSync(path.join(d, 'profile.json'), JSON.stringify({ keys: { 'formSchema|/f': i ? H('9') : H('8') }, count: 1 }));
  });
  f.launches.forEach(l => l.child.emit('exit', 0)); await pause(30);
  const p = onlyRun(f).profile;
  assert.equal(p.stable, false); assert.deepEqual(p.conflicts, ['formSchema|/f']); assert.equal(p.keys['formSchema|/f'], H('8'));
});

test('queue: malformed files and non-integer shard dirs are ignored; shard 10 sorts after shard 2', async () => {
  const f = queueFixture(1);
  f.store.saveRun(profileRun('rs', [{ id: 'A', title: 'A' }])); f.queue.pump(); await pause(10);
  const root = f.launches[0].opts.env.PORTAL_RUN_DIR;
  const shards = path.join(f.queue.dirFor('rs'), 'shards');
  const put = (name, body) => { fs.mkdirSync(path.join(shards, name), { recursive: true }); fs.writeFileSync(path.join(shards, name, 'profile.json'), typeof body === 'string' ? body : JSON.stringify(body)); };
  put('10', { keys: { 'webpart|/w': H('a'), 'lookups|/x': H('b') } });
  put('2', { keys: { 'webpart|/w': H('c') } });
  put('abc', { keys: { 'webpart|/zzz': H('d') } });
  put('3', '{"keys": {"lookups|/y": "');
  put('4', { keys: { 'lookups|/ok': H('e'), 'lookups|/bad': 'nothex', 'lookups|/num': 5 } });
  fs.writeFileSync(path.join(root, 'events.jsonl'), pass('A'));
  f.launches[0].child.emit('exit', 0); await pause(30);
  const p = onlyRun(f).profile;
  assert.equal(p.keys['webpart|/w'], H('c'), 'shard 2 beats shard 10');
  for (const k of ['webpart|/zzz', 'lookups|/y', 'lookups|/bad', 'lookups|/num']) assert.ok(!(k in p.keys), k);
  assert.equal(p.keys['lookups|/ok'], H('e'));
  assert.equal(p.shards, 3); assert.equal(p.stable, false); assert.deepEqual(p.conflicts, ['webpart|/w']);
});

test('queue: reporter-reported conflicts mark unstable and repeated syncs do not flip; an unreadable file keeps the profile unknown', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = queueFixture(1);
  f.store.saveRun(profileRun('ru', [{ id: 'A', title: 'A' }])); f.queue.pump(); await pause(10);
  const root = f.launches[0].opts.env.PORTAL_RUN_DIR;
  fs.writeFileSync(path.join(root, 'events.jsonl'), pass('A'));
  fs.writeFileSync(path.join(root, 'profile.json'), JSON.stringify({ keys: { 'webpart|/w': H('a') }, conflicts: ['webpart|/w'] }));
  t.mock.timers.tick(1000); t.mock.timers.tick(1000); // two interval syncs, no real waiting
  assert.equal(onlyRun(f).profile.stable, false);
  f.launches[0].child.emit('exit', 0); await pause(30);
  assert.equal(onlyRun(f).profile.stable, false);

  const g = queueFixture(1);
  g.store.saveRun(profileRun('rn', [{ id: 'A', title: 'A' }])); g.queue.pump(); await pause(10);
  fs.writeFileSync(path.join(g.launches[0].opts.env.PORTAL_RUN_DIR, 'events.jsonl'), pass('A'));
  fs.writeFileSync(path.join(g.launches[0].opts.env.PORTAL_RUN_DIR, 'profile.json'), '{"keys": [1,2]}');
  g.launches[0].child.emit('exit', 0); await pause(30);
  assert.equal(onlyRun(g).profile, undefined);
});

test('stored keys never contain query text: tokens are hashed away, identity and determinism preserved', () => {
  const base = U + 'reference-lookup/latest-version';
  const key = shared.entryKey(base + '?access_token=SECRET123&lookup_id=7');
  for (const forbidden of ['SECRET123', 'access_token', 'lookup_id', '7&']) assert.ok(!key.includes(forbidden), forbidden);
  assert.match(key, /^lookups\|\/configuration-service\/reference-lookup\/latest-version\?[0-9a-f]{12}$/);
  assert.equal(shared.entryKey(base + '?lookup_id=7&_=1&ts=2&cb=3'), shared.entryKey(base + '?lookup_id=7&nocache=9&timestamp=4'));
  assert.notEqual(shared.entryKey(base + '?lookup_id=7'), shared.entryKey(base + '?lookup_id=8'));
  assert.equal(shared.entryKey(base + '?b=2&a=1'), shared.entryKey(base + '?a=1&b=2'));
  assert.equal(shared.entryKey(base), 'lookups|/configuration-service/reference-lookup/latest-version');
  assert.ok(shared.isProfileKey('lookups|/x') && !shared.isProfileKey('constructor') && !shared.isProfileKey('other|/x') && !shared.isProfileKey('lookups|/' + 'a'.repeat(400)));
});

test('reporter and queue drop keys named constructor, __proto__, toString or with an unknown part', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-reporter-'));
  report(dir, [att('{"keys":{"constructor":"' + H('a') + '","__proto__":"' + H('a') + '","toString":"' + H('a') + '","other|/x":"' + H('a') + '","lookups|/ok":"' + H('b') + '"},"count":1}')], 'P1');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8')).keys, { 'lookups|/ok': H('b') });
  assert.equal(({}).polluted, undefined);
  const f = queueFixture(1);
  f.store.saveRun(profileRun('rq', [{ id: 'A', title: 'A' }])); f.queue.pump(); await pause(10);
  const root = f.launches[0].opts.env.PORTAL_RUN_DIR;
  fs.writeFileSync(path.join(root, 'events.jsonl'), pass('A'));
  fs.writeFileSync(path.join(root, 'profile.json'), '{"keys":{"constructor":"' + H('a') + '","__proto__":"' + H('a') + '","toString":"' + H('a') + '","webpart|/w":"' + H('c') + '"}}');
  f.launches[0].child.emit('exit', 0); await pause(30);
  assert.deepEqual(onlyRun(f).profile.keys, { 'webpart|/w': H('c') });
  assert.equal(onlyRun(f).profile.stable, true);
});

test('a non-numeric shard directory does not disturb event ordering', async () => {
  const f = queueFixture(1);
  f.store.saveRun(profileRun('re', [{ id: 'A', title: 'A' }, { id: 'B', title: 'B' }])); f.queue.pump(); await pause(10);
  const shards = path.join(f.queue.dirFor('re'), 'shards');
  for (const [name, id] of [['10', 'B'], ['2', 'A'], ['notes', 'A']]) { fs.mkdirSync(path.join(shards, name), { recursive: true }); fs.writeFileSync(path.join(shards, name, 'events.jsonl'), JSON.stringify({ id, status: name === 'notes' ? 'FAIL' : 'PASS', durationMs: 1 }) + '\n'); }
  f.launches[0].child.emit('exit', 0); await pause(30);
  assert.deepEqual(onlyRun(f).results.map(r => [r.id, r.status]).sort(), [['A', 'PASS'], ['B', 'PASS']]);
});

test('run list omits profile.keys but reports keyCount; run detail keeps the keys', async t => {
  const f = await boot(t);
  await f.request('/api/modules', 'POST', { name: 'Facility Setup', area: 'Setup', prefix: 'FAC' });
  await f.request('/api/modules/facility-setup/cases', 'POST', manualCase);
  await f.request('/api/environments', 'POST', profile());
  const started = await startRun(f, { environmentId: 'ba-uat' });
  const stored = f.store.run(started.value.id);
  const keys = { 'webpart|/w': H('a'), 'lookups|/x': H('b') };
  f.store.saveRun({ ...stored, profile: { hash: 'h', parts: { webpart: 'p' }, keys, stable: true, shards: 1 } });
  const list = await f.request('/api/runs');
  const listed = list.value.find(r => r.id === started.value.id);
  assert.equal(listed.profile.keys, undefined); assert.equal(listed.profile.keyCount, 2); assert.equal(listed.profile.hash, 'h'); assert.equal(listed.profile.stable, true);
  const detail = await f.request(`/api/runs/${started.value.id}`);
  assert.deepEqual(detail.value.profile.keys, keys);
  const noProfile = await startRun(f, { environmentId: 'ba-uat' });
  assert.equal(noProfile.value.profile, undefined);
});

// ---- Automation versions (Task 3) ----
import { openStore } from '../store.mjs';
import { automationFiles, fingerprintAutomation, diffFiles, registerAutomationVersion, annotateAutomationVersion } from '../automation-versions.mjs';

function autoRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autover-root-')), data = fs.mkdtempSync(path.join(os.tmpdir(), 'autover-data-'));
  const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('tests/modules/m1/a.spec.ts', 'export const a = 1;\n');
  put('tests/modules/m1/helpers/b.ts', 'export const b = 2;\n');
  put('tests/modules/m1/results/out.json', '{}'); put('tests/modules/m1/node_modules/x.js', 'x'); put('tests/modules/m1/notes.txt', 'ignored ext');
  put('qa/modules/m1/adapter.json', '{"x":1}'); put('qa/modules/m1/cases/c.json', '{"id":"C"}'); put('qa/modules/m1/discovery/d.json', '{}');
  put('qa/modules/m1/versions/v.json', '{}'); put('tests/fixtures/f.png', 'png'); put('playwright.config.ts', 'export default {};\n');
  put('tests/modules/other/o.ts', 'o');
  const store = openStore(data);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); });
  return { root, store, put, reg: (extra = {}) => registerAutomationVersion({ store, root, moduleId: 'm1', by: 'tester', ...extra }) };
}

test('automationFiles lists the included files sorted, forward-slash, without result, case, discovery or other-module folders', t => {
  const { root } = autoRoot(t);
  assert.deepEqual(automationFiles(root, 'm1'), ['playwright.config.ts', 'qa/modules/m1/adapter.json', 'qa/modules/m1/versions/v.json', 'tests/fixtures/f.png', 'tests/modules/m1/a.spec.ts', 'tests/modules/m1/helpers/b.ts']);
  assert.equal(fingerprintAutomation(root, 'missing-module').files.length, 2, 'a missing module still hashes playwright.config.ts and fixtures');
});

test('same content gives the same number; CRLF and LF checkouts hash equal', t => {
  const { root, put, reg } = autoRoot(t);
  const first = reg();
  assert.equal(first.number, 1); assert.equal(first.changedFiles.added.length, 6); assert.deepEqual(first.changedFiles.changed, []);
  assert.equal(reg({ note: 'ignored' }).number, 1);
  assert.equal(reg({ note: 'ignored' }).note, '');
  const lfHash = fingerprintAutomation(root, 'm1').hash;
  put('tests/modules/m1/a.spec.ts', 'export const a = 1;\r\n');
  assert.equal(fingerprintAutomation(root, 'm1').hash, lfHash);
  assert.equal(reg().number, 1);
});

test('changing one file creates v2 with that file listed under changed', t => {
  const { put, reg, store } = autoRoot(t);
  reg(); put('tests/modules/m1/a.spec.ts', 'export const a = 99;\n');
  const second = reg();
  assert.equal(second.number, 2); assert.deepEqual(second.changedFiles, { added: [], changed: ['tests/modules/m1/a.spec.ts'], removed: [] });
  assert.equal(store.automationVersions('m1').length, 2);
  assert.equal(JSON.stringify(store.automationVersions('m1')).includes('export const'), false, 'contents are never stored');
});

test('reverting to the first content returns v1 again, not v3', t => {
  const { put, reg } = autoRoot(t);
  reg(); put('tests/modules/m1/a.spec.ts', 'changed\n'); assert.equal(reg().number, 2);
  put('tests/modules/m1/a.spec.ts', 'export const a = 1;\n');
  assert.equal(reg().number, 1);
  put('tests/modules/m1/a.spec.ts', 'changed\n'); assert.equal(reg().number, 2);
});

test('two simultaneous registrations of new content create exactly one new number', async t => {
  const { put, reg, store, root } = autoRoot(t);
  reg(); put('tests/modules/m1/a.spec.ts', 'new content\n');
  const [x, y] = await Promise.all([Promise.resolve().then(() => reg()), Promise.resolve().then(() => reg())]);
  assert.equal(x.number, 2); assert.equal(y.number, 2); assert.equal(store.automationVersions('m1').length, 2);
  // A registration that raced past the existence checks hits the unique index and gets the winner back.
  let misses = 2;
  const stale = { ...store, automationVersionByHash: (m, h) => (misses-- > 0 ? undefined : store.automationVersionByHash(m, h)), automationVersions: () => [{ number: 1, files: [] }], transaction: fn => store.transaction(fn) };
  const raced = registerAutomationVersion({ store: stale, root, moduleId: 'm1' });
  assert.equal(raced.number, 2); assert.equal(store.automationVersions('m1').length, 2);
});

test('uncommitted is true when git reports dirty; a clean commit is recorded otherwise', async t => {
  const { put, reg, root, store } = autoRoot(t);
  const dirty = reg();
  assert.equal(dirty.gitCommit, undefined);
  const annotated = await annotateAutomationVersion({ store, root, moduleId: 'm1', number: dirty.number, git: async paths => { assert.ok(paths.includes('tests/modules/m1/a.spec.ts')); return { commit: 'abc123', dirty: true }; } });
  assert.equal(annotated.uncommitted, true); assert.equal(annotated.pendingGit, undefined);
  assert.equal(store.automationVersionByNumber('m1', 1).uncommitted, true);
  put('tests/modules/m1/a.spec.ts', 'clean one\n');
  const clean = reg();
  const done = await annotateAutomationVersion({ store, root, moduleId: 'm1', number: clean.number, git: async () => ({ commit: 'def456', dirty: false }) });
  assert.equal(done.gitCommit, 'def456'); assert.equal(done.uncommitted, false);
  const again = await annotateAutomationVersion({ store, root, moduleId: 'm1', number: clean.number, git: async () => ({ commit: 'zzz', dirty: true }) });
  assert.equal(again.gitCommit, 'def456', 'annotation happens once');
});

test('an unknown git failure leaves gitCommit undefined and still registers', async t => {
  const { reg, root, store } = autoRoot(t);
  const v = reg();
  const out = await annotateAutomationVersion({ store, root, moduleId: 'm1', number: v.number, git: async () => { throw new Error('git exploded'); } });
  assert.equal(out.gitCommit, undefined); assert.equal(out.uncommitted, undefined); assert.equal(out.number, 1);
});

test('diffFiles reports added, changed and removed', () => {
  assert.deepEqual(diffFiles([{ path: 'a', sha256: '1' }, { path: 'b', sha256: '2' }], [{ path: 'b', sha256: '3' }, { path: 'c', sha256: '4' }]), { added: ['c'], changed: ['b'], removed: ['a'] });
});

const autoCase = { id: 'AV-001', title: 'Auto', mode: 'automated', category: 'T', priority: 'P1', action: 'fill', input: { first_name: 'Alpha', last_name: 'Beta' }, expected: { outcome: 'field-state', values: { first_name: 'Alpha' } }, steps: [] };

test('an automated run is stamped with automationVersion and a manual run is not', async t => {
  const f = await boot(t, { automationGit: async () => ({ commit: 'c1', dirty: false }) });
  assert.equal((await f.request('/api/modules/registration/cases', 'POST', autoCase)).status, 201);
  const auto = await f.request('/api/runs', 'POST', { name: 'A', moduleId: 'registration', environmentId: 'local', mode: 'automated', caseIds: ['AV-001'] });
  assert.equal(auto.status, 201);
  assert.equal(auto.value.automationVersion.number, 1); assert.match(auto.value.automationVersion.hash, /^[0-9a-f]{64}$/); assert.equal('uncommitted' in auto.value.automationVersion, false);
  const again = await f.request('/api/runs', 'POST', { name: 'B', moduleId: 'registration', environmentId: 'local', mode: 'automated', caseIds: ['AV-001'] });
  assert.equal(again.value.automationVersion.number, 1);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(f.store.automationVersionByNumber('registration', 1).gitCommit, 'c1');
  await f.request('/api/modules', 'POST', { name: 'Facility Setup', area: 'Setup', prefix: 'FAC' });
  await f.request('/api/modules/facility-setup/cases', 'POST', manualCase);
  const manual = await f.request('/api/runs', 'POST', { name: 'M', moduleId: 'facility-setup', environmentId: 'local', mode: 'manual', caseIds: ['FAC-001'] });
  assert.equal(manual.status, 201); assert.equal(manual.value.automationVersion, undefined);
});

test('a failing fingerprint does not block run creation', async t => {
  const f = await boot(t, { automationFingerprint: () => { throw new Error('disk gone'); } });
  assert.equal((await f.request('/api/modules/registration/cases', 'POST', autoCase)).status, 201);
  const run = await f.request('/api/runs', 'POST', { name: 'A', moduleId: 'registration', environmentId: 'local', mode: 'automated', caseIds: ['AV-001'] });
  assert.equal(run.status, 201); assert.equal(run.value.automationVersion, undefined);
});
