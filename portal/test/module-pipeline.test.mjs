import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { boot, signedIn, makeUser, until, wait } from './support.mjs';
import { createPortal } from '../server.mjs';
import { openStore } from '../store.mjs';
import { createIntake } from '../intake.mjs';
import { readiness } from '../readiness.mjs';

const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const probe = async id => ({ id, label: id, available: id === 'claude', version: '1' });
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const tmp = (t, prefix = 'augastam-pipeline-') => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); t.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* handle still open on Windows */ } }); return d; };
const up = (c, module, name, body, extra = {}) => c.request(`/api/modules/${module}/intake/files`, 'POST', Buffer.from(body), { 'x-file-name': encodeURIComponent(name), 'content-type': 'application/octet-stream', ...extra });
const files = async (c, module) => (await c.request(`/api/modules/${module}/intake`)).value.files;
const ready = (c, module) => until(async () => (await files(c, module)).every(f => f.extract !== 'pending'));
const stageOf = (r, id) => r.stages.find(s => s.id === id);
const finish = (child, code = 0) => { child.stdout.end(); child.stderr.end(); child.emit('exit', code); };

// Fake coding-agent CLI; `behaviour` acts inside the prepared workspace.
function fakeSpawn(behaviour) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.stdin.on('data', () => {}); calls.push({ bin, args, opts });
    child.kill = () => { setImmediate(() => child.emit('exit', null)); return true; };
    setImmediate(() => behaviour({ opts, child }));
    return child;
  };
  return { spawn, calls };
}
const writeInsights = (cwd, body) => fs.writeFileSync(path.join(cwd, 'output', 'insights.json'), JSON.stringify(body));
const waitJob = (c, module, id) => until(async () => { const j = (await c.request(`/api/modules/${module}/agent/jobs/${id}`)).value; return j.status !== 'running' ? j : null; });
const jobStart = (c, module, body = {}) => c.request(`/api/modules/${module}/agent/jobs`, 'POST', { agent: 'claude', kind: 'analyze', ...body });

async function world(t, behaviour = ({ child }) => finish(child), extra = {}) {
  const fake = fakeSpawn(behaviour);
  const f = await boot(t, { bootstrap: ADMIN, agentOptions: { spawn: fake.spawn, probe }, ...extra });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Finance' })).status, 201);
  return { f, fake, admin };
}

test('duplicate upload: identical bytes (even renamed) create no record, no extraction, and answer duplicateOf; same name with new bytes is a new source', async t => {
  const calls = [];
  const exec = async (file, args) => { calls.push(file); throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  const { f, admin } = await world(t, undefined, { exec });
  const video = Buffer.from('pretend this is a walkthrough video');
  const first = await up(admin, 'billing', 'walkthrough.mp4', video, { 'x-file-note': 'first note' });
  assert.equal(first.status, 201); assert.equal(first.value.sha256, sha(video));
  await ready(admin, 'billing');
  const before = calls.length;
  const again = await up(admin, 'billing', 'renamed-copy.mp4', video, { 'x-file-note': encodeURIComponent('second note') });
  assert.equal(again.status, 200);
  assert.equal(again.value.duplicate, true); assert.equal(again.value.duplicateOf, first.value.id); assert.equal(again.value.id, first.value.id);
  assert.equal(again.value.message, 'This file was already uploaded as walkthrough.mp4.');
  assert.match(again.value.note, /first note/); assert.match(again.value.note, /second note/);
  await wait(150);
  const list = await files(admin, 'billing');
  assert.equal(list.length, 1); assert.equal(calls.length, before, 'no extraction ran for the duplicate');
  assert.ok(f.store.auditLog({ scopeType: 'module', scopeId: 'billing' }).some(e => e.action === 'intake.duplicate' && e.detail.duplicateOf === first.value.id));
  assert.equal(fs.readdirSync(path.join(f.directory, 'intake', 'billing')).filter(n => n.endsWith('.part')).length, 0);
  // a duplicate without a note leaves the record untouched
  const quiet = await up(admin, 'billing', 'copy2.mp4', video);
  assert.equal(quiet.status, 200); assert.match(quiet.value.note, /first note/); assert.ok(!/copy2/.test(quiet.value.note));
  // same name, different bytes: a new source
  const changed = await up(admin, 'billing', 'walkthrough.mp4', Buffer.from('a different recording'));
  assert.equal(changed.status, 201); assert.notEqual(changed.value.id, first.value.id); assert.notEqual(changed.value.sha256, first.value.sha256);
  assert.equal((await files(admin, 'billing')).length, 2);
  // the same bytes in ANOTHER module are not a duplicate
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Other', prefix: 'OTH', area: 'X' })).status, 201);
  assert.equal((await up(admin, 'other', 'walkthrough.mp4', video)).status, 201);
});

test('startup resume: pending extractions are re-queued one at a time, partial frames are cleared, failures are marked with a reason; older uploads are fingerprinted', async t => {
  const dir = tmp(t), store = openStore(dir);
  t.after(() => { try { store.close(); } catch { /* already closed */ } });
  store.saveModule({ id: 'billing', productId: 'augastam', name: 'Billing', prefix: 'BIL', area: 'F', adapter: null, config: { bases: {}, requirements: [] } });
  const folder = path.join(dir, 'intake', 'billing'); fs.mkdirSync(folder, { recursive: true });
  const mk = (id, name, kind, bytes) => { fs.writeFileSync(path.join(folder, `${id}${path.extname(name)}`), bytes);
    const rec = { id, moduleId: 'billing', name, storedAs: `${id}${path.extname(name)}`, size: bytes.length, kind, type: '', uploadedBy: 'u', uploadedAt: new Date().toISOString(), note: '', extract: 'pending', chars: 0 }; store.saveIntakeFile(rec); return rec; };
  const v1 = mk('v1', 'one.mp4', 'video', 'video one'), v2 = mk('v2', 'two.mp4', 'video', 'video two');
  mk('bad', 'broken.xlsx', 'sheet', 'not a workbook');
  store.saveIntakeFile({ id: 'gone', moduleId: 'billing', name: 'gone.txt', storedAs: 'gone.txt', size: 1, kind: 'text', extract: 'pending', chars: 0, note: '' });
  store.saveIntakeFile({ id: 'done', moduleId: 'billing', name: 'done.txt', storedAs: 'done.txt', size: 4, kind: 'text', extract: 'ok', chars: 4, note: '' });
  fs.writeFileSync(path.join(folder, 'done.txt'), 'done');
  const stale = path.join(folder, 'v1-frames'); fs.mkdirSync(stale); fs.writeFileSync(path.join(stale, 'leftover.jpg'), 'x');
  let active = 0, peak = 0; const probed = [];
  const exec = async (file, args) => {
    active++; peak = Math.max(peak, active); await wait(20);
    try {
      if (file === 'ffprobe') { probed.push(args.at(-1)); return { stdout: '30\n', stderr: '' }; }
      if (file === 'ffmpeg' && args.includes('-i')) { const out = args.at(-1); fs.writeFileSync(path.join(path.dirname(out), 'frame-001.jpg'), 'jpg'); return { stdout: '', stderr: '[Parsed_showinfo_1] n: 0 pts_time:3 pos:1\n' }; }
      if (file === 'ffmpeg' || file === 'ffprobe') return { stdout: '', stderr: '' };
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    } finally { active--; }
  };
  const intake = createIntake({ dataDir: dir, store, exec });
  assert.equal(await intake.backfill(), 4); // 'gone' has no file on disk -> v1, v2, bad, done
  assert.equal(store.intakeFile('billing', 'v1').sha256, sha('video one'));
  assert.equal(await intake.backfill(), 0); // idempotent
  await intake.resume();
  assert.equal(peak, 1, 'extractions run sequentially');
  const after = Object.fromEntries(store.intakeFiles('billing').map(f => [f.id, f]));
  assert.equal(after.v1.extract, 'partial'); assert.equal(after.v2.extract, 'partial');
  assert.ok(!fs.existsSync(path.join(stale, 'leftover.jpg')) && fs.existsSync(path.join(stale, 'frame-001.jpg')), 'partial frames folder was rebuilt');
  assert.equal(after.bad.extract, 'error'); assert.match(after.bad.extractNote, /Could not read this file/);
  assert.equal(after.gone.extract, 'error'); assert.match(after.gone.extractNote, /stored file is missing/);
  assert.equal(after.done.extract, 'ok'); assert.ok(after.v1.processedAt && after.v1.extractorVersion);
  assert.equal(await intake.resume(), 0); // nothing left pending
  void v1; void v2;
});

test('startup resume through the portal: a source left pending is processed after a restart, and the old upload gets its fingerprint and is deduplicated', async t => {
  const dir = tmp(t), environments = [{ id: 'local', name: 'Local', url: 'http://application.invalid', authDir: path.join(dir, 'auth') }];
  const mkPortal = async () => { const p = createPortal({ dataDir: dir, environments, bootstrap: ADMIN }); await new Promise(r => p.server.listen(0, '127.0.0.1', r)); return p; };
  const login = async p => { let cookie = ''; const base = `http://127.0.0.1:${p.server.address().port}`;
    const request = async (route, method = 'GET', body, headers = {}) => { const res = await fetch(base + route, { method, headers: { ...(body === undefined || Buffer.isBuffer(body) ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
      const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]; return { status: res.status, value: await res.json() }; };
    assert.equal((await request('/api/login', 'POST', ADMIN)).status, 200); return { request }; };
  const p1 = await mkPortal(); let closed1 = false; t.after(async () => { if (!closed1) await p1.close(); });
  const a1 = await login(p1);
  assert.equal((await a1.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'F' })).status, 201);
  const body = 'Invoice total must be at least 1.\n';
  assert.equal((await up(a1, 'billing', 'rules.txt', body)).status, 201);
  await ready(a1, 'billing');
  const rec = p1.store.intakeFiles('billing')[0];
  const { sha256, ...legacy } = rec; // an upload from before fingerprints existed, caught mid-extraction
  p1.store.saveIntakeFile({ ...legacy, extract: 'pending', chars: 0, extractNote: '' });
  await p1.close(); closed1 = true;
  const p2 = await mkPortal(); t.after(() => p2.close());
  const a2 = await login(p2);
  const done = await until(async () => { const [x] = await files(a2, 'billing'); return x.extract === 'ok' && x.sha256 ? x : null; });
  assert.equal(done.sha256, sha(body)); assert.ok(done.chars > 0);
  const dup = await up(a2, 'billing', 'copy.txt', body);
  assert.equal(dup.status, 200); assert.equal(dup.value.duplicateOf, rec.id);
});

test('interrupted jobs: a job running at restart becomes interrupted with its log kept; Retry starts a linked job; history survives', async t => {
  const dir = tmp(t), environments = [{ id: 'local', name: 'Local', url: 'http://application.invalid', authDir: path.join(dir, 'auth') }];
  let mode = 'hang';
  const fake = fakeSpawn(({ opts, child }) => { if (mode === 'hang') return; writeInsights(opts.cwd, { summary: 'Retried', rules: [{ text: 'Total must be at least 1', source: 'rules.txt' }], cases: [] }); finish(child); });
  const mkPortal = async () => { const p = createPortal({ dataDir: dir, environments, bootstrap: ADMIN, agentOptions: { spawn: fake.spawn, probe } }); await new Promise(r => p.server.listen(0, '127.0.0.1', r)); return p; };
  const login = async (p, who = ADMIN) => { let cookie = ''; const base = `http://127.0.0.1:${p.server.address().port}`;
    const request = async (route, method = 'GET', body, headers = {}) => { const res = await fetch(base + route, { method, headers: { ...(body === undefined || Buffer.isBuffer(body) ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
      const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]; return { status: res.status, value: await res.json() }; };
    assert.equal((await request('/api/login', 'POST', who)).status, 200); return { request }; };
  const p1 = await mkPortal(); let closed1 = false; t.after(async () => { if (!closed1) await p1.close(); });
  const a1 = await login(p1);
  assert.equal((await a1.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'F' })).status, 201);
  assert.equal((await up(a1, 'billing', 'rules.txt', 'Invoice total must be at least 1.\n')).status, 201);
  await ready(a1, 'billing');
  const started = await jobStart(a1, 'billing', { fileIds: undefined });
  assert.equal(started.status, 202);
  const jid = started.value.id;
  await until(async () => (await a1.request(`/api/modules/billing/agent/jobs/${jid}`)).value.log.some(l => /Started/.test(l.text)));
  await p1.close(); closed1 = true;
  // simulate a hard crash instead of a clean stop: the stored state still says "running"
  const raw = new DatabaseSync(path.join(dir, 'portal.sqlite'));
  raw.exec("UPDATE agent_jobs SET document=json_set(document,'$.status','running','$.message','x','$.finishedAt',null)"); raw.close();
  const p2 = await mkPortal(); let closed2 = false; t.after(async () => { if (!closed2) await p2.close(); });
  const a2 = await login(p2);
  const old = (await a2.request(`/api/modules/billing/agent/jobs/${jid}`)).value;
  assert.equal(old.status, 'interrupted'); assert.equal(old.message, 'The portal restarted while this job was running. Retry it.');
  assert.ok(old.log.some(l => /Started/.test(l.text)), 'log is kept');
  assert.deepEqual((await a2.request('/api/modules/billing/agent/jobs')).value.map(j => [j.id, j.status]), [[jid, 'interrupted']]);
  assert.equal((await a2.request('/api/agent/status')).value.busy, null);
  // retry: same agent/kind/files, linked
  mode = 'ok';
  const retry = await a2.request(`/api/modules/billing/agent/jobs/${jid}/retry`, 'POST', {});
  assert.equal(retry.status, 202, JSON.stringify(retry.value)); assert.equal(retry.value.retryOf, jid);
  const job = await waitJob(a2, 'billing', retry.value.id);
  assert.equal(job.status, 'done', job.message); assert.equal(job.retryOf, jid); assert.equal(job.agent, 'claude'); assert.equal(job.kind, 'analyze');
  assert.equal((await a2.request(`/api/modules/billing/agent/jobs/${retry.value.id}/retry`, 'POST', {})).status, 409); // only interrupted/error jobs
  assert.equal((await a2.request('/api/modules/billing/agent/jobs/nope/retry', 'POST', {})).status, 404);
  assert.ok(p2.store.auditLog({ scopeType: 'module', scopeId: 'billing' }).some(e => e.action === 'agent.retry' && e.detail.retryOf === jid));
  // history survives yet another restart
  await p2.close(); closed2 = true; const p3 = await mkPortal(); t.after(() => p3.close());
  const a3 = await login(p3);
  const history = (await a3.request('/api/modules/billing/agent/jobs')).value;
  assert.deepEqual(history.map(j => j.status).sort(), ['done', 'interrupted']);
  assert.equal(history.find(j => j.status === 'done').result.version, 1);
});

test('retry needs the same permission as starting a job (viewer 403) and hidden modules answer 404', async t => {
  const { f, admin } = await world(t, ({ child }) => finish(child, 1));
  assert.equal((await up(admin, 'billing', 'rules.txt', 'Total must be at least 1.\n')).status, 201); await ready(admin, 'billing');
  const viewer = await makeUser(admin, 'vic', 'viewer'), outsider = await makeUser(admin, 'ned', 'member');
  const v = await signedIn(f, 'vic', viewer.password), n = await signedIn(f, 'ned', outsider.password);
  const j = (await jobStart(admin, 'billing')).value; const done = await waitJob(admin, 'billing', j.id);
  assert.equal(done.status, 'error');
  assert.equal((await v.request(`/api/modules/billing/agent/jobs/${j.id}/retry`, 'POST', {})).status, 403);
  for (const [method, route, body] of [['POST', `/api/modules/billing/agent/jobs/${j.id}/retry`, {}], ['GET', '/api/modules/billing/readiness'], ['GET', '/api/modules/billing/setup'], ['PUT', '/api/modules/billing/setup', { moduleUrl: '/x', variants: [], loginProfileId: 'local' }],
    ['GET', '/api/modules/billing/insights/history'], ['POST', '/api/modules/billing/ai-generate', {}]]) {
    assert.equal((await n.request(route, method, body)).status, 404, `${method} ${route}`);
  }
  assert.equal((await admin.request('/api/modules/nope/readiness')).status, 404);
  assert.equal((await admin.request(`/api/modules/billing/agent/jobs/${j.id}/retry`, 'POST', {})).status, 202); // error jobs can be retried
});

test('insights are versioned: version, basedOn, coveredSources, changeSummary, and a newest-first history', async t => {
  const { f, admin } = await world(t);
  const a = Buffer.from('Phone must be 10 digits.\n');
  const fa = (await up(admin, 'billing', 'a.txt', a)).value; await ready(admin, 'billing');
  const put = body => admin.request('/api/modules/billing/insights', 'PUT', body);
  const v1 = await put({ summary: 'One', fields: [{ name: 'Phone', type: 'text' }], rules: ['Phone is 10 digits'], cases: [{ title: 'C1', steps: [{ action: 'a', expected: 'b' }] }] });
  assert.equal(v1.status, 201); assert.equal(v1.value.version, 1);
  const fb = (await up(admin, 'billing', 'b.txt', 'Email must be unique.\n')).value; await ready(admin, 'billing');
  const v2 = await put({ summary: 'Two', fields: [{ name: 'Phone', type: 'text' }, { name: 'Email', type: 'text' }], rules: ['Phone is 10 digits', 'Email is unique'], cases: [{ title: 'C1', steps: [{ action: 'a', expected: 'b' }] }, { title: 'C2', steps: [{ action: 'a', expected: 'b' }] }] });
  assert.equal(v2.value.version, 2);
  assert.deepEqual([v2.value.changeSummary.addedFields, v2.value.changeSummary.addedRules, v2.value.changeSummary.addedCases], [1, 1, 1]); // C1 is a duplicate title, C2 is new
  const v3 = await put({ summary: 'Three', cases: [] }); assert.equal(v3.value.version, 3);
  const history = (await admin.request('/api/modules/billing/insights/history')).value;
  assert.deepEqual(history.map(h => h.version), [3, 2, 1]);
  assert.deepEqual(history.map(h => h.basedOn), [v2.value.id, v1.value.id, null]);
  assert.deepEqual(Object.keys(history[0]).sort(), ['basedOn', 'changeSummary', 'counts', 'createdAt', 'createdBy', 'id', 'mode', 'version']);
  assert.equal(history[1].counts.fields, 2); assert.equal(history[2].mode, 'assistant');
  const latest = (await admin.request('/api/modules/billing/insights')).value;
  assert.equal(latest.id, v3.value.id); assert.equal(latest.version, 3); assert.equal(latest.basedOn, v2.value.id);
  assert.deepEqual(latest.coveredSources.map(s => s.name).sort(), ['a.txt', 'b.txt']);
  assert.ok(latest.coveredSources.every(s => /^[0-9a-f]{64}$/.test(s.sha256)));
  const covered1 = f.store.insightsHistory('billing').at(-1).coveredSources;
  assert.deepEqual(covered1, [{ fileId: fa.id, sha256: sha(a), name: 'a.txt' }]); // v1 only knew about a.txt
  void fb;
});

test('incremental analysis: previous insights and per-source state go to the agent, a brief tells it to merge, nothing-new is refused unless forced', async t => {
  const seen = [];
  let n = 0;
  const { f, admin } = await world(t, ({ opts, child }) => {
    const read = rel => { try { return fs.readFileSync(path.join(opts.cwd, rel), 'utf8'); } catch { return null; } };
    seen.push({ manifest: JSON.parse(read('input/MANIFEST.json')), previous: read('input/previous-insights.json') && JSON.parse(read('input/previous-insights.json')), brief: read('INSTRUCTIONS.md') });
    n++;
    writeInsights(opts.cwd, { summary: `Run ${n}`, fields: [{ name: `Field${n}`, type: 'text', required: false, description: '', source: 'a.txt' }], rules: [{ text: 'Phone is 10 digits', source: 'a.txt' }], suggestedSetup: { moduleUrl: '/billing/invoices', variants: ['Tab A', 'Tab B'] }, cases: [] });
    finish(child);
  });
  const fa = (await up(admin, 'billing', 'a.txt', 'Phone must be 10 digits.\n')).value; await ready(admin, 'billing');
  const run1 = await waitJob(admin, 'billing', (await jobStart(admin, 'billing')).value.id);
  assert.equal(run1.status, 'done', run1.message);
  assert.equal(seen[0].previous, null); assert.deepEqual(seen[0].manifest.map(m => m.state), ['new']); assert.ok(!/MERGE/.test(seen[0].brief));
  assert.match(seen[0].brief, /suggestedSetup/);
  // nothing changed: refused, with the version number
  const refused = await jobStart(admin, 'billing');
  assert.equal(refused.status, 409); assert.equal(refused.value.error, 'Nothing new to analyse since version 1.');
  assert.equal((await admin.request('/api/modules/billing/agent/jobs')).value.length, 1, 'no job was created');
  // force runs anyway and everything is "unchanged"
  const forced = await jobStart(admin, 'billing', { force: true });
  assert.equal(forced.status, 202); assert.equal((await waitJob(admin, 'billing', forced.value.id)).status, 'done');
  assert.equal(seen[1].previous.version, 1); assert.equal(seen[1].previous.id, run1.result.insightId); assert.deepEqual(seen[1].manifest.map(m => m.state), ['unchanged']);
  for (const phrase of [/MERGE/, /keep what is still true/i, /correct what the new/i, /add what is new/i, /never drop provenance/i, /previous-insights\.json/]) assert.match(seen[1].brief, phrase);
  // a new file and a same-name file with different bytes
  assert.equal((await up(admin, 'billing', 'b.txt', 'Email must be unique.\n')).status, 201);
  assert.equal((await up(admin, 'billing', 'a.txt', 'Phone must be exactly 11 digits.\n')).status, 201);
  await ready(admin, 'billing');
  const r = (await admin.request('/api/modules/billing/readiness')).value;
  assert.equal(stageOf(r, 'insights').status, 'stale');
  const third = await waitJob(admin, 'billing', (await jobStart(admin, 'billing')).value.id);
  assert.equal(third.status, 'done', third.message);
  const states = Object.fromEntries(seen[2].manifest.map(m => [`${m.name}:${m.sha256?.slice(0, 4)}`, m.state]));
  assert.deepEqual(seen[2].manifest.map(m => [m.name, m.state]).sort(), [['a.txt', 'changed'], ['a.txt', 'unchanged'], ['b.txt', 'new']]);
  assert.equal(seen[2].manifest.find(m => m.fileId === fa.id).state, 'unchanged'); void states;
  // saved as version 3, based on 2, covering all three files, with the change summary and the suggested setup (never applied)
  const latest = (await admin.request('/api/modules/billing/insights')).value;
  assert.equal(latest.version, 3); assert.equal(latest.coveredSources.length, 3); assert.equal(latest.changeSummary.addedFields, 1);
  assert.deepEqual(latest.suggestedSetup, { moduleUrl: '/billing/invoices', variants: ['Tab A', 'Tab B'] });
  assert.equal(f.store.module('billing').setup, undefined);
  assert.equal((await admin.request('/api/modules/billing/setup')).value.suggestedSetup.moduleUrl, '/billing/invoices');
  assert.equal(stageOf((await admin.request('/api/modules/billing/readiness')).value, 'insights').status, 'ready');
  assert.match(stageOf((await admin.request('/api/modules/billing/readiness')).value, 'setup').detail, /suggests \/billing\/invoices/);
});

test('a suggested setup with an invalid path is dropped, never an error', async t => {
  const { admin } = await world(t);
  const saved = await admin.request('/api/modules/billing/insights', 'PUT', { summary: 'S', suggestedSetup: { moduleUrl: 'https://evil.test/x', variants: ['ok'] }, cases: [] });
  assert.equal(saved.status, 201);
  assert.deepEqual((await admin.request('/api/modules/billing/insights')).value.suggestedSetup, { variants: ['ok'] });
});

test('setup: validated path, variants and login profile; lead-only; audited', async t => {
  const { f, admin } = await world(t);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Mir', prefix: 'MIR', area: 'X', productId: 'miracle' })).status, 201);
  const viewer = await makeUser(admin, 'vic', 'viewer'), ba = await makeUser(admin, 'bob', 'ba');
  const v = await signedIn(f, 'vic', viewer.password), b = await signedIn(f, 'bob', ba.password);
  const put = (c, body, m = 'billing') => c.request(`/api/modules/${m}/setup`, 'PUT', body);
  const good = { moduleUrl: '/billing/invoices', variants: ['Cash', 'Credit'], loginProfileId: 'local' };
  assert.deepEqual((await admin.request('/api/modules/billing/setup')).value, { setup: null, suggestedSetup: null });
  for (const bad of ['billing', '//evil.test/x', 'https://evil.test/x', '/a/../b', '/a/..', '/a\\b', '/a\u0000b', '/a\nb', '/%2e%2e/etc', '/a b', '', '/' + 'x'.repeat(200), 5, '/a://b', null]) {
    assert.equal((await put(admin, { ...good, moduleUrl: bad })).status, 400, `moduleUrl ${JSON.stringify(bad)}`);
  }
  assert.equal((await put(admin, { ...good, variants: Array.from({ length: 21 }, (_, i) => `V${i}`) })).status, 400);
  assert.equal((await put(admin, { ...good, variants: ['x'.repeat(61)] })).status, 400);
  assert.equal((await put(admin, { ...good, variants: [''] })).status, 400);
  assert.equal((await put(admin, { ...good, variants: 'Cash' })).status, 400);
  assert.equal((await put(admin, { ...good, loginProfileId: 'nope' })).status, 400);
  assert.equal((await put(admin, { ...good, loginProfileId: '' })).status, 400);
  assert.equal((await put(admin, good, 'miracle-mir')).status, 400, 'a profile of another product is refused');
  // permissions: viewer (can see) and ba (no module.settings) cannot save
  assert.equal((await put(v, good)).status, 403); assert.equal((await put(b, good)).status, 403);
  assert.equal((await v.request('/api/modules/billing/setup')).status, 200);
  const saved = await put(admin, { ...good, variants: ['Cash', 'cash', 'Credit'], confirmedBy: 'forged', confirmedAt: '2000-01-01' });
  assert.equal(saved.status, 200);
  const s = saved.value.setup;
  assert.deepEqual([s.moduleUrl, s.variants, s.loginProfileId, s.confirmedBy], ['/billing/invoices', ['Cash', 'Credit'], 'local', 'root']);
  assert.ok(Date.now() - Date.parse(s.confirmedAt) < 10000);
  assert.deepEqual((await admin.request('/api/modules/billing/setup')).value.setup, s);
  assert.deepEqual(f.store.module('billing').setup, s);
  assert.ok(f.store.auditLog({ scopeType: 'module', scopeId: 'billing' }).some(e => e.action === 'module.setup' && e.actor === 'root' && e.detail.moduleUrl === '/billing/invoices'));
  // other module edits keep the setup
  const m = f.store.module('billing');
  assert.equal((await admin.request('/api/modules/billing', 'PUT', { name: 'Billing 2', area: 'Finance', version: m.version })).status, 200);
  assert.deepEqual(f.store.module('billing').setup, s);
});

test('readiness: a fresh module, then after each stage', async t => {
  const qaRoot = tmp(t, 'augastam-qa-'), specRoot = tmp(t, 'augastam-spec-');
  const { f, admin } = await world(t, undefined, { qaRoot });
  const get = async () => (await admin.request('/api/modules/billing/readiness')).value;
  let r = await get();
  assert.deepEqual(r.stages.map(s => s.id), ['sources', 'insights', 'cases', 'setup', 'discovery', 'automation', 'smoke']);
  assert.deepEqual(r.stages.map(s => s.status), ['missing', 'missing', 'missing', 'missing', 'missing', 'missing', 'missing']);
  assert.ok(r.stages.every(s => s.label && s.detail)); assert.equal(stageOf(r, 'sources').action.id, 'upload');
  assert.equal(r.canGenerateAi, false); assert.equal(r.canProposeAutomation, false); assert.ok(r.blockers.length === 3 && r.proposalBlockers.length === 5);
  // sources: pending -> running, unreadable -> failed, readable -> ready
  assert.equal((await up(admin, 'billing', 'clip.mp4', 'not a video')).status, 201); await ready(admin, 'billing');
  assert.equal(stageOf(await get(), 'sources').status, 'failed');
  const txt = (await up(admin, 'billing', 'rules.txt', 'Total must be at least 1.\n')).value; await ready(admin, 'billing');
  r = await get(); assert.equal(stageOf(r, 'sources').status, 'ready'); assert.equal(stageOf(r, 'insights').action.id, 'analyse');
  assert.equal((await admin.request('/api/modules/billing/insights', 'PUT', { summary: 'S', cases: [{ title: 'Draft one', steps: [{ action: 'a', expected: 'b' }] }] })).status, 201);
  r = await get(); assert.equal(stageOf(r, 'insights').status, 'ready'); assert.match(stageOf(r, 'insights').detail, /Version 1/);
  assert.equal(stageOf(r, 'cases').status, 'missing'); assert.match(stageOf(r, 'cases').detail, /1 draft/);
  assert.equal((await admin.request('/api/modules/billing/cases', 'POST', { id: 'BIL-900', title: 'Approved one', category: 'c', mode: 'manual', steps: [{ action: 'a', expected: 'b' }] })).status, 201);
  assert.equal(stageOf(await get(), 'cases').status, 'ready');
  assert.equal(stageOf(await get(), 'setup').status, 'missing');
  assert.equal((await admin.request('/api/modules/billing/setup', 'PUT', { moduleUrl: '/billing', variants: [], loginProfileId: 'local' })).status, 200);
  r = await get(); assert.equal(stageOf(r, 'setup').status, 'ready'); assert.equal(stageOf(r, 'discovery').status, 'missing');
  // discovery newer than the setup -> ready; a setup confirmed later makes it stale
  fs.mkdirSync(path.join(qaRoot, 'billing', 'discovery'), { recursive: true });
  const disc = path.join(qaRoot, 'billing', 'discovery', 'fields-default.json'); fs.writeFileSync(disc, '{}');
  r = await get(); assert.equal(stageOf(r, 'discovery').status, 'ready'); assert.equal(r.canProposeAutomation, true);
  assert.equal(stageOf(r, 'automation').action.id, 'propose-automation');
  fs.utimesSync(disc, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
  r = await get(); assert.equal(stageOf(r, 'discovery').status, 'stale'); assert.equal(r.canProposeAutomation, false);
  fs.utimesSync(disc, new Date(), new Date());
  // automation: connect the adapter (registry adapter + spec file) -> ready, AI generation unlocks
  const m = f.store.module('billing');
  assert.equal(stageOf(await get(), 'automation').status, 'missing');
  assert.equal((await admin.request('/api/modules/billing', 'PUT', { name: m.name, area: m.area, adapter: 'registration', version: m.version })).status, 200);
  r = await get(); assert.equal(stageOf(r, 'automation').status, 'ready'); assert.equal(r.canGenerateAi, true); assert.deepEqual(r.blockers, []);
  assert.equal(stageOf(r, 'smoke').status, 'missing'); assert.equal(stageOf(r, 'smoke').action.id, 'run-smoke');
  // smoke: a finished automated run with a passed case on a profile of the same product
  f.store.saveRun({ id: 'run-1', name: 'smoke', kind: 'tests', mode: 'automated', productId: 'augastam', environmentId: 'local', module: { id: 'billing' }, status: 'passed', cases: [{ id: 'BIL-900', mode: 'automated', action: 'fill' }], results: [{ id: 'BIL-900', status: 'PASS' }], createdAt: new Date().toISOString() });
  assert.equal(stageOf(await get(), 'smoke').status, 'ready');
  // a source added after the analysis -> insights are stale (a warning only, generation stays possible)
  assert.equal((await up(admin, 'billing', 'more.txt', 'Tax must be shown separately.\n')).status, 201); await ready(admin, 'billing');
  r = await get(); assert.equal(stageOf(r, 'insights').status, 'stale'); assert.equal(stageOf(r, 'insights').action.id, 'update-insights');
  assert.equal(r.canGenerateAi, true); assert.equal(r.warnings.length, 1);
  void txt; void specRoot;
});

test('readiness: a missing spec file is a failed automation stage; Miracle is blocked with the login-automation reason; a running job shows as running', async t => {
  const specRoot = tmp(t, 'augastam-spec-');
  const { f, admin } = await world(t, () => {}, { specRoot });
  const m = f.store.module('billing');
  assert.equal((await admin.request('/api/modules/billing', 'PUT', { name: m.name, area: m.area, adapter: 'registration', version: m.version })).status, 200);
  assert.equal(stageOf((await admin.request('/api/modules/billing/readiness')).value, 'automation').status, 'failed');
  assert.equal((await up(admin, 'billing', 'rules.txt', 'Total must be at least 1.\n')).status, 201); await ready(admin, 'billing');
  const job = await jobStart(admin, 'billing'); assert.equal(job.status, 202);
  assert.equal(stageOf((await admin.request('/api/modules/billing/readiness')).value, 'insights').status, 'running');
  await admin.request(`/api/modules/billing/agent/jobs/${job.value.id}/cancel`, 'POST', {});
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Mir', prefix: 'MIR', area: 'X', productId: 'miracle' })).status, 201);
  const r = (await admin.request('/api/modules/miracle-mir/readiness')).value;
  for (const id of ['discovery', 'automation', 'smoke']) { assert.equal(stageOf(r, id).status, 'blocked'); assert.equal(stageOf(r, id).detail, 'Application login automation for this product has not been built yet'); }
  assert.equal(r.canGenerateAi, false); assert.equal(r.canProposeAutomation, false);
});

test('readiness is pure: stage rules for a module with an adapter and no reference exemption', () => {
  const base = { module: { id: 'x' }, product: { id: 'augastam' } };
  const r = readiness({ ...base, sources: [{ id: 'f', name: 'a.png', kind: 'image', extract: 'unsupported' }] });
  assert.equal(stageOf(r, 'sources').status, 'ready', 'a screenshot is a usable source');
  const pending = readiness({ ...base, sources: [{ id: 'f', name: 'v.mp4', kind: 'video', extract: 'pending' }] });
  assert.equal(stageOf(pending, 'sources').status, 'running');
  assert.equal(stageOf(readiness({ ...base, sources: [{ id: 'f', name: 'v.mp4', kind: 'video', extract: 'partial' }] }), 'sources').status, 'ready');
  const failedAnalysis = readiness({ ...base, sources: [{ id: 'f', name: 'a.txt', kind: 'text', extract: 'ok' }], jobs: [{ kind: 'analyze', status: 'interrupted', startedAt: '2026-01-01', message: 'The portal restarted while this job was running. Retry it.' }] });
  assert.equal(stageOf(failedAnalysis, 'insights').status, 'failed');
});

test('Registration is the reference module: every stage is ready and AI generation is not locked', async t => {
  const { f, admin } = await world(t);
  const r = (await admin.request('/api/modules/registration/readiness')).value;
  assert.deepEqual(r.stages.map(s => s.status), ['ready', 'ready', 'ready', 'ready', 'ready', 'ready', 'ready']);
  assert.equal(r.canGenerateAi, true); assert.equal(r.canProposeAutomation, true); assert.deepEqual(r.blockers, []);
  assert.match(stageOf(r, 'discovery').detail, /present/); // qa/modules/registration/discovery has files in this repository
  const ai = await admin.request('/api/modules/registration/ai-generate', 'POST', { count: 2, mode: 'automated' });
  assert.equal(ai.status, 200, JSON.stringify(ai.value)); assert.equal(ai.value.drafts.length, 2); assert.deepEqual(ai.value.warnings, []);
  void f;
});

test('Registration without discovery files still reports the discovery stage as built in', async t => {
  const qaRoot = tmp(t, 'augastam-qa-');
  const { admin } = await world(t, undefined, { qaRoot });
  const r = (await admin.request('/api/modules/registration/readiness')).value;
  assert.equal(stageOf(r, 'discovery').status, 'ready'); assert.equal(stageOf(r, 'discovery').detail, 'Built in.');
  assert.equal(r.canGenerateAi, true);
});

test('AI generation is gated with the checklist, then works; stale insights only warn', async t => {
  const { f, admin } = await world(t);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Reg', prefix: 'REG', area: 'Front desk', adapter: 'registration' })).status, 201);
  const gen = () => admin.request('/api/modules/reg/ai-generate', 'POST', { count: 2, mode: 'automated' });
  let blocked = await gen();
  assert.equal(blocked.status, 409); assert.match(blocked.value.error, /Sources/); assert.match(blocked.value.error, /Insights/);
  assert.equal(blocked.value.readiness.canGenerateAi, false); assert.equal(blocked.value.readiness.stages.length, 7);
  assert.equal((await up(admin, 'reg', 'rules.txt', 'Phone must be 10 digits.\n')).status, 201); await ready(admin, 'reg');
  blocked = await gen(); assert.equal(blocked.status, 409); assert.match(blocked.value.error, /Insights/); assert.ok(!/Sources:/.test(blocked.value.error));
  assert.equal((await admin.request('/api/modules/reg/insights', 'PUT', { summary: 'S', cases: [] })).status, 201);
  let ok = await gen();
  assert.equal(ok.status, 200, JSON.stringify(ok.value)); assert.equal(ok.value.drafts.length, 2); assert.deepEqual(ok.value.warnings, []);
  assert.equal((await up(admin, 'reg', 'new.txt', 'Another rule.\n')).status, 201); await ready(admin, 'reg');
  ok = await gen(); assert.equal(ok.status, 200); assert.equal(ok.value.warnings.length, 1); assert.match(ok.value.warnings[0], /older than 1 uploaded source/);
  // manual case creation, intake and analysis are never gated
  assert.equal((await admin.request('/api/modules/reg/cases', 'POST', { id: 'REG-901', title: 'Manual', category: 'c', mode: 'manual', steps: [{ action: 'a', expected: 'b' }] })).status, 201);
  assert.equal((await up(admin, 'reg', 'third.txt', 'Third.\n')).status, 201);
  void f;
});
