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
import { normalizeConfig, profileFingerprint, PROFILE_URL } from '../profile.mjs';
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

test('queue run gets profile from events and marks stable:false when shards disagree', async () => {
  const f = queueFixture(2);
  const cs = [{ id: 'A', title: 'A' }, { id: 'B', title: 'B' }];
  f.store.saveRun(profileRun('run-profile', cs)); f.queue.pump();
  await pause(40);
  assert.equal(f.launches.length, 2);
  const same = profileFingerprint({ formSchema: { a: 1 } }).parts, other = profileFingerprint({ formSchema: { a: 2 } }).parts;
  f.launches.forEach((l, i) => {
    const d = l.opts.env.PORTAL_RUN_DIR;
    fs.writeFileSync(path.join(d, 'events.jsonl'), JSON.stringify({ id: cs[i].id, status: 'PASS', durationMs: 1 }) + '\n');
    fs.writeFileSync(path.join(d, 'profile.json'), JSON.stringify({ parts: i === 0 ? same : other, count: 2 }));
  });
  f.launches.forEach(l => l.child.emit('exit', 0));
  await pause(30);
  const done = f.store.run('run-profile');
  assert.equal(done.profile.shards, 2);
  assert.equal(done.profile.stable, false);
  assert.equal(done.profile.hashes.length, 2);
  assert.equal(done.profile.hash, done.profile.hashes[0]);
  assert.deepEqual(done.profile.parts, same);
  assert.equal(done.profile.hash, profileFingerprint({ formSchema: { a: 1 } }).hash);
});

test('queue run with agreeing single profile is stable; without a profile file it stays unknown', async () => {
  const f = queueFixture(1);
  f.store.saveRun(profileRun('r-one', [{ id: 'A', title: 'A' }])); f.store.saveRun(profileRun('r-none', [{ id: 'A', title: 'A' }]));
  f.queue.pump(); await pause(10);
  const d = f.launches[0].opts.env.PORTAL_RUN_DIR;
  fs.writeFileSync(path.join(d, 'events.jsonl'), JSON.stringify({ id: 'A', status: 'PASS', durationMs: 1 }) + '\n');
  fs.writeFileSync(path.join(d, 'profile.json'), JSON.stringify({ parts: profileFingerprint({ lookups: { k: 1 } }).parts, count: 1 }));
  f.launches[0].child.emit('exit', 0); await pause(30);
  const ran = f.store.runs().find(r => r.profile) ;
  assert.equal(ran.profile.stable, true); assert.equal(ran.profile.shards, 1); assert.equal(ran.profile.hashes, undefined);
  const next = f.launches[1];
  fs.writeFileSync(path.join(next.opts.env.PORTAL_RUN_DIR, 'events.jsonl'), JSON.stringify({ id: 'A', status: 'PASS', durationMs: 1 }) + '\n');
  next.child.emit('exit', 0); await pause(30);
  assert.equal(f.store.runs().filter(r => !r.profile).length, 1);
});
