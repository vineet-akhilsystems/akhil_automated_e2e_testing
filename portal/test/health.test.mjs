import test from 'node:test';
import assert from 'node:assert/strict';
import { runTrend, caseHealth, flakyCases, trendSummary } from '../trends.mjs';
import { isDue, dateKey } from '../schedules.mjs';
import { boot, until } from './support.mjs';

const result = (id, status, extra = {}) => ({ id, title: `Case ${id}`, status, ...extra });
const run = (n, results, extra = {}) => ({ id: `run-${n}`, name: `Run ${n}`, kind: 'tests', mode: 'automated', status: results.some(r => r.status !== 'PASS') ? 'failed' : 'passed',
  environmentId: 'uat', module: { id: 'reg', name: 'Registration' }, createdAt: `2026-11-0${n}T01:00:00Z`, finishedAt: `2026-11-0${n}T01:10:00Z`, results, ...extra });

test('a pass that needed a retry is flaky even when the run is green', () => {
  const runs = [run(1, [result('A', 'PASS'), result('B', 'PASS', { flaky: true, attempts: 2 })])];
  const flaky = flakyCases(runs);
  assert.deepEqual(flaky.map(c => [c.id, c.verdict]), [['B', 'flaky']]);
  assert.equal(runTrend(runs)[0].flaky, 1);
});

test('flipping between pass and fail across runs is flagged; a steady failure is not flaky', () => {
  const runs = [1, 2, 3, 4].map(n => run(n, [result('FLIP', n % 2 ? 'PASS' : 'FAIL'), result('BROKEN', 'FAIL'), result('OK', 'PASS')]));
  const health = Object.fromEntries(caseHealth(runs).map(c => [c.id, c.verdict]));
  assert.deepEqual(health, { FLIP: 'flaky', BROKEN: 'failing', OK: 'stable' });
});

test('a regression that was fixed is "unstable", not flaky', () => {
  const runs = [1, 2, 3, 4, 5].map(n => run(n, [result('FIXED', n >= 2 && n <= 4 ? 'FAIL' : 'PASS')]));
  assert.equal(caseHealth(runs)[0].verdict, 'unstable');
});

test('flips across different environments are not counted', () => {
  const runs = [run(1, [result('A', 'PASS')], { environmentId: 'uat' }), run(2, [result('A', 'FAIL')], { environmentId: 'prod' })];
  assert.equal(caseHealth(runs)[0].flips, 0);
});

test('trend ignores manual, cancelled and unfinished runs and skipped/observed cases', () => {
  const runs = [run(1, [result('A', 'PASS'), result('B', 'FAIL'), result('C', 'SKIPPED'), result('D', 'OBSERVED')]),
    run(2, [result('A', 'PASS')], { mode: 'manual' }), run(3, [result('A', 'PASS')], { status: 'cancelled' }), run(4, [result('A', 'PASS'), result('B', 'PASS')])];
  const trend = runTrend(runs);
  assert.deepEqual(trend.map(p => [p.runId, p.executed, p.passRate]), [['run-1', 2, 50], ['run-4', 2, 100]]);
  assert.equal(trendSummary(trend).delta, 50);
});

test('schedule is due once per day, on its days, after its time', () => {
  const s = { enabled: true, time: '02:00', days: [1, 2, 3, 4, 5], lastFiredOn: null };
  const mon = h => new Date(2026, 10, 16, h, 5); // Monday 16 Nov 2026
  assert.equal(isDue(s, mon(1)), false);
  assert.equal(isDue(s, mon(2)), true);
  assert.equal(isDue({ ...s, lastFiredOn: dateKey(mon(2)) }, mon(9)), false);
  assert.equal(isDue(s, new Date(2026, 10, 15, 9, 0)), false, 'Sunday is not selected');
  assert.equal(isDue({ ...s, enabled: false }, mon(9)), false);
});

test('API: trends, alerts and schedules respect access and validate input', async t => {
  const sent = [];
  const f = await boot(t, { fetch: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; } });
  const mod = f.store.modules()[0];
  const env = 'local';

  // webhook: write-only URL, never echoed back
  let r = await f.request('/api/notifications', 'PUT', { webhookUrl: 'https://hooks.example.test/secret-token-123', when: 'failures' });
  assert.equal(r.status, 200); assert.equal(r.value.configured, true); assert.equal(r.value.host, 'hooks.example.test');
  assert.ok(!JSON.stringify(r.value).includes('secret-token-123'));
  assert.equal((await f.request('/api/notifications', 'PUT', { webhookUrl: 'ftp://x.test/a' })).status, 400);
  assert.equal((await f.request('/api/notifications/test', 'POST')).status, 200);
  assert.match(sent[0].body.text, /test alert/);

  // a failed run sends one alert; a clean run does not
  const finished = (status, results) => ({ id: `r-${status}`, kind: 'tests', mode: 'automated', name: 'Nightly', status, module: { id: mod.id, name: mod.name }, environmentName: 'Local', results });
  const notifications = (await import('../notifications.mjs')).createNotifications(f.store, { fetchImpl: async (u, i) => { sent.push({ url: u, body: JSON.parse(i.body) }); return { ok: true, status: 200 }; } });
  assert.equal(await notifications.runFinished(finished('passed', [{ id: 'A', status: 'PASS' }])), false);
  assert.equal(await notifications.runFinished(finished('passed', [{ id: 'A', status: 'PASS', flaky: true }])), true, 'flaky pass still alerts');
  assert.equal(await notifications.runFinished(finished('failed', [{ id: 'A', title: 'Name required', status: 'FAIL' }])), true);
  assert.match(sent.at(-1).body.text, /FAILED[\s\S]*A Name required/);

  // schedules
  const body = { name: 'Nightly smoke', moduleId: mod.id, environmentId: env, time: '02:00', days: [1, 2, 3, 4, 5] };
  assert.equal((await f.request('/api/schedules', 'POST', { ...body, time: '25:99' })).status, 400);
  assert.equal((await f.request('/api/schedules', 'POST', { ...body, days: [] })).status, 400);
  r = await f.request('/api/schedules', 'POST', body);
  assert.equal(r.status, 201, JSON.stringify(r.value));
  const id = r.value.id;
  assert.equal((await f.request(`/api/schedules/${id}`, 'PUT', { enabled: false })).value.enabled, false);
  assert.equal((await f.request(`/api/schedules?module=${mod.id}`)).value.length, 1);

  // trends endpoint answers (empty history is fine)
  r = await f.request(`/api/trends?module=${mod.id}`);
  assert.equal(r.status, 200); assert.deepEqual(r.value.trend, []);
  assert.equal((await f.request(`/api/schedules/${id}`, 'DELETE')).status, 200);
  await until(() => true);
});
