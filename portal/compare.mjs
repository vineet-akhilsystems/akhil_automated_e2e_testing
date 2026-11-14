import { safeReportText } from './quality.mjs';
// Run-to-run comparison and JUnit export. Pure functions over stored run documents.
const BAD = new Set(['FAIL', 'FAIL (assumed requirement)', 'ERROR']);
const state = r => (!r ? 'absent' : r.status === 'PASS' ? 'pass' : BAD.has(r.status) ? 'fail' : 'other');

/** The finished automated run of the same module and environment that ended just before `run`. */
export function previousRun(runs, run) {
  const done = new Set(['passed', 'failed', 'error', 'blocked']);
  return runs.filter(r => r.id !== run.id && r.kind === 'tests' && r.mode === 'automated' && done.has(r.status) && r.module?.id === run.module?.id && r.environmentId === run.environmentId
      && String(r.finishedAt ?? r.createdAt) < String(run.finishedAt ?? run.createdAt))
    .sort((a, b) => String(b.finishedAt ?? b.createdAt).localeCompare(String(a.finishedAt ?? a.createdAt)))[0] ?? null;
}

/** What changed between `base` (older) and `head` (newer), case by case. */
export function compareRuns(base, head) {
  const b = new Map((base.results ?? []).map(r => [r.id, r])), h = new Map((head.results ?? []).map(r => [r.id, r]));
  const out = { newlyFailing: [], fixed: [], stillFailing: [], newlyFlaky: [], added: [], removed: [], slower: [] };
  const brief = (id, r, extra = {}) => ({ id, title: r?.title ?? '', status: r?.status, actual: String(r?.actual ?? '').slice(0, 200), quarantined: Boolean(r?.quarantined), ...extra });
  for (const [id, now] of h) {
    const was = b.get(id), s0 = state(was), s1 = state(now);
    if (!was) out.added.push(brief(id, now));
    else if (s0 === 'pass' && s1 === 'fail') out.newlyFailing.push(brief(id, now, { before: was.status }));
    else if (s0 === 'fail' && s1 === 'pass') out.fixed.push(brief(id, now, { before: was.status }));
    else if (s0 === 'fail' && s1 === 'fail') out.stillFailing.push(brief(id, now, { before: was.status }));
    if (now.flaky && !was?.flaky) out.newlyFlaky.push(brief(id, now));
    const t0 = was?.wallMs ?? was?.durationMs, t1 = now.wallMs ?? now.durationMs;
    if (was && t0 > 2000 && t1 > t0 * 1.5 && t1 - t0 > 2000) out.slower.push(brief(id, now, { beforeMs: t0, nowMs: t1 }));
  }
  for (const [id, was] of b) if (!h.has(id)) out.removed.push(brief(id, was));
  const rate = run => { const c = (run.results ?? []).filter(r => !['SKIPPED', 'OBSERVED', 'BLOCKED'].includes(r.status) && !r.quarantined); return c.length ? Math.round(c.filter(r => r.status === 'PASS').length / c.length * 1000) / 10 : null; };
  const wall = run => run.timing?.wallMs ?? (run.startedAt && run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null);
  const info = run => ({ id: run.id, name: run.name, at: run.finishedAt ?? run.createdAt, status: run.status, passRate: rate(run), wallMs: wall(run) });
  return { base: info(base), head: info(head), ...out, counts: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])) };
}

const xml = v => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JUnit XML (one testsuite per run) for CI systems. Quarantined failures and blocked cases are reported as skipped. */
export function toJunit(run) {
  const cases = run.cases ?? [], results = new Map((run.results ?? []).map(r => [r.id, r]));
  let failures = 0, errors = 0, skipped = 0, time = 0;
  const body = cases.map(c => {
    const r = results.get(c.id), secs = ((r?.wallMs ?? r?.durationMs ?? 0) / 1000);
    time += secs;
    const head = `<testcase classname="${xml(safeReportText(run.module?.id ?? 'module'))}.${xml(safeReportText(c.category ?? 'General'))}" name="${xml(safeReportText(`${c.id} ${c.title}`))}" time="${secs.toFixed(3)}"`;
    if (!r) { skipped++; return `${head}><skipped message="Not executed"/></testcase>`; }
    const detail = xml([`Expected: ${safeReportText(r.expected)}`, `Actual: ${safeReportText(r.actual)}`, ...(r.mismatches ?? []).map(safeReportText)].join('\n'));
    if (r.quarantined && BAD.has(r.status)) { skipped++; return `${head}><skipped message="Quarantined: ${xml(r.status)}"/><system-out>${detail}</system-out></testcase>`; }
    if (r.status === 'ERROR') { errors++; return `${head}><error message="${xml(safeReportText(r.actual ?? 'error').split('\n')[0].slice(0, 300))}">${detail}</error></testcase>`; }
    if (BAD.has(r.status)) { failures++; return `${head}><failure message="${xml(safeReportText(r.mismatches?.[0] ?? r.actual ?? r.status))}" type="${xml(r.status)}">${detail}</failure></testcase>`; }
    if (['SKIPPED', 'BLOCKED'].includes(r.status)) { skipped++; return `${head}><skipped message="${xml(r.status)}"/></testcase>`; }
    return `${head}>${r.flaky ? `<system-out>Flaky: passed on attempt ${xml(r.attempts ?? 2)}</system-out>` : ''}</testcase>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${xml(safeReportText(run.name))}" tests="${cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${time.toFixed(3)}">\n<testsuite name="${xml(safeReportText(run.module?.name ?? 'module'))} on ${xml(safeReportText(run.environmentName))}" tests="${cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${time.toFixed(3)}" timestamp="${xml(run.startedAt ?? run.createdAt)}">\n${body.join('\n')}\n</testsuite>\n</testsuites>\n`;
}
