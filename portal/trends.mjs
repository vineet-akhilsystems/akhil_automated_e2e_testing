// Pure analytics over finished runs: quality trend and flaky-case detection. No I/O, no clock; callers pass runs in.
// A "flaky" case is one that gave a PASS only after Playwright retried it (result.flaky), or that keeps flipping between
// pass and fail across consecutive runs in the same environment. A flip alone is a hint; a pass-on-retry is proof.

const DONE = new Set(['passed', 'failed', 'error', 'blocked']);
const BAD = new Set(['FAIL', 'FAIL (assumed requirement)', 'ERROR']);
const COUNTED = r => !['SKIPPED', 'OBSERVED', 'BLOCKED'].includes(r.status);

/** Finished automated test runs, oldest first. Manual, authentication, cancelled and interrupted runs are ignored. */
export function finishedAutomatedRuns(runs) {
  return runs
    .filter(r => r.kind === 'tests' && r.mode === 'automated' && DONE.has(r.status) && Array.isArray(r.results) && r.results.length)
    .sort((a, b) => String(a.finishedAt ?? a.createdAt).localeCompare(String(b.finishedAt ?? b.createdAt)));
}

/** One point per run: pass rate over executed cases, duration, and counts. `limit` keeps the most recent points. */
export function runTrend(runs, { limit = 30 } = {}) {
  const points = finishedAutomatedRuns(runs).map(run => {
    const counted = run.results.filter(COUNTED);
    const passed = counted.filter(r => r.status === 'PASS').length;
    const wallMs = run.timing?.wallMs ?? (run.startedAt && run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null);
    return {
      runId: run.id, name: run.name, moduleId: run.module?.id, moduleName: run.module?.name, environmentName: run.environmentName,
      at: run.finishedAt ?? run.createdAt, status: run.status, executed: counted.length, passed,
      failed: counted.filter(r => BAD.has(r.status)).length, flaky: run.results.filter(r => r.flaky).length,
      passRate: counted.length ? Math.round((passed / counted.length) * 1000) / 10 : null, wallMs: Number.isFinite(wallMs) ? wallMs : null,
    };
  });
  return points.slice(-limit);
}

/**
 * Per-case history over the most recent `window` runs that executed the case.
 *  flakyRuns:  runs where the case passed only after a retry
 *  flips:      pass<->fail changes between consecutive runs in the same environment
 *  verdict:    'flaky' (passed on retry, or failed again after recovering, 2+ times), 'unstable' (one new failure: a regression or its fix),
 *              'failing' (always bad), 'stable', 'new'
 */
export function caseHealth(runs, { window = 10 } = {}) {
  const history = new Map();
  for (const run of finishedAutomatedRuns(runs)) {
    for (const r of run.results) {
      if (!COUNTED(r)) continue;
      const entry = history.get(r.id) ?? { id: r.id, title: r.title, moduleId: run.module?.id, moduleName: run.module?.name, runs: [] };
      entry.title = r.title ?? entry.title;
      entry.runs.push({ runId: run.id, at: run.finishedAt ?? run.createdAt, env: run.environmentId, status: r.status, flaky: Boolean(r.flaky), attempts: r.attempts ?? 1 });
      history.set(r.id, entry);
    }
  }
  return [...history.values()].map(entry => {
    const recent = entry.runs.slice(-window);
    // flips: any pass<->fail change. newFailures: pass->fail changes only. One failure block that was later fixed (or just
    // appeared) is a regression, not flakiness; a case that keeps failing and recovering again and again is flaky.
    let flips = 0, newFailures = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].env !== recent[i - 1].env) continue;
      const was = recent[i - 1].status === 'PASS', is = recent[i].status === 'PASS';
      if (was !== is) flips++;
      if (was && !is) newFailures++;
    }
    const flakyRuns = recent.filter(x => x.flaky).length, failures = recent.filter(x => BAD.has(x.status)).length;
    let verdict = 'stable';
    if (flakyRuns > 0 || newFailures >= 2) verdict = 'flaky';
    else if (newFailures === 1) verdict = 'unstable';
    else if (recent.length >= 2 && failures === recent.length) verdict = 'failing';
    else if (recent.length < 2) verdict = 'new';
    const transitions = Math.max(1, recent.length - 1);
    return { id: entry.id, title: entry.title, moduleId: entry.moduleId, moduleName: entry.moduleName, runs: recent.length, failures, flakyRuns, flips,
      flakeRate: Math.round(((flakyRuns + flips) / (recent.length + transitions)) * 100) / 100, verdict,
      lastStatus: recent.at(-1)?.status, last: recent.map(x => x.status === 'PASS' ? (x.flaky ? 'F' : 'P') : BAD.has(x.status) ? 'X' : '-') };
  });
}

/** Flaky and unstable cases first, worst first. */
export function flakyCases(runs, options) {
  const rank = { flaky: 0, unstable: 1 };
  return caseHealth(runs, options).filter(c => c.verdict in rank)
    .sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.flakeRate - a.flakeRate || a.id.localeCompare(b.id));
}

/** Headline numbers for the dashboard: latest vs previous pass rate, and the slowest cases of the latest run. */
export function trendSummary(points) {
  const withRate = points.filter(p => p.passRate !== null);
  const latest = withRate.at(-1) ?? null, previous = withRate.at(-2) ?? null;
  const rates = withRate.map(p => p.passRate);
  return {
    runs: points.length, latest, previous,
    delta: latest && previous ? Math.round((latest.passRate - previous.passRate) * 10) / 10 : null,
    average: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length * 10) / 10 : null,
  };
}

export function slowestCases(runs, { count = 5 } = {}) {
  const run = finishedAutomatedRuns(runs).at(-1);
  if (!run) return [];
  return run.results.filter(r => r.wallMs || r.durationMs).map(r => ({ id: r.id, title: r.title, ms: r.wallMs ?? r.durationMs, runId: run.id }))
    .sort((a, b) => b.ms - a.ms).slice(0, count);
}
