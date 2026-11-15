import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, until } from './support.mjs';
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
import { automationFiles, fingerprintAutomation, diffFiles, registerAutomationVersion, annotateAutomationVersion, defaultGit, parseStatus } from '../automation-versions.mjs';

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


test('a failing fingerprint does not block run creation', async t => {
  const f = await boot(t, { automationFingerprint: () => { throw new Error('disk gone'); } });
  assert.equal((await f.request('/api/modules/registration/cases', 'POST', autoCase)).status, 201);
  const run = await f.request('/api/runs', 'POST', { name: 'A', moduleId: 'registration', environmentId: 'local', mode: 'automated', caseIds: ['AV-001'] });
  assert.equal(run.status, 201); assert.equal(run.value.automationVersion, undefined);
});

// A second SQLite handle on the same data directory (WAL) is the real cross-connection case.
test('two store handles on the same data directory: same content one number, new content the next number, nothing overwritten', t => {
  const { root, put } = autoRoot(t);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'autover-shared-'));
  const A = openStore(data), B = openStore(data);
  t.after(() => { A.close(); B.close(); fs.rmSync(data, { recursive: true, force: true }); });
  const reg = (store, by) => registerAutomationVersion({ store, root, moduleId: 'm1', by });
  const first = reg(A, 'alice');
  assert.equal(reg(B, 'bob').number, 1);
  put('tests/modules/m1/a.spec.ts', 'content Y\n');
  const viaB = reg(B, 'bob');
  assert.equal(viaB.number, 2);
  const viaA = reg(A, 'alice');
  assert.equal(viaA.number, 2); assert.equal(viaA.createdBy, 'bob', 'the first registration of that content wins');
  put('tests/modules/m1/a.spec.ts', 'content Z\n');
  assert.equal(reg(A, 'alice').number, 3);
  assert.deepEqual(B.automationVersions('m1').map(v => v.number), [3, 2, 1]);
  assert.equal(B.automationVersionByNumber('m1', 1).hash, first.hash);
  assert.deepEqual(B.automationVersionByNumber('m1', 2).changedFiles, { added: [], changed: ['tests/modules/m1/a.spec.ts'], removed: [] });
});

test('a stale writer colliding on the NUMBER with a different hash renumbers and never overwrites the stored version', t => {
  const { put, root, store, reg } = autoRoot(t);
  const v1 = reg(); put('tests/modules/m1/a.spec.ts', 'content Y\n');
  const v2 = reg();
  const before = JSON.stringify(store.automationVersionByNumber('m1', 2));
  put('tests/modules/m1/a.spec.ts', 'content Z\n');
  let stale = true;
  const staleStore = { ...store, transaction: fn => store.transaction(fn), latestAutomationVersion: m => { if (stale) { stale = false; return { number: 1, files: v1.files }; } return store.latestAutomationVersion(m); } };
  const created = registerAutomationVersion({ store: staleStore, root, moduleId: 'm1', by: 'late' });
  assert.equal(created.number, 3);
  assert.equal(JSON.stringify(store.automationVersionByNumber('m1', 2)), before, 'v2 document untouched');
  assert.equal(store.automationVersionByNumber('m1', 2).hash, v2.hash); assert.equal(store.automationVersionByNumber('m1', 2).createdBy, 'tester');
  assert.deepEqual(store.automationVersions('m1').map(v => v.number), [3, 2, 1]);
});

test('a stale writer colliding on the HASH returns the existing version', t => {
  const { put, root, store, reg } = autoRoot(t);
  reg(); put('tests/modules/m1/a.spec.ts', 'content Y\n');
  const v2 = reg();
  let misses = 2;
  const staleStore = { ...store, transaction: fn => store.transaction(fn), automationVersionByHash: (m, h) => (misses-- > 0 ? undefined : store.automationVersionByHash(m, h)), latestAutomationVersion: () => ({ number: 1, files: [] }) };
  const got = registerAutomationVersion({ store: staleStore, root, moduleId: 'm1', by: 'late' });
  assert.equal(got.number, 2); assert.equal(got.hash, v2.hash); assert.equal(got.createdBy, 'tester');
  assert.equal(store.automationVersions('m1').length, 2);
});

test('insertAutomationVersion throws on a duplicate number or hash; updateAutomationVersion cannot change hash or number', t => {
  const { reg, store } = autoRoot(t);
  const v1 = reg();
  assert.throws(() => store.insertAutomationVersion({ ...v1, hash: 'other' }), /UNIQUE/i);
  assert.throws(() => store.insertAutomationVersion({ ...v1, number: 9 }), /UNIQUE/i);
  store.updateAutomationVersion('m1', 1, { hash: 'x', number: 7, note: 'n' });
  assert.equal(store.automationVersionByNumber('m1', 1).hash, v1.hash); assert.equal(store.latestAutomationVersion('m1').number, 1);
});

// ---- git helper (injected runner) ----
const gitRunner = (status, head = 'abc123\n') => async args => (args[0] === 'rev-parse' ? head : args[0] === 'status' ? status : null);

test('default git: a dirty file inside the hashed set is dirty, outside it is clean', async () => {
  const paths = ['tests/modules/m1/a.spec.ts', 'playwright.config.ts'];
  assert.deepEqual(await defaultGit('.', gitRunner(' M tests/modules/m1/a.spec.ts\n'))(paths), { commit: 'abc123', dirty: true });
  assert.deepEqual(await defaultGit('.', gitRunner(' M docs/readme.md\n?? qa/modules/m1/cases/new.json\n'))(paths), { commit: 'abc123', dirty: false });
  assert.deepEqual(await defaultGit('.', gitRunner(''))(paths), { commit: 'abc123', dirty: false });
  assert.equal((await defaultGit('.', gitRunner('R  old.txt -> tests/modules/m1/a.spec.ts\n'))(paths)).dirty, true, 'rename target');
  assert.equal((await defaultGit('.', gitRunner('R  tests/modules/m1/a.spec.ts -> moved/a.ts\n'))(paths)).dirty, true, 'rename source');
  assert.equal((await defaultGit('.', gitRunner('?? tests/modules/m1/\n'))(paths)).dirty, true, 'untracked directory containing hashed files');
});

test('default git: 600 paths work with one status call and no pathspec', async () => {
  const paths = Array.from({ length: 600 }, (_, i) => `tests/shared/file-${i}.txt`), calls = [];
  const run = async args => { calls.push(args); return args[0] === 'rev-parse' ? 'abc\n' : ' M tests/shared/file-599.txt\n'; };
  assert.deepEqual(await defaultGit('.', run)(paths), { commit: 'abc', dirty: true });
  assert.ok(calls.every(a => !a.includes('--') && a.join(' ').length < 100), 'no path list on the command line');
});

test('default git: any failure is unknown ({}), never clean', async () => {
  assert.deepEqual(await defaultGit('.', async () => null)(['a']), {});
  assert.deepEqual(await defaultGit('.', async args => (args[0] === 'rev-parse' ? 'abc\n' : null))(['a']), {});
  assert.deepEqual(await defaultGit('.', async () => { throw new Error('boom'); })(['a']), {});
  assert.deepEqual(await defaultGit('.', gitRunner('', ''))(['a']), {});
});

test('default git: paths with brackets, asterisks, spaces and quotes match literally', async () => {
  const paths = ['tests/shared/we ird[1]*.ts', 'tests/shared/café.ts'];
  assert.equal((await defaultGit('.', gitRunner(' M "tests/shared/we ird[1]*.ts"\n'))(paths)).dirty, true);
  assert.equal((await defaultGit('.', gitRunner(' M tests/shared/we ird[1]*.ts\n'))(paths)).dirty, true);
  assert.equal((await defaultGit('.', gitRunner(' M tests/shared/we ird[2]*.ts\n'))(paths)).dirty, false, 'no glob matching');
  assert.equal((await defaultGit('.', gitRunner(' M "tests/shared/caf\\303\\251.ts"\n'))(paths)).dirty, true, 'quoted octal UTF-8');
  assert.deepEqual(parseStatus('?? "a\\"b.ts"\n'), ['a"b.ts']);
});

// ---- fingerprint edge cases ----
test('an unreadable listed file makes the fingerprint throw instead of silently changing the hash', t => {
  const { root, store } = autoRoot(t);
  assert.throws(() => fingerprintAutomation(root, 'm1', { hashFile: () => { throw new Error('EBUSY'); } }), /EBUSY/);
  assert.throws(() => registerAutomationVersion({ store, root, moduleId: 'm1', fingerprint: (r, m) => fingerprintAutomation(r, m, { hashFile: () => { throw new Error('EBUSY'); } }) }), /EBUSY/);
  assert.equal(store.automationVersions('m1').length, 0);
});

test('CRLF is normalized for text extensions only; other files hash raw', t => {
  const { root, put } = autoRoot(t);
  const digest = rel => fingerprintAutomation(root, 'm1').files.find(f => f.path === rel).sha256;
  put('tests/fixtures/data.bin', 'x\ny'); put('tests/fixtures/code.ts', 'x\ny');
  const [bin, ts] = [digest('tests/fixtures/data.bin'), digest('tests/fixtures/code.ts')];
  put('tests/fixtures/data.bin', 'x\r\ny'); put('tests/fixtures/code.ts', 'x\r\ny');
  assert.notEqual(digest('tests/fixtures/data.bin'), bin); assert.equal(digest('tests/fixtures/code.ts'), ts);
});

test('the 500-file cap sets truncated and the version still registers', t => {
  const { root, put, reg } = autoRoot(t);
  for (let i = 0; i < 520; i++) put(`tests/shared/f${String(i).padStart(3, '0')}.txt`, String(i));
  const fp = fingerprintAutomation(root, 'm1');
  assert.equal(fp.truncated, true); assert.equal(fp.files.length, 500);
  const v = reg(); assert.equal(v.number, 1); assert.equal(v.truncated, true); assert.equal(v.files.length, 500);
});

test('symlinks are excluded', t => {
  const { root, put } = autoRoot(t);
  put('tests/shared/real.ts', 'real');
  try { fs.symlinkSync(path.join(root, 'tests/shared/real.ts'), path.join(root, 'tests/shared/link.ts')); }
  catch (e) { return t.skip(`symlink creation is not permitted on this machine (${e.code})`); }
  const files = automationFiles(root, 'm1');
  assert.ok(files.includes('tests/shared/real.ts')); assert.ok(!files.includes('tests/shared/link.ts'));
});

test('module ids that escape the module folders return no files', t => {
  const { root } = autoRoot(t);
  for (const id of ['../x', path.resolve(root), 'a/b', 'a\\b', '..', '']) assert.deepEqual(automationFiles(root, id), [], JSON.stringify(id));
});

test('an automated run is stamped with automationVersion and a manual run is not', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autover-run-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fingerprint = () => ({ hash: 'a'.repeat(64), files: [{ path: 'tests/modules/registration/x.ts', sha256: 'b'.repeat(64) }], truncated: false });
  const f = await boot(t, { automationRoot: root, automationFingerprint: fingerprint, automationGit: async () => ({ commit: 'c1', dirty: false }) });
  assert.equal((await f.request('/api/modules/registration/cases', 'POST', autoCase)).status, 201);
  const auto = await f.request('/api/runs', 'POST', { name: 'A', moduleId: 'registration', environmentId: 'local', mode: 'automated', caseIds: ['AV-001'] });
  assert.equal(auto.status, 201);
  assert.deepEqual(auto.value.automationVersion, { number: 1, hash: 'a'.repeat(64) });
  const again = await f.request('/api/runs', 'POST', { name: 'B', moduleId: 'registration', environmentId: 'local', mode: 'automated', caseIds: ['AV-001'] });
  assert.equal(again.value.automationVersion.number, 1);
  assert.equal((await until(() => f.store.automationVersionByNumber('registration', 1).gitCommit)), 'c1');
  assert.equal(f.store.automationVersionByNumber('registration', 1).uncommitted, false);
  await f.request('/api/modules', 'POST', { name: 'Facility Setup', area: 'Setup', prefix: 'FAC' });
  await f.request('/api/modules/facility-setup/cases', 'POST', manualCase);
  const manual = await f.request('/api/runs', 'POST', { name: 'M', moduleId: 'facility-setup', environmentId: 'local', mode: 'manual', caseIds: ['FAC-001'] });
  assert.equal(manual.status, 201); assert.equal(manual.value.automationVersion, undefined);
});

import { validateTree, loadTree, assignCases, rollupTree } from '../tree.mjs';

const N = (id, parent, extra = {}) => ({ id, name: id, ...(parent ? { parent } : {}), kind: parent ? 'step' : 'root', ...extra });
const T = nodes => ({ module: 'm', version: 1, nodes });

test('validateTree accepts a small valid tree', () => {
  assert.deepEqual(validateTree(T([N('r'), N('a', 'r'), N('b', 'a', { kind: 'group', match: { category: ['x'] } })])), []);
});

test('validateTree rejects a cycle, a duplicate id, a missing parent, two roots and a seventh level', () => {
  const has = (tree, re) => assert.ok(validateTree(tree).some(m => re.test(m)), `${re} in ${JSON.stringify(validateTree(tree))}`);
  has(T([N('r'), N('a', 'b'), N('b', 'a')]), /Node "a" is part of a cycle/);
  has(T([N('r'), N('a', 'r'), N('a', 'r')]), /Node id "a" is used more than once/);
  has(T([N('r'), N('a', 'zzz')]), /Node "a" has parent "zzz" which does not exist/);
  has(T([N('r'), N('r2')]), /Exactly one root is allowed, found 2/);
  const deep = [N('l1')]; for (let i = 2; i <= 7; i++) deep.push(N(`l${i}`, `l${i - 1}`));
  has(T(deep), /Node "l7" is at level 7; at most 6 levels are allowed/);
  has(T([N('r', undefined, { match: { category: ['x'] } })]), /Root node "r" must not have match/);
  has(T([N('r'), N('a', 'r', { kind: 'nope' })]), /Node "a" has unknown kind "nope"/);
  has(T([N('r'), N('a', 'r', { match: { colour: ['x'] } })]), /Node "a" has unknown match key "colour"/);
  has(T([N('r'), N('a', 'r', { match: { category: [''] } })]), /Node "a" match\.category must be an array of non-empty strings/);
  has({ module: 'm', nodes: [] }, /non-empty nodes array/);
  has(null, /Tree must be an object/);
});

const treeA = T([N('r'), N('v', 'r', { kind: 'variant', match: { registrationType: ['New'] } }), N('g', 'v', { kind: 'group', match: { registrationType: ['New'], category: ['phone'] } }), N('plain', 'r')]);

test('assignCases prefers the more specific node and sends unmatched cases to unassigned', () => {
  const r = assignCases(treeA, [
    { id: 'A', registrationType: 'New', category: 'phone' },
    { id: 'B', registrationType: 'New', category: 'name' },
    { id: 'C', category: 'phone' },
    { id: 'D', registrationType: 'Other', category: 'x' }]);
  assert.deepEqual(r.byNode, { r: [], v: ['B'], g: ['A'], plain: [] });
  assert.deepEqual(r.unassigned, ['C', 'D']);
});

test('assignCases breaks ties by file order', () => {
  const t = T([N('r'), N('first', 'r', { match: { category: ['p'] } }), N('second', 'r', { match: { category: ['p'] } })]);
  assert.deepEqual(assignCases(t, [{ id: 'X', category: 'p' }]).byNode, { r: [], first: ['X'], second: [] });
});

test('rollupTree sums children into subtree totals and counts FAIL, ERROR and assumed failures as failed', () => {
  const byNode = { r: [], v: ['B', 'E'], g: ['A', 'C', 'D', 'F'], plain: [] };
  const roll = rollupTree(treeA, byNode, [
    { id: 'A', status: 'PASS' }, { id: 'B', status: 'FAIL' }, { id: 'C', status: 'ERROR' },
    { id: 'D', status: 'FAIL (assumed requirement)' }, { id: 'E', status: 'BLOCKED' }, { id: 'Z', status: 'PASS' }]);
  assert.deepEqual(roll.g, { total: 4, passed: 1, failed: 2, blocked: 0, other: 1, subtree: { total: 4, passed: 1, failed: 2, blocked: 0, other: 1 } });
  assert.deepEqual(roll.v.subtree, { total: 6, passed: 1, failed: 3, blocked: 1, other: 1 });
  assert.deepEqual(roll.v, { total: 2, passed: 0, failed: 1, blocked: 1, other: 0, subtree: roll.v.subtree });
  assert.deepEqual(roll.r.subtree, roll.v.subtree);
  assert.equal(roll.r.total, 0); assert.equal(roll.plain.subtree.total, 0);
});

test('loadTree returns null when no file exists, rejects ../x, and explains an invalid file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-'));
  try {
    assert.equal(loadTree(root, 'nothing'), null);
    assert.throws(() => loadTree(root, '../x'), /Invalid module id/);
    assert.throws(() => loadTree(root, '..'), /Invalid module id/);
    fs.mkdirSync(path.join(root, 'qa/modules/bad'), { recursive: true });
    fs.writeFileSync(path.join(root, 'qa/modules/bad/tree.json'), '{ nope');
    assert.throws(() => loadTree(root, 'bad'), /bad.*not valid JSON/);
    fs.writeFileSync(path.join(root, 'qa/modules/bad/tree.json'), JSON.stringify(T([N('r'), N('a', 'zzz')])));
    assert.throws(() => loadTree(root, 'bad'), /Invalid tree for "bad".*Node "a" has parent "zzz"/);
    fs.mkdirSync(path.join(root, 'qa/modules/ok'), { recursive: true });
    fs.writeFileSync(path.join(root, 'qa/modules/ok/tree.json'), JSON.stringify(T([N('r')])));
    assert.equal(loadTree(root, 'ok').nodes.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the shipped Registration tree is valid and attaches at least 95% of the 132 cases', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const tree = loadTree(root, 'registration');
  assert.ok(tree, 'tree.json exists');
  const { cases } = JSON.parse(fs.readFileSync(path.join(root, 'qa/modules/registration/cases/registration-cases.json'), 'utf8'));
  assert.equal(cases.length, 132);
  const { byNode, unassigned } = assignCases(tree, cases);
  assert.ok((cases.length - unassigned.length) / cases.length >= 0.95, `unassigned: ${unassigned.join(', ')}`);
  assert.equal(Object.values(byNode).flat().length + unassigned.length, cases.length);
});

test('validateTree covers names, malformed nodes and kinds', () => {
  const has = (tree, re) => assert.ok(validateTree(tree).some(m => re.test(m)), `${re} in ${JSON.stringify(validateTree(tree))}`);
  has(T([N('r'), N('a', 'r', { name: 'Same' }), N('b', 'r', { name: 'Same' })]), /Node name "Same" is used more than once \(nodes "a" and "b"\)/);
  has(T([N('r'), 'text']), /Node at position 2 needs an id/);
  has(T([N('r'), null]), /Node at position 2 needs an id/);
  has(T([N('r'), N('a', 5)]), /Node "a" has a parent that is not a string/);
  has(T([N('r'), N('a', 'a')]), /Node "a" is part of a cycle/);
  has(T([N('r', undefined, { kind: 'step' })]), /Node "r" has no parent so its kind must be "root"/);
  has(T([N('r'), N('a', 'r', { kind: 'root' })]), /Node "a" has a parent so its kind cannot be "root"/);
  has(T([N('r'), N('a', 'r', { match: ['x'] })]), /Node "a" match must be an object/);
  has({ ...T([N('r')]), note: 5 }, /Tree note must be a string/);
  assert.deepEqual(validateTree({ ...T([N('r')]), note: 'ok' }), []);
});

test('rollupTree: last result for an id wins, unknown ids are ignored, missing byNode entries are tolerated', () => {
  const roll = rollupTree(treeA, { g: ['A'] }, [{ id: 'A', status: 'FAIL' }, { id: 'A', status: 'PASS' }, { id: 'nope', status: 'FAIL' }, null]);
  assert.deepEqual(roll.g.subtree, { total: 1, passed: 1, failed: 0, blocked: 0, other: 0 });
  assert.equal(roll.r.subtree.total, 1); assert.equal(roll.v.total, 0);
  assert.equal(rollupTree(treeA, { constructor: ['x'] }, []).r.total, 0);
});

test('assignCases skips non-object entries and keeps file-order ties', () => {
  const r = assignCases(treeA, [null, 'x', { id: 'A', registrationType: 'New', category: 'phone' }, { category: 'zz' }]);
  assert.deepEqual(r.byNode.g, ['A']); assert.deepEqual(r.unassigned, []);
  const t = T([N('r'), N('upd', 'r', { match: { action: ['update'] } }), N('nb', 'r', { match: { registrationType: ['NB'] } })]);
  assert.deepEqual(assignCases(t, [{ id: 'X', registrationType: 'NB', action: 'update' }]).byNode.upd, ['X']);
});

test('loadTree allows only simple module ids and truncates long error lists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-'));
  try {
    for (const bad of ['..' + String.fromCharCode(92) + 'x', 'a' + String.fromCharCode(92) + 'b', 'a/b', '..', '.', path.resolve(root), '', 'a.b']) assert.throws(() => loadTree(root, bad), /Invalid module id\./, JSON.stringify(bad));
    fs.mkdirSync(path.join(root, 'qa/modules/many'), { recursive: true });
    const nodes = [N('r'), ...Array.from({ length: 8 }, (_, i) => N(`n${i}`, 'zzz'))];
    fs.writeFileSync(path.join(root, 'qa/modules/many/tree.json'), JSON.stringify(T(nodes)));
    assert.throws(() => loadTree(root, 'many'), /\(and 3 more\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the shipped Registration tree has an empty Registration type group and 132/132 attachment', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const tree = loadTree(root, 'registration');
  const { cases } = JSON.parse(fs.readFileSync(path.join(root, 'qa/modules/registration/cases/registration-cases.json'), 'utf8'));
  const { byNode, unassigned } = assignCases(tree, cases);
  assert.equal(unassigned.length, 0);
  assert.equal(rollupTree(tree, byNode, [])['new-registration-type'].total, 0);
});
