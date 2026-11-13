import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { boot, signedIn, makeUser, until } from './support.mjs';
import { createAiPolicy, friendlyModel } from '../ai-policy.mjs';
import { createAgentRunner } from '../agent.mjs';

const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const probe = async id => ({ id, label: id, available: true, version: '9.9.9' });
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-policy-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

function fakeSpawn(behaviour) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    calls.push({ bin, args, opts }); child.stdin.on('data', () => {});
    child.kill = () => { setImmediate(() => child.emit('exit', null)); return true; };
    setImmediate(() => behaviour({ args, opts, child }));
    return child;
  };
  return { spawn, calls };
}
const resultLine = (extra = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 4, total_cost_usd: 0.0123, usage: { input_tokens: 10, cache_creation_input_tokens: 5000, cache_read_input_tokens: 2000, output_tokens: 700 }, modelUsage: { 'claude-haiku-5-5': {} }, ...extra }) + '\n';
const end = (child, code = 0) => { child.stdout.end(); child.stderr.end(); child.emit('exit', code); };

test('routing: the lightest capable model, and the preset decides the limits', t => {
  const p = createAiPolicy(tmp(t));
  assert.equal(p.get().preset, 'balanced');
  assert.deepEqual([p.route('analyze', { chars: 1000 }).model, p.route('analyze', { images: 9 }).model, p.route('automation').model], ['sonnet', 'sonnet', 'sonnet']);
  p.save({ preset: 'economy' });
  assert.equal(p.route('analyze', { chars: 5000, images: 0 }).model, 'haiku', 'small text-only reading is cheap');
  assert.equal(p.route('analyze', { chars: 5000, images: 3 }).model, 'sonnet', 'screenshots need a capable model');
  assert.equal(p.route('analyze', { chars: 90_000 }).model, 'sonnet', 'a lot of text needs a capable model');
  assert.equal(p.route('automation').model, 'sonnet', 'writing code never goes to the lightest model');
  assert.equal(p.route('analyze', { chars: 5000 }).maxTurns, 20);
  p.save({ preset: 'quality' });
  const deep = p.route('automation'); assert.deepEqual([deep.model, deep.fallbackModel, deep.maxTurns], ['opus', 'sonnet', 60]);
  assert.equal(p.route('analyze', { chars: 1000 }).model, 'sonnet');
  assert.equal(p.route('analyze', { images: 5 }).model, 'opus');
  // Codex has its own models: nothing is forced unless an administrator names one.
  assert.equal(p.route('analyze', {}, 'codex').model, null);
  p.save({ codexModel: 'gpt-5-codex' }); assert.equal(p.route('analyze', {}, 'codex').model, 'gpt-5-codex');
  assert.equal(friendlyModel('claude-sonnet-5-5'), 'Sonnet'); assert.equal(friendlyModel('claude-haiku-5-5'), 'Haiku');
});

test('settings are validated; the daily limit counts today only and 0 means unlimited; usage is summarised', t => {
  const dir = tmp(t); let clock = new Date('2026-11-13T10:00:00');
  const p = createAiPolicy(dir, { now: () => clock });
  for (const bad of [{ preset: 'turbo' }, { dailyJobLimit: -1 }, { dailyJobLimit: 1.5 }, { dailyJobLimit: 5000 }, { codexModel: 'bad model;rm' }, null]) assert.throws(() => p.save(bad), /./);
  assert.equal(p.save({ dailyJobLimit: 2 }).dailyJobLimit, 2);
  p.record({ jobId: 'a', startedAt: '2026-11-12T10:00:00', inputTokens: 1, outputTokens: 1, costUsd: 1, modelLabel: 'Sonnet' });
  p.checkQuota(); // yesterday does not count
  p.record({ jobId: 'b', startedAt: '2026-11-13T09:00:00', inputTokens: 1000, outputTokens: 100, costUsd: 0.5, modelLabel: 'Haiku' });
  p.record({ jobId: 'c', startedAt: '2026-11-13T09:30:00', inputTokens: 3000, outputTokens: 300, costUsd: 0.25, modelLabel: 'Haiku' });
  assert.throws(() => p.checkQuota(), e => e.status === 429 && /daily limit of 2/.test(e.message));
  p.save({ dailyJobLimit: 0 }); p.checkQuota();
  const u = p.usage(7);
  assert.deepEqual([u.jobs, u.inputTokens, u.costUsd, u.today], [3, 4001, 1.75, 2]);
  assert.equal(u.byModel.Haiku.jobs, 2); assert.equal(u.recent[0].jobId, 'c', 'newest first');
});

test('a routed job gets its model, step limit and lean launch; usage is captured and recorded', async t => {
  const fake = fakeSpawn(({ opts, child }) => {
    fs.writeFileSync(path.join(opts.cwd, 'output', 'insights.json'), JSON.stringify({ summary: 's', fields: [], rules: [{ text: 'Total must be at least 1.', source: 'rules.txt' }], flows: [], edgeCases: [], openQuestions: [], cases: [] }));
    child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-haiku-5-5' }) + '\n'); child.stdout.write(resultLine()); end(child);
  });
  const f = await boot(t, { bootstrap: ADMIN, agentOptions: { spawn: fake.spawn, probe } });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  assert.equal((await admin.request('/api/ai/policy', 'PUT', { preset: 'economy' })).status, 200);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Finance' })).status, 201);
  assert.equal((await admin.request('/api/modules/billing/intake/files', 'POST', Buffer.from('Invoice total must be at least 1.\n'), { 'x-file-name': 'rules.txt', 'content-type': 'application/octet-stream' })).status, 201);
  await until(async () => (await admin.request('/api/modules/billing/intake')).value.files[0].extract === 'ok');
  const start = await admin.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude', kind: 'analyze' });
  assert.equal(start.status, 202, JSON.stringify(start.value));
  const job = await until(async () => { const j = (await admin.request(`/api/modules/billing/agent/jobs/${start.value.id}`)).value; return j.status !== 'running' ? j : null; });
  assert.equal(job.status, 'done', job.message);

  const a = fake.calls[0].args, at = k => a[a.indexOf(k) + 1];
  assert.equal(at('--model'), 'haiku'); assert.equal(at('--max-turns'), '20'); assert.equal(at('--tools'), 'Read,Write,Edit,Glob,Grep');
  assert.ok(a.includes('--strict-mcp-config') && at('--mcp-config') === 'mcp-none.json' && a.includes('--disable-slash-commands') && at('--setting-sources') === 'local');
  assert.equal(at('--fallback-model'), 'sonnet', 'if the light model is overloaded the job falls back to the everyday one');
  assert.ok(fs.existsSync(path.join(fake.calls[0].opts.cwd, 'mcp-none.json')));
  assert.deepEqual([job.plan.preset, job.plan.model, job.plan.maxTurns], ['Economy', 'Haiku', 20]);
  assert.deepEqual([job.usage.model, job.usage.turns, job.usage.inputTokens, job.usage.outputTokens, job.usage.costUsd], ['Haiku', 4, 7010, 700, 0.0123]);

  const policy = (await admin.request('/api/ai/policy')).value;
  assert.deepEqual([policy.preset, policy.usage.jobs, policy.usage.inputTokens, policy.usage.today], ['economy', 1, 7010, 1]);
  assert.deepEqual(policy.presets.map(x => x.id), ['economy', 'balanced', 'quality']);
});

test('hitting the step limit explains what to do; the daily limit blocks the next job', async t => {
  const fake = fakeSpawn(({ child }) => { child.stdout.write(resultLine({ subtype: 'error_max_turns', is_error: true })); end(child, 1); });
  const f = await boot(t, { bootstrap: ADMIN, agentOptions: { spawn: fake.spawn, probe } });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  assert.equal((await admin.request('/api/ai/policy', 'PUT', { dailyJobLimit: 1 })).status, 200);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Finance' })).status, 201);
  assert.equal((await admin.request('/api/modules/billing/intake/files', 'POST', Buffer.from('Total must be at least 1.\n'), { 'x-file-name': 'r.txt', 'content-type': 'application/octet-stream' })).status, 201);
  await until(async () => (await admin.request('/api/modules/billing/intake')).value.files[0].extract === 'ok');
  const start = await admin.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude', kind: 'analyze' });
  const job = await until(async () => { const j = (await admin.request(`/api/modules/billing/agent/jobs/${start.value.id}`)).value; return j.status !== 'running' ? j : null; });
  assert.equal(job.status, 'error'); assert.match(job.message, /used all 30 allowed steps.*Best quality/);
  const second = await admin.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude', kind: 'analyze', force: true });
  assert.equal(second.status, 429); assert.match(second.value.error, /daily limit of 1/);
});

test('only administrators can see or change AI settings, and changes are validated and audited', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const ba = await makeUser(admin, 'bob', 'ba'), b = await signedIn(f, 'bob', ba.password);
  assert.equal((await b.request('/api/ai/policy')).status, 403); assert.equal((await b.request('/api/ai/policy', 'PUT', { preset: 'quality' })).status, 403);
  assert.equal((await admin.request('/api/ai/policy', 'PUT', { preset: 'turbo' })).status, 400);
  assert.equal((await admin.request('/api/ai/policy', 'PUT', { preset: 'quality', dailyJobLimit: 5 })).value.preset, 'quality');
  assert.deepEqual([(await admin.request('/api/ai/policy')).value.preset, (await admin.request('/api/ai/policy')).value.dailyJobLimit], ['quality', 5]);
  assert.ok(f.store.db.prepare("SELECT 1 FROM audit_log WHERE scope_type='system' AND json_extract(document,'$.action')='ai.policy'").get(), 'the change is in the audit log');
});

// ---- token budget while preparing the workspace ------------------------------------------------------
async function prepared(t, { preset, files, insights, contents }) {
  const dir = tmp(t), module = { id: 'billing', name: 'Billing', area: 'Finance', version: 1 };
  const store = { intakeFiles: () => files, cases: () => [], module: () => module, insights: () => insights ?? null };
  const intake = { ensureExtracted: async list => list.map(f => ({ file: f, content: { text: contents[f.id] ?? '' } })) };
  let cwd; const fake = fakeSpawn(({ opts, child }) => { cwd = opts.cwd; end(child); });
  const runner = createAgentRunner({ dataDir: dir, store, intake, ingest: () => ({ id: 'x', draftCases: 0 }), referenceDir: path.join(dir, 'ref'), discoveryRoot: path.join(dir, 'qa'), spawn: fake.spawn, probe });
  runner.policy.save({ preset });
  const job = await runner.start({ module, agent: 'claude', kind: 'analyze', user: { username: 'u' } });
  await until(() => runner.get(module.id, job.id).status !== 'running');
  return { manifest: JSON.parse(fs.readFileSync(path.join(cwd, 'input', 'MANIFEST.json'), 'utf8')), cwd, job: runner.get(module.id, job.id), brief: fs.readFileSync(path.join(cwd, 'INSTRUCTIONS.md'), 'utf8') };
}
const txt = (id, name) => ({ id, name, kind: 'text', extract: 'ok' });

test('Economy trims long files to its reading budget and says so in the manifest', async t => {
  const r = await prepared(t, { preset: 'economy', files: [txt('f1', 'big.txt')], contents: { f1: 'x'.repeat(100_000) } });
  const entry = r.manifest[0];
  assert.equal(entry.truncated, true); assert.equal(fs.readFileSync(path.join(r.cwd, 'input', entry.textFile), 'utf8').length, 40_000);
  assert.deepEqual([r.job.stats.chars, r.job.stats.trimmed], [40_000, 1]);
});

test('a total reading budget stops later files from being sent once it is used up', async t => {
  const files = [txt('f1', 'a.txt'), txt('f2', 'b.txt'), txt('f3', 'c.txt')];
  const r = await prepared(t, { preset: 'economy', files, contents: { f1: 'a'.repeat(40_000), f2: 'b'.repeat(40_000), f3: 'c'.repeat(40_000) } });
  assert.deepEqual(r.manifest.map(m => Boolean(m.textFile)), [true, true, true], '100k total: the third file gets the remaining 20k');
  assert.equal(r.job.stats.chars, 100_000);
  const r2 = await prepared(t, { preset: 'economy', files: [...files, txt('f4', 'd.txt')], contents: { f1: 'a'.repeat(40_000), f2: 'b'.repeat(40_000), f3: 'c'.repeat(40_000), f4: 'd'.repeat(40_000) } });
  assert.equal(r2.manifest[3].textFile, undefined); assert.match(r2.manifest[3].note, /reading budget/);
});

test('on a re-analysis, sources the previous insights already cover are left out (not Best quality), and the brief says so', async t => {
  const files = [txt('f1', 'old.txt'), txt('f2', 'new.txt')], insights = { version: 3, coveredSources: [{ fileId: 'f1', name: 'old.txt' }] };
  const contents = { f1: 'old rules', f2: 'new rules' };
  const eco = await prepared(t, { preset: 'balanced', files, insights, contents });
  assert.match(eco.manifest[0].omitted, /unchanged/); assert.equal(eco.manifest[0].textFile, undefined); assert.ok(eco.manifest[1].textFile);
  assert.match(eco.brief, /NOT included/); assert.equal(eco.job.stats.omitted, 1);
  const best = await prepared(t, { preset: 'quality', files, insights, contents });
  assert.ok(best.manifest[0].textFile && best.manifest[1].textFile, 'Best quality re-reads everything'); assert.doesNotMatch(best.brief, /NOT included/);
});
