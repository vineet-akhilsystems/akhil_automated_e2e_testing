import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createQueue } from '../queue.mjs';
import { classify, signature, analyzeRun, locatorAdvice } from '../failures.mjs';
import { compareRuns, previousRun, toJunit } from '../compare.mjs';
import { boot } from './support.mjs';
import { runInCi, exitCodeFor } from '../../qa/tools/ci-run.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));
const result = (id, status, extra = {}) => ({ id, title: `Case ${id}`, status, expected: 'ok', actual: status === 'PASS' ? 'ok' : 'bad', mismatches: [], ...extra });

// ---- quarantine ----------------------------------------------------------------------------------------------------
function queueFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q2-'));
  const runs = new Map(), launches = [];
  const store = { runs: () => [...runs.values()], run: id => runs.get(id), saveRun: r => runs.set(r.id, structuredClone(r)) };
  const launch = (c, args, opts) => { const child = new EventEmitter(); child.stdout = null; child.pid = 0; launches.push({ opts, child }); return child; };
  return { dir, store, launches, queue: createQueue(store, dir, [{ id: 'e', url: 'http://x.invalid', authDir: dir }], launch, null, () => null, { workers: 1 }) };
}
const finishWith = async (f, cases, events, code) => {
  const run = { id: `run-${Math.random().toString(16).slice(2)}`, environmentId: 'e', kind: 'tests', mode: 'automated', status: 'queued', module: { id: 'registration', adapter: 'registration', config: {} }, cases, results: [] };
  f.store.saveRun(run); f.queue.pump(); await wait(10);
  const l = f.launches.at(-1);
  fs.writeFileSync(path.join(l.opts.env.PORTAL_RUN_DIR, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  l.child.emit('exit', code); await wait(15);
  return f.store.run(run.id);
};

test('a quarantined case that fails does not fail the run, but a normal failure still does', async () => {
  const cases = [{ id: 'A', title: 'A' }, { id: 'Q', title: 'Q', quarantined: true }];
  const ok = await finishWith(queueFixture(), cases, [{ id: 'A', status: 'PASS' }, { id: 'Q', status: 'FAIL' }], 1);
  assert.equal(ok.status, 'passed', 'runner exit 1 comes only from the quarantined failure');
  assert.equal(ok.results.find(r => r.id === 'Q').quarantined, true);
  const bad = await finishWith(queueFixture(), cases, [{ id: 'A', status: 'FAIL' }, { id: 'Q', status: 'FAIL' }], 1);
  assert.equal(bad.status, 'failed');
  const err = await finishWith(queueFixture(), cases, [{ id: 'A', status: 'PASS' }, { id: 'Q', status: 'ERROR' }], 1);
  assert.equal(err.status, 'passed', 'a quarantined execution error does not make the run an error');
});

// ---- failure analysis ----------------------------------------------------------------------------------------------
test('failures are classified, infrastructure causes before assertions', () => {
  const c = (actual, extra = {}) => classify(result('X', 'ERROR', { actual, ...extra }));
  assert.equal(c('runner error: locator.click: Timeout 20000ms exceeded waiting for getByRole("button", { name: "Save" })'), 'locator');
  assert.equal(c('runner error: Timeout 120000ms exceeded.'), 'timeout');
  assert.equal(c('runner error: page.goto: net::ERR_CONNECTION_REFUSED'), 'network');
  assert.equal(c('runner error: The application session is expired, sign in page shown'), 'session');
  assert.equal(c('runner error: Case REG-5 needs {{regId@REG-4}} but REG-4 did not produce it'), 'data');
  assert.equal(classify(result('X', 'FAIL', { actual: 'toast differs', mismatches: ['outcome: expected "saved", got "blocked"'] })), 'assertion');
  assert.equal(c('something odd'), 'unknown');
});

test('identical failures share a signature even when numbers and quoted values differ', () => {
  const a = result('A', 'FAIL', { actual: 'toast: expected "Saved 17", got "Error 500"' }), b = result('B', 'FAIL', { actual: 'toast: expected "Saved 99", got "Error 404"' });
  assert.equal(signature(a), signature(b));
  assert.notEqual(signature(a), signature(result('C', 'FAIL', { actual: 'field hint differs' })));
});

test('analyzeRun groups, clusters, flags quarantined failures and gives locator advice without changing anything', () => {
  const run = { name: 'Nightly', module: { id: 'registration' }, results: [
    result('A', 'ERROR', { actual: 'runner error: Timeout 20000ms exceeded waiting for locator(\'#save-btn\')' }),
    result('B', 'ERROR', { actual: 'runner error: Timeout 20000ms exceeded waiting for locator(\'#save-btn\')' }),
    result('C', 'FAIL', { mismatches: ['outcome: expected "saved", got "blocked"'], quarantined: true }),
    result('D', 'PASS', { flaky: true, attempts: 2 }), result('E', 'PASS')] };
  const a = analyzeRun(run);
  assert.equal(a.total, 3); assert.equal(a.gating, 2);
  assert.deepEqual(a.groups.map(g => [g.class, g.count]), [['locator', 2], ['assertion', 1]]);
  assert.equal(a.clusters[0].count, 2);
  assert.equal(a.suggestions[0].locator.fragile, true);
  assert.match(a.suggestions[0].prompt, /playwright-test-healer/);
  assert.match(a.suggestions[0].review, /person must review/i);
  assert.match(a.postmortem, /passed only on retry/);
  assert.equal(locatorAdvice(result('X', 'ERROR', { actual: 'waiting for getByTestId("save")' })).fragile, false);
});

// ---- comparison and JUnit ------------------------------------------------------------------------------------------
const run = (n, results, extra = {}) => ({ id: `r${n}`, name: `Run ${n}`, kind: 'tests', mode: 'automated', status: 'failed', environmentId: 'uat', module: { id: 'reg', name: 'Registration' },
  createdAt: `2026-11-0${n}T01:00:00Z`, finishedAt: `2026-11-0${n}T01:10:00Z`, results, cases: results.map(r => ({ id: r.id, title: r.title, category: 'Validation' })), ...extra });

test('comparison lists newly failing, fixed, still failing, new flaky, added and removed cases', () => {
  const base = run(1, [result('A', 'PASS'), result('B', 'FAIL'), result('C', 'FAIL'), result('D', 'PASS'), result('GONE', 'PASS')]);
  const head = run(2, [result('A', 'FAIL'), result('B', 'PASS'), result('C', 'FAIL'), result('D', 'PASS', { flaky: true }), result('NEW', 'PASS')]);
  const c = compareRuns(base, head);
  assert.deepEqual(c.counts, { newlyFailing: 1, fixed: 1, stillFailing: 1, newlyFlaky: 1, added: 1, removed: 1, slower: 0 });
  assert.equal(c.newlyFailing[0].id, 'A'); assert.equal(c.fixed[0].id, 'B');
  assert.equal(previousRun([base, head, run(3, [], { environmentId: 'prod' })], head).id, 'r1');
  assert.equal(previousRun([head], head), null);
});

test('JUnit output counts failures, errors and skips, escapes text, and treats quarantined failures as skipped', () => {
  const r = run(1, [result('A', 'PASS', { flaky: true, attempts: 2 }), result('B', 'FAIL', { mismatches: ['a < b & "c"'] }), result('C', 'ERROR', { actual: 'runner error: boom' }), result('D', 'FAIL', { quarantined: true }), result('E', 'SKIPPED')]);
  const xml = toJunit(r);
  assert.match(xml, /<testsuites [^>]*tests="5" failures="1" errors="1" skipped="2"/);
  assert.match(xml, /a &lt; b &amp; &quot;c&quot;/);
  assert.match(xml, /Quarantined: FAIL/); assert.match(xml, /Flaky: passed on attempt 2/);
  assert.ok(!/[\u0000-\u0008]/.test(xml));
});

// ---- API ---------------------------------------------------------------------------------------------------------
test('API: bulk quarantine, failures, comparison, JUnit export and the CI start endpoint', async t => {
  const f = await boot(t, { workers: 1 }); // one worker: a cancelled run stops at once instead of after staggered shard starts
  const mod = f.store.modules().find(m => m.adapter), cases = f.store.cases(mod.id).filter(c => c.mode === 'automated' && c.action !== 'unavailable').slice(0, 3);
  assert.ok(cases.length >= 3);

  let r = await f.request(`/api/modules/${mod.id}/cases/bulk`, 'POST', { action: 'quarantine', caseIds: [cases[0].id] });
  assert.equal(r.status, 200, JSON.stringify(r.value));
  assert.equal(f.store.case(mod.id, cases[0].id).quarantined, true);
  await f.request(`/api/modules/${mod.id}/cases/bulk`, 'POST', { action: 'release', caseIds: [cases[0].id] });
  assert.equal(f.store.case(mod.id, cases[0].id).quarantined, undefined);

  const mk = (n, statuses) => f.store.saveRun({ id: `run-${n}`, name: `Run ${n}`, kind: 'tests', mode: 'automated', status: 'failed', environmentId: 'local', environmentName: 'Local', productId: 'augastam', module: structuredClone(mod), cases,
    createdAt: `2026-11-0${n}T01:00:00Z`, finishedAt: `2026-11-0${n}T01:10:00Z`, results: cases.map((c, i) => result(c.id, statuses[i], statuses[i] === 'ERROR' ? { actual: 'runner error: Timeout 20000ms exceeded waiting for getByRole("button")' } : {})) });
  mk(1, ['PASS', 'PASS', 'FAIL']); mk(2, ['ERROR', 'PASS', 'PASS']);

  r = await f.request('/api/runs/run-2/failures');
  assert.equal(r.status, 200); assert.equal(r.value.groups[0].class, 'locator');
  r = await f.request('/api/runs/run-2/compare');
  assert.equal(r.value.base.id, 'run-1'); assert.equal(r.value.counts.newlyFailing, 1); assert.equal(r.value.counts.fixed, 1);
  assert.equal((await f.request('/api/runs/run-1/compare')).value.none, true);
  r = await f.request('/api/runs/run-2/export?format=junit');
  assert.equal(r.status, 200); assert.match(r.response.headers.get('content-type'), /xml/); assert.match(r.value.toString(), /<testsuites /);

  r = await f.request('/api/ci/runs', 'POST', { moduleId: mod.id, environmentId: 'local', name: 'CI build 42' });
  assert.equal(r.status, 201, JSON.stringify(r.value));
  assert.equal(r.value.name, 'CI build 42'); assert.equal(r.value.source, 'ci');
  assert.equal((await f.request('/api/ci/runs', 'POST', { moduleId: mod.id })).status, 400);
  // Stop the started run so no worker timer outlives the test.
  await f.request(`/api/runs/${r.value.id}/cancel`, 'POST'); await wait(300);
});

test('CI script: starts a run, waits for it, writes JUnit and returns the exit code', async t => {
  const f = await boot(t, { workers: 1, bootstrap: { username: 'root', password: 'correct-horse-battery' } });
  const mod = f.store.modules().find(m => m.adapter), out = path.join(f.directory, 'reports', 'junit.xml'), lines = [];
  const env = { PORTAL_URL: f.base, PORTAL_USER: 'root', PORTAL_PASSWORD: 'correct-horse-battery', CI_MODULE: mod.id, CI_ENVIRONMENT: 'local', CI_JUNIT_FILE: out, CI_POLL_SECONDS: '0.01' };
  let finished = false;
  // While the script waits, play the part of the Playwright worker: report every case as passed, then exit cleanly.
  const sleep = async () => {
    if (finished || !f.launches.length) return wait(20);
    finished = true;
    const call = f.launches[0], snap = JSON.parse(fs.readFileSync(call.options.env.CASES_FILE, 'utf8'));
    fs.writeFileSync(path.join(call.options.env.PORTAL_RUN_DIR, 'events.jsonl'), snap.cases.map(c => JSON.stringify({ id: c.id, title: c.title, status: 'PASS', durationMs: 5 })).join('\n') + '\n');
    call.child.emit('exit', 0); await wait(50);
  };
  assert.equal(await runInCi(env, { sleep, log: m => lines.push(m) }), 0, lines.join('\n'));
  assert.match(fs.readFileSync(out, 'utf8'), /<testsuites /);
  assert.ok(lines.some(l => /Result: PASSED/.test(l)));
  assert.equal(await runInCi({ ...env, PORTAL_PASSWORD: 'wrong' }, { log: m => lines.push(m) }), 2, 'bad credentials');
  assert.equal(await runInCi({}, { log: () => {} }), 2, 'missing settings');
  assert.deepEqual(['passed', 'failed', 'blocked', 'error', 'cancelled'].map(exitCodeFor), [0, 1, 1, 2, 2]);
});

test('tickets: GitHub and Jira issues are created from a finding, redacted, once per finding, and secrets never come back', async t => {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return url.includes('github.com') ? { ok: true, status: 201, json: async () => ({ html_url: 'https://github.com/acme/app/issues/7', number: 7 }) }
      : { ok: true, status: 201, json: async () => ({ key: 'QA-12' }) };
  };
  const f = await boot(t, { fetch: fetchMock });
  const mod = f.store.modules().find(m => m.adapter), c = f.store.cases(mod.id)[0];
  f.store.saveRun({ id: 'tk-run', name: 'Nightly', kind: 'tests', mode: 'automated', status: 'failed', environmentId: 'local', environmentName: 'UAT', productId: 'augastam', module: structuredClone(mod), cases: [c],
    createdAt: '2026-11-01T01:00:00Z', finishedAt: '2026-11-01T01:10:00Z',
    results: [{ id: c.id, title: c.title, status: 'FAIL', expected: 'Saved', actual: 'Blocked. Authorization: Bearer abc.def.ghi password=hunter2', mismatches: ['outcome: expected "saved", got "blocked"'] }] });

  assert.equal((await f.request('/api/runs/tk-run/ticket', 'POST', { caseId: c.id })).status, 409, 'not configured yet');
  assert.equal((await f.request('/api/tickets/settings', 'PUT', { provider: 'github', repo: 'not a repo', token: 'x' })).status, 400);
  let r = await f.request('/api/tickets/settings', 'PUT', { provider: 'github', repo: 'acme/app', token: 'ghp_secret_token' });
  assert.equal(r.status, 200); assert.equal(r.value.configured, true);
  assert.ok(!JSON.stringify((await f.request('/api/tickets/settings')).value).includes('ghp_secret_token'));

  r = await f.request('/api/runs/tk-run/ticket', 'POST', { caseId: c.id });
  assert.equal(r.status, 201, JSON.stringify(r.value)); assert.equal(r.value.url, 'https://github.com/acme/app/issues/7');
  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/app/issues');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ghp_secret_token');
  assert.ok(!calls[0].body.body.includes('hunter2') && !calls[0].body.body.includes('abc.def.ghi'), 'credentials are redacted');
  assert.match(calls[0].body.body, /Expected:\nSaved/);
  assert.equal(f.store.run('tk-run').triage[c.id].ticketKey, '#7');
  r = await f.request('/api/runs/tk-run/ticket', 'POST', { caseId: c.id });
  assert.equal(r.status, 200); assert.equal(r.value.existing, true); assert.equal(calls.length, 1, 'no duplicate ticket');

  // Jira, on a second finding
  f.store.saveRun({ ...f.store.run('tk-run'), triage: {} });
  await f.request('/api/tickets/settings', 'PUT', { provider: 'jira', baseUrl: 'https://acme.atlassian.net', email: 'qa@acme.test', projectKey: 'qa', token: 'jira-secret' });
  r = await f.request('/api/runs/tk-run/ticket', 'POST', { caseId: c.id });
  assert.equal(r.value.url, 'https://acme.atlassian.net/browse/QA-12');
  assert.equal(calls[1].body.fields.project.key, 'QA');
  assert.equal(calls[1].init.headers.Authorization, `Basic ${Buffer.from('qa@acme.test:jira-secret').toString('base64')}`);
  assert.equal((await f.request('/api/runs/tk-run/ticket', 'POST', { caseId: 'NOPE' })).status, 404);
});

test('post-mortem notes are saved on finished runs only, and the accessibility option reaches the worker', async t => {
  const f = await boot(t, { workers: 1 });
  const mod = f.store.modules().find(m => m.adapter), c = f.store.cases(mod.id).find(x => x.mode === 'automated' && x.action !== 'unavailable');
  f.store.saveRun({ id: 'pm-run', name: 'Nightly', kind: 'tests', mode: 'automated', status: 'failed', environmentId: 'local', productId: 'augastam', module: structuredClone(mod), cases: [c],
    createdAt: '2026-11-01T01:00:00Z', finishedAt: '2026-11-01T01:10:00Z', results: [result(c.id, 'FAIL')] });
  assert.equal((await f.request('/api/runs/pm-run/postmortem', 'PUT', { text: 'short' })).status, 400);
  let r = await f.request('/api/runs/pm-run/postmortem', 'PUT', { text: 'The save button moved; all three failures share that cause.' });
  assert.equal(r.status, 200);
  assert.match((await f.request('/api/runs/pm-run/failures')).value.written.text, /save button moved/);

  r = await f.request('/api/runs', 'POST', { name: 'A11y run', moduleId: mod.id, environmentId: 'local', mode: 'automated', caseIds: [c.id], accessibility: true });
  assert.equal(r.status, 201, JSON.stringify(r.value));
  await wait(50);
  assert.equal(f.launches[0].options.env.PORTAL_A11Y, '1');
  await f.request(`/api/runs/${r.value.id}/cancel`, 'POST'); await wait(300);
});
