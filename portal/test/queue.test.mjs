import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createQueue, defaultWorkers, shardCases, failedCaseIds, rerunSubset, casesWithDependencies, dependencyRefs } from '../queue.mjs';

const c = (id, extra = {}) => ({ id, title: id, ...extra });
const cases = [c('A'), c('B', { target: '{{regId@A}}' }), c('C'), c('D', { x: '{{phone@C}}' }), c('E', { y: '{{regId@B}}' }), c('F')];

test('PORTAL_WORKERS overrides the min(4, cores) default', () => {
  assert.equal(defaultWorkers({ PORTAL_WORKERS: '3' }), 3);
  assert.equal(defaultWorkers({ PORTAL_WORKERS: '999' }), 16);
  assert.ok(defaultWorkers({}) >= 1 && defaultWorkers({}) <= 4);
  assert.ok(defaultWorkers({ PORTAL_WORKERS: 'x' }) <= 4);
});

test('dependent cases always share a shard, in original order', () => {
  assert.deepEqual(dependencyRefs(cases[4]), ['B']);
  const shards = shardCases(cases, 3).map(s => s.map(x => x.id));
  assert.equal(shards.length, 3);
  assert.deepEqual(shards.flat().sort(), ['A', 'B', 'C', 'D', 'E', 'F']);
  const shardOf = id => shards.findIndex(s => s.includes(id));
  assert.equal(shardOf('A'), shardOf('B')); assert.equal(shardOf('B'), shardOf('E')); assert.equal(shardOf('C'), shardOf('D'));
  assert.deepEqual(shards[shardOf('A')], ['A', 'B', 'E']);
  assert.equal(shardCases(cases, 1).length, 1);
  assert.equal(shardCases(cases, 1)[0].map(x => x.id).join(), 'A,B,C,D,E,F');
  assert.equal(shardCases(cases, 99).length, 3, 'never more shards than independent groups');
  assert.deepEqual(shardCases([], 4), []);
});

test('failedCaseIds and rerunSubset pick failures plus their prerequisites', () => {
  const run = { status: 'failed', cases, results: [
    { id: 'A', status: 'PASS' }, { id: 'B', status: 'PASS' }, { id: 'C', status: 'OBSERVED' }, { id: 'D', status: 'FAIL' }, { id: 'E', status: 'ERROR' }, { id: 'F', status: 'SKIPPED' }] };
  assert.deepEqual(failedCaseIds(run), ['D', 'E']);
  assert.deepEqual(rerunSubset(run).map(x => x.id), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(casesWithDependencies(cases, ['F']).map(x => x.id), ['F']);
  assert.deepEqual(failedCaseIds({ status: 'interrupted', cases, results: [{ id: 'A', status: 'PASS' }] }), ['B', 'C', 'D', 'E', 'F']);
  assert.deepEqual(failedCaseIds({ status: 'running', cases, results: [] }), []);
  assert.deepEqual(failedCaseIds({ status: 'interrupted', cases, results: [{ id: 'A', status: 'PASS' }] }, { includeMissing: false }), []);
});

function fixture(options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-'));
  const runs = new Map();
  const store = { runs: () => [...runs.values()], run: id => runs.get(id), saveRun: r => { runs.set(r.id, structuredClone(r)); } };
  const launches = [];
  const launch = (command, args, opts) => { const child = new EventEmitter(); child.stdout = null; child.pid = 0; launches.push({ args, opts, child }); return child; };
  const queue = createQueue(store, dir, [{ id: 'e', url: 'http://x.invalid', authDir: path.join(dir, 'auth') }], launch, null, () => null, { staggerMs: 5, ...options });
  return { dir, store, launches, queue };
}
const makeRun = (cs, extra = {}) => ({ id: `run-${Math.random().toString(16).slice(2)}`, environmentId: 'e', kind: 'tests', mode: 'automated', status: 'queued',
  module: { id: 'registration', adapter: 'registration', config: {} }, cases: cs, results: [], ...extra });
const wait = ms => new Promise(r => setTimeout(r, ms));

test('queue runs shards in parallel with separate dirs, seq offsets and timing', async () => {
  const f = fixture({ workers: 3 });
  const run = makeRun(cases); f.store.saveRun(run); f.queue.pump(); await wait(40);
  assert.equal(f.launches.length, 3);
  const runDirs = f.launches.map(l => l.opts.env.PORTAL_RUN_DIR);
  assert.equal(new Set(runDirs).size, 3);
  assert.equal(new Set(f.launches.map(l => l.opts.env.PORTAL_REPORT_DIR)).size, 3);
  assert.ok(f.launches.every(l => l.args.includes('--workers=1')));
  assert.equal(new Set(f.launches.map(l => l.args.find(a => a.startsWith('--output=')))).size, 3);
  const seqs = runDirs.map(d => JSON.parse(fs.readFileSync(path.join(d, 'agent-seq.json'), 'utf8')).next);
  assert.equal(new Set(seqs).size, 3);
  for (const [i, l] of f.launches.entries()) {
    const snap = JSON.parse(fs.readFileSync(l.opts.env.CASES_FILE, 'utf8'));
    fs.writeFileSync(path.join(runDirs[i], 'events.jsonl'), snap.cases.map(x => JSON.stringify({ id: x.id, status: 'PASS', durationMs: 100, wallMs: 150, shard: i })).join('\n') + '\n');
    l.child.emit('exit', 0);
  }
  await wait(20);
  const done = f.store.run(run.id);
  assert.equal(done.status, 'passed'); assert.equal(done.results.length, 6);
  assert.equal(done.timing.workers, 3); assert.equal(done.timing.shardCount, 3);
  assert.equal(done.timing.cases.length, 6); assert.equal(done.timing.sumCaseMs, 900);
  assert.ok(done.timing.wallMs >= 0 && done.timing.shards.every(s => s.finishedAt && s.exitCode === 0));
});

test('a single worker keeps the original layout; onlyCaseIds runs the subset with prerequisites', async () => {
  const f = fixture({ workers: 1 });
  const run = makeRun(cases, { onlyCaseIds: ['E'] }); f.store.saveRun(run); f.queue.pump(); await wait(10);
  assert.equal(f.launches.length, 1);
  const env = f.launches[0].opts.env;
  assert.equal(env.PORTAL_RUN_DIR, f.queue.dirFor(run.id));
  assert.equal(env.PORTAL_MODULE_ID, 'registration'); assert.equal(env.PORTAL_RUN_ID, run.id); assert.equal(env.REG_RUN_ID, run.id);
  assert.deepEqual(JSON.parse(fs.readFileSync(env.CASES_FILE, 'utf8')).cases.map(x => x.id), ['A', 'B', 'E']);
  fs.writeFileSync(path.join(env.PORTAL_RUN_DIR, 'events.jsonl'), ['A', 'B', 'E'].map(id => JSON.stringify({ id, status: 'PASS', durationMs: 1 })).join('\n') + '\n');
  f.launches[0].child.emit('exit', 0); await wait(10);
  assert.equal(f.store.run(run.id).status, 'passed');
  assert.equal(f.store.run(run.id).timing.shardCount, 1);
});

test('a failing shard exit makes the run an error', async () => {
  const f = fixture({ workers: 2, staggerMs: 5 });
  const run = makeRun(cases); f.store.saveRun(run); f.queue.pump(); await wait(30);
  assert.equal(f.launches.length, 2);
  f.launches[0].child.emit('exit', 0); f.launches[1].child.emit('exit', 1); await wait(20);
  assert.equal(f.store.run(run.id).status, 'error');
});

test('the spec path is passed to Playwright regex-escaped', async () => {
  const f = fixture({ workers: 1 });
  const run = makeRun(cases); f.store.saveRun(run); f.queue.pump(); await wait(10);
  assert.ok(f.launches[0].args.includes(String.raw`tests/modules/registration/cases\.spec\.ts`));
  assert.ok(!f.launches[0].args.includes('tests/modules/registration/cases.spec.ts'));
  f.launches[0].child.emit('exit', 0); await wait(10);
});
