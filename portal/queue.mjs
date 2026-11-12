import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ROOT, adapters } from './registry.mjs';
import { LOGIN_KEYS } from './environment-settings.mjs';

// ---- Speed helpers (pure, exported for tests and for the rerun path) ----------------------------------------------
const FAILED = new Set(['FAIL', 'FAIL (assumed requirement)', 'ERROR']);
const TERMINAL = new Set(['passed', 'failed', 'error', 'blocked', 'cancelled', 'interrupted']);

/** PORTAL_WORKERS (1-16) or min(4, cores). */
export function defaultWorkers(env = process.env) {
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const asked = Number.parseInt(env.PORTAL_WORKERS ?? '', 10);
  return Number.isFinite(asked) && asked >= 1 ? Math.min(asked, 16) : Math.max(1, Math.min(4, cores));
}

/** Ids of the cases a case refers to with {{name@CASE-ID}} (the only way one case consumes another's data). */
export function dependencyRefs(testCase) {
  return [...new Set([...JSON.stringify(testCase).matchAll(/\{\{\w+@([\w-]+)\}\}/g)].map(m => m[1]))];
}

/** Cases plus (transitively) the cases they depend on, in the original order. Unknown ids are ignored. */
export function casesWithDependencies(cases, ids) {
  const byId = new Map(cases.map(c => [c.id, c])), wanted = new Set();
  const visit = id => { if (wanted.has(id) || !byId.has(id)) return; wanted.add(id); dependencyRefs(byId.get(id)).forEach(visit); };
  ids.forEach(visit);
  return cases.filter(c => wanted.has(c.id));
}

/** Ids of cases that failed in a finished run (FAIL / ERROR; plus cases that never produced a result unless includeMissing is false). */
export function failedCaseIds(run, { includeMissing = true } = {}) {
  const results = new Map((run.results ?? []).map(r => [r.id, r]));
  return (run.cases ?? []).filter(c => {
    const r = results.get(c.id);
    if (r) return FAILED.has(r.status);
    return includeMissing && TERMINAL.has(run.status) && c.enabled !== false;
  }).map(c => c.id);
}

/** Cases of `run` to execute again, in order, with prerequisites. Default: the failed ones. */
export function rerunSubset(run, ids = failedCaseIds(run)) {
  return casesWithDependencies(run.cases ?? [], ids);
}

/**
 * Split cases into at most `workers` shards that never separate a case from the cases it consumes data from.
 * Dependent cases (connected by {{x@ID}} references) form a group and run serially, in the original order, in one
 * shard; groups are balanced across shards (largest first). Order inside a shard is the original order.
 */
export function shardCases(cases, workers) {
  const index = new Map(cases.map((c, i) => [c.id, i])), parent = cases.map((_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (const [i, c] of cases.entries()) for (const ref of dependencyRefs(c)) if (index.has(ref)) parent[find(i)] = find(index.get(ref));
  const groups = new Map();
  cases.forEach((c, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
  const shards = Array.from({ length: Math.max(1, Math.min(workers, ordered.length)) }, () => []);
  for (const group of ordered) shards.reduce((least, s) => (s.length < least.length ? s : least)).push(...group);
  return shards.filter(s => s.length).map(s => s.sort((a, b) => a - b).map(i => cases[i]));
}

export function createQueue(store, dataDir, environments, launch = spawn, logger = null, credentialsFor = () => null, options = {}) {
  let active = null, stopping = false;
  // Mirror runner output to the portal terminal, line by line, tagged with the run id.
  const echo = (run, stream) => {
    let pending = '';
    return chunk => {
      const lines = (pending + chunk.toString()).split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) if (line.trim()) logger?.(`[run ${run.id.slice(0, 8)}] ${line}`, stream);
    };
  };
  const runsDir = path.join(dataDir, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  // A terminated process cannot be assumed to have completed. Keep its evidence.
  for (const run of store.runs()) if (run.status === 'running') {
    store.saveRun({ ...run, status: 'interrupted', finishedAt: new Date().toISOString(), error: 'The portal stopped during this run. Create a new run to try again.' });
  }
  const dirFor = id => path.join(runsDir, id);
  function syncEvents(run) {
    if (run.kind === 'authentication') return;
    const root = dirFor(run.id), shardsDir = path.join(root, 'shards');
    const files = [path.join(root, 'events.jsonl')];
    if (fs.existsSync(shardsDir)) for (const name of fs.readdirSync(shardsDir).sort((x, y) => Number(x) - Number(y))) files.push(path.join(shardsDir, name, 'events.jsonl'));
    const byId = new Map((run.results ?? []).map(r => [r.id, r]));
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
        try { const event = JSON.parse(line); byId.set(event.id, event); } catch { /* incomplete last line */ }
      }
    }
    run.results = [...byId.values()];
  }
  // Timing recorded on run.timing (see summarizeTiming).
  function summarizeTiming(run, timing) {
    const byId = new Map((run.results ?? []).map(r => [r.id, r]));
    timing.cases = timing.shards.flatMap(sh => sh.caseIds.map(id => {
      const r = byId.get(id);
      return r ? { id, shard: sh.index, status: r.status, durationMs: r.durationMs ?? 0, wallMs: r.wallMs ?? r.durationMs ?? 0 } : null;
    })).filter(Boolean);
    timing.sumCaseMs = timing.cases.reduce((n, c) => n + c.wallMs, 0);
    timing.wallMs = timing.finishedAt ? Date.parse(timing.finishedAt) - Date.parse(timing.startedAt) : Date.now() - Date.parse(timing.startedAt);
    timing.speedup = timing.wallMs > 0 && timing.sumCaseMs > 0 ? Math.round((timing.sumCaseMs / timing.wallMs) * 100) / 100 : null;
    return timing;
  }
  function pump() {
    if (active || stopping) return;
    const run = store.runs().reverse().find(r => r.status === 'queued');
    if (!run) return;
    const environment = environments.find(e => e.id === run.environmentId);
    const dir = dirFor(run.id);
    fs.mkdirSync(dir, { recursive: true });
    run.status = 'running'; run.startedAt = new Date().toISOString(); store.saveRun(run);
    const auth = run.kind === 'authentication';
    const planned = auth ? [] : Array.isArray(run.onlyCaseIds) && run.onlyCaseIds.length ? casesWithDependencies(run.cases, run.onlyCaseIds) : run.cases;
    const workers = Math.max(1, options.workers ?? defaultWorkers());
    // Independent groups run in parallel processes; cases that consume each other's data stay together, in order.
    const sharded = auth ? [] : shardCases(planned, workers);
    const plan = sharded.length ? sharded : [[]];
    const multi = plan.length > 1;
    const credentials = auth ? credentialsFor(environment) : null;
    const loginEnv = Object.fromEntries(Object.entries(LOGIN_KEYS).map(([key, variable]) => [variable, credentials?.[key] ?? '']));
    const caseTimeout = String(options.caseTimeoutMs ?? process.env.PORTAL_CASE_TIMEOUT_MS ?? '');
    const log = fs.openSync(path.join(dir, 'runner.log'), 'a');
    const timing = { workers, shardCount: plan.length, caseTimeoutMs: Number(caseTimeout) || 120000, startedAt: new Date().toISOString(), finishedAt: null,
      shards: plan.map((cases, index) => ({ index, caseIds: cases.map(c => c.id), startedAt: null, finishedAt: null, exitCode: null })) };
    run.timing = summarizeTiming(run, timing); store.saveRun(run);
    const shardDir = i => multi ? path.join(dir, 'shards', String(i)) : dir;
    const shardEnv = i => {
      const sd = shardDir(i), tag = multi ? `/s${i}` : '';
      fs.mkdirSync(sd, { recursive: true });
      fs.writeFileSync(path.join(sd, 'cases.json'), JSON.stringify({ module: run.module.id, bases: run.module.config?.bases ?? {}, cases: plan[i] }, null, 2));
      // Unique "Agent Testing User<N>" numbers per shard so parallel shards never create the same patient name.
      if (multi) fs.writeFileSync(path.join(sd, 'agent-seq.json'), JSON.stringify({ next: 1 + i * 1000, note: 'Agent Testing User<N> counter (shard offset)' }));
      return { ...process.env, ...loginEnv, BASE_URL: environment.url, AUTH_DIR: environment.authDir,
        CASES_FILE: path.join(sd, 'cases.json'), CASES: '', REG_RUN_ID: run.id, PORTAL_RUN_ID: run.id, PORTAL_MODULE_ID: run.module.id,
        PORTAL_RUN_DIR: sd, PORTAL_RUN_ROOT: dir, PORTAL_SHARD_INDEX: String(i), PORTAL_SHARD_COUNT: String(plan.length),
        PORTAL_REPORT_DIR: path.join(dir, 'report') + tag, PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(dir, 'html') + tag,
        PORTAL_CASE_TIMEOUT_MS: caseTimeout,
        PORTAL_AUTH_RUN: auth ? '1' : '', PAUSE_ON_FAIL: '', SLOWMO: '0', VIDEO: '', FORCE_COLOR: '0' };
    };
    const shardArgs = i => ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.config.ts',
      `--project=${auth ? 'setup' : 'chromium'}`, '--workers=1',
      // Playwright treats file arguments as regex patterns: escape metacharacters so the path matches literally.
      ...(auth ? [] : [adapters[run.module.adapter].spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')]),
      `--output=${path.join(dir, 'artifacts')}${multi ? `/s${i}` : ''}`];
    const children = [], timers = [];
    let exited = 0, firstError = null;
    const finish = (code, error) => {
      if (active?.run.id !== run.id) return;
      clearInterval(active.timer); active.timers?.forEach(clearTimeout);
      syncEvents(run);
      timing.finishedAt = new Date().toISOString();
      run.timing = summarizeTiming(run, timing);
      if (run.cancelRequested) run.status = 'cancelled';
      else if (stopping) run.status = 'interrupted';
      else if (error) { run.status = 'error'; run.error = error.message; }
      else if (run.kind === 'authentication') {
        run.status = code === 0 ? 'passed' : 'error';
        if (code !== 0) {
          const reasons = {
            configuration: 'Required application login fields are missing. Complete this profile in Settings.',
            'open-login': 'The website login page could not be opened or its login controls were not found. Check the website in Settings.',
            'verify-password': 'Password verification did not reach the workspace selection screen. Check the username/password in Settings and application availability.',
            tenant: 'The configured tenant could not be selected. Check the tenant assigned to this account in Settings.',
            facility: 'The configured facility could not be selected. Check the facility assigned to this account in Settings.',
            role: 'The configured application role could not be selected. Check the role assigned to this facility in Settings.',
            submit: 'Workspace selection completed, but the application did not finish signing in. Check profile selections in Settings and application availability.',
            'session-save': 'The application signed in but its session could not be saved on the server. Check portal storage permissions.',
          };
          let stage;
          try { stage = JSON.parse(fs.readFileSync(path.join(dir, 'auth-status.json'), 'utf8')).stage; } catch { /* worker did not report a stage */ }
          run.error = Object.hasOwn(reasons, stage) ? reasons[stage] : 'Application login could not complete. Check the profile in Settings and application availability.';
        }
      }
      else if (run.results.length < planned.length) {
        run.status = 'error'; run.error = `Runner stopped after ${run.results.length} of ${planned.length} cases. See the runner log.`;
      } else if (run.results.some(r => r.status === 'ERROR')) run.status = 'error';
      else if (run.results.some(r => ['FAIL', 'FAIL (assumed requirement)'].includes(r.status))) run.status = 'failed';
      else if (code !== 0) { run.status = 'error'; run.error = 'Runner exited unsuccessfully. Inspect the runner log.'; }
      else if (run.results.some(r => r.status === 'BLOCKED')) run.status = 'blocked';
      else run.status = code === 0 && run.results.every(r => ['PASS', 'OBSERVED', 'SKIPPED'].includes(r.status)) ? 'passed' : 'failed';
      run.exitCode = code; run.finishedAt = new Date().toISOString(); store.saveRun(run);
      logger?.(`[run ${run.id.slice(0, 8)}] Timing: ${(run.timing.wallMs / 1000).toFixed(1)}s wall, ${plan.length} worker(s), ${run.timing.cases.length} case(s)`);
      if (run.kind === 'authentication') fs.writeSync(log, `${run.status === 'passed' ? 'Application login completed.' : run.error ?? 'Application login stopped.'}\nLogin output, screenshots and traces are suppressed to protect credentials.\n`);
      const counts = Object.entries((run.results ?? []).reduce((all, r) => ({ ...all, [r.status]: (all[r.status] ?? 0) + 1 }), {})).map(([s, n]) => `${s} ${n}`).join(', ');
      logger?.(`[run ${run.id.slice(0, 8)}] Finished: ${run.status.toUpperCase()} (exit ${code ?? '-'})${counts ? ` | ${counts}` : ''}${run.error ? ` | ${run.error}` : ''}`, run.status === 'passed' ? 'stdout' : 'stderr');
      logger?.(`[run ${run.id.slice(0, 8)}] Full log: ${path.join(dir, 'runner.log')}`);
      fs.closeSync(log); active = null;
      if (!stopping) setImmediate(pump);
    };
    const settle = (i, code, error) => {
      timing.shards[i].finishedAt = new Date().toISOString(); timing.shards[i].exitCode = code;
      if (error && !firstError) firstError = error;
      if (++exited < plan.length) return;
      const codes = timing.shards.map(sh => sh.exitCode);
      finish(firstError ? null : codes.find(c => c !== 0) ?? 0, firstError);
    };
    const startShard = i => {
      if (run.cancelRequested || stopping || active?.run.id !== run.id) return settle(i, null);
      try {
        timing.shards[i].startedAt = new Date().toISOString();
        const stdio = logger || auth || multi ? ['ignore', 'pipe', 'pipe'] : ['ignore', log, log];
        const child = launch(process.execPath, shardArgs(i), { cwd: ROOT, env: shardEnv(i), stdio, windowsHide: true });
        children.push(child);
        for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
          if (!stream) continue;
          const toTerminal = echo(run, name), prefix = multi ? `[s${i}] ` : '';
          let pending = '';
          // Authentication output is intentionally omitted: Playwright errors can
          // include entered passwords, including across stream chunk boundaries.
          stream.on('data', chunk => {
            if (auth) return;
            if (!multi) { fs.writeSync(log, chunk); toTerminal(chunk); return; }
            const lines = (pending + chunk.toString()).split(/\r?\n/); pending = lines.pop();
            for (const line of lines) { fs.writeSync(log, `${prefix}${line}\n`); toTerminal(`${prefix}${line}\n`); }
          });
        }
        child.once('error', e => settle(i, null, e));
        // With piped output, 'close' fires only after the last chunk is written to runner.log.
        child.once(child.stdout ? 'close' : 'exit', code => settle(i, code));
      } catch (error) { settle(i, null, error); }
    };
    try {
      logger?.(`[run ${run.id.slice(0, 8)}] Started ${auth ? 'authentication' : `${run.module.id}: ${planned.length} case(s), ${plan.length} worker(s)`} on ${environment.name ?? environment.id} (${environment.url})`);
      const timer = setInterval(() => { syncEvents(run); run.timing = summarizeTiming(run, timing); store.saveRun(run); }, 1000);
      active = { run, children, timer, timers };
      startShard(0);
      // Stagger extra shards so they do not log in or generate time-based data in the same millisecond.
      for (let i = 1; i < plan.length; i++) timers.push(setTimeout(() => startShard(i), i * (options.staggerMs ?? 1500)));
    } catch (error) {
      active = { run, children, timer: null, timers }; finish(null, error);
    }
  }
  function stopChild(child) {
    if (process.platform === 'win32' && child.pid) {
      // A fixed executable and numeric PID terminate the complete worker tree.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else child.kill('SIGTERM');
  }
  return {
    dirFor, pump,
    cancel(id) {
      const run = store.run(id);
      if (!run || !['queued', 'running'].includes(run.status)) return false;
      if (active?.run.id === id) {
        active.run.cancelRequested = true; store.saveRun(active.run); active.children.forEach(stopChild);
      } else store.saveRun({ ...run, status: 'cancelled', finishedAt: new Date().toISOString() });
      return true;
    },
    async stop() {
      stopping = true;
      if (!active) return;
      await Promise.all(active.children.map(child => new Promise(resolve => {
        if (child.exitCode !== null && child.exitCode !== undefined) return resolve();
        child.once(child.stdout ? 'close' : 'exit', resolve); stopChild(child);
      })));
    },
  };
}
