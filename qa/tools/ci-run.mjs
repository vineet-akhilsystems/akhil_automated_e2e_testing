#!/usr/bin/env node
// Start a Test Studio run from CI, wait for it, save JUnit XML, and exit with a status a pipeline can use.
//   PORTAL_URL=https://studio.example.com PORTAL_USER=ci PORTAL_PASSWORD=... CI_MODULE=registration CI_ENVIRONMENT=uat node qa/tools/ci-run.mjs
// Optional: CI_NAME (run name), CI_JUNIT_FILE (default junit.xml), CI_TIMEOUT_MIN (default 60), CI_POLL_SECONDS (default 10).
// Exit codes: 0 passed | 1 failed or blocked (a real finding) | 2 error, cancelled, interrupted, timed out or could not start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FINISHED = new Set(['passed', 'failed', 'error', 'blocked', 'cancelled', 'interrupted']);
export const exitCodeFor = status => (status === 'passed' ? 0 : status === 'failed' || status === 'blocked' ? 1 : 2);

export async function runInCi(env = process.env, { fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), log = console.log, now = Date.now } = {}) {
  const need = ['PORTAL_URL', 'PORTAL_USER', 'PORTAL_PASSWORD', 'CI_MODULE', 'CI_ENVIRONMENT'].filter(k => !env[k]);
  if (need.length) { log(`Missing settings: ${need.join(', ')}`); return 2; }
  const base = env.PORTAL_URL.replace(/\/+$/, ''), deadline = now() + (Number(env.CI_TIMEOUT_MIN) || 60) * 60000, pollMs = (Number(env.CI_POLL_SECONDS) || 10) * 1000;
  let cookie = '';
  const call = async (route, method = 'GET', body) => {
    const res = await fetchImpl(base + route, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return res;
  };
  const json = async res => res.json().catch(() => ({}));

  const login = await call('/api/login', 'POST', { username: env.PORTAL_USER, password: env.PORTAL_PASSWORD });
  if (!login.ok) { log(`Could not sign in (${login.status}): ${(await json(login)).error ?? 'check PORTAL_USER and PORTAL_PASSWORD'}`); return 2; }
  const started = await call('/api/ci/runs', 'POST', { moduleId: env.CI_MODULE, environmentId: env.CI_ENVIRONMENT, ...(env.CI_NAME ? { name: env.CI_NAME } : {}) });
  const run = await json(started);
  if (!started.ok) { log(`Could not start the run (${started.status}): ${run.error ?? 'unknown error'}`); return 2; }
  log(`Started run ${run.id} (${run.total} cases). Watching ${base}/#/runs/${run.id}`);

  let current = run, last = '';
  while (!FINISHED.has(current.status)) {
    if (now() > deadline) { log(`Timed out after ${env.CI_TIMEOUT_MIN || 60} minutes. The run is still ${current.status}; it keeps going in Test Studio.`); return 2; }
    await sleep(pollMs);
    const res = await call(`/api/runs/${run.id}`);
    if (!res.ok) { log(`Lost contact with the portal (${res.status}).`); return 2; }
    current = await json(res);
    const line = `${current.status}: ${current.results?.length ?? 0}/${current.total ?? run.total} cases`;
    if (line !== last) { log(line); last = line; }
  }

  const file = path.resolve(env.CI_JUNIT_FILE || 'junit.xml');
  const xml = await call(`/api/runs/${run.id}/export?format=junit`);
  if (xml.ok) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, await xml.text()); log(`JUnit report written to ${file}`); }
  const counts = (current.results ?? []).reduce((all, r) => ({ ...all, [r.status]: (all[r.status] ?? 0) + 1 }), {});
  log(`Result: ${current.status.toUpperCase()} | ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}${(current.results ?? []).some(r => r.flaky) ? ` | ${(current.results ?? []).filter(r => r.flaky).length} flaky` : ''}`);
  return exitCodeFor(current.status);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runInCi().then(code => { process.exitCode = code; }, error => { console.error(error.message ?? error); process.exitCode = 2; });
}
