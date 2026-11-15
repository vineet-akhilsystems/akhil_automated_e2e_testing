import { safeReportText } from './quality.mjs';
// Run-to-run comparison and JUnit export. Pure functions over stored run documents.
const BAD = new Set(['FAIL', 'FAIL (assumed requirement)', 'ERROR']);
const state = r => (!r ? 'absent' : r.status === 'PASS' ? 'pass' : BAD.has(r.status) ? 'fail' : 'other');

/** The finished run of the same mode (automated or manual), module and environment that ended just before `run`. */
export function previousRun(runs, run) {
  const done = new Set(['passed', 'failed', 'error', 'blocked']);
  return runs.filter(r => r.id !== run.id && r.kind === 'tests' && r.mode === run.mode && done.has(r.status) && r.module?.id === run.module?.id && r.environmentId === run.environmentId
      && String(r.finishedAt ?? r.createdAt) < String(run.finishedAt ?? run.createdAt))
    .sort((a, b) => String(b.finishedAt ?? b.createdAt).localeCompare(String(a.finishedAt ?? a.createdAt)))[0] ?? null;
}

const UNKNOWN = 'unknown';
/** The three version facts of one run, with "unknown" for anything missing (old runs have none of these fields). */
export function runVersions(run) {
  const label = typeof run?.appVersion?.label === 'string' && run.appVersion.label ? run.appVersion.label : null;
  const hash = run?.profile?.hash ? String(run.profile.hash).slice(0, 6) : null;
  const number = Number.isInteger(run?.automationVersion?.number) ? run.automationVersion.number : null;
  return { appVersion: { label: label ?? UNKNOWN, source: label ? (run.appVersion.source ?? UNKNOWN) : UNKNOWN }, profileHash: hash ?? UNKNOWN, automationVersion: number ?? UNKNOWN };
}

/**
 * Version facts for two runs (base = older, may be null; head = newer) plus plain-language HINTS.
 * A hint says what to check, never what caused a failure. An unknown value is never treated as a difference.
 */
export function versionDifferences(base, head) {
  const h = runVersions(head), b = base ? runVersions(base) : null;
  const out = { head: h, ...(b ? { base: b } : {}) };
  const hints = [];
  if (!b) hints.push('No earlier run to compare versions with.');
  else {
    const dims = [
      ['appVersion', 'Application version', b.appVersion.label, h.appVersion.label, x => x, 'the application may have changed, so confirm the behaviour with the team before changing a test'],
      ['profile', 'Login profile settings', b.profileHash, h.profileHash, x => x, 'check that both runs used the same login profile settings'],
      ['automation', 'Automation version', b.automationVersion, h.automationVersion, x => 'v' + x, 'check the changed files before blaming the app'],
    ];
    out.differs = {};
    for (const [key, label, was, now, fmt, advice] of dims) {
      if (was === UNKNOWN || now === UNKNOWN) {
        out.differs[key] = null;
        if (key === 'profile' && was === now) continue; // neither run has a profile: nothing to say
        hints.push(`${label} unknown for ${was === UNKNOWN && now === UNKNOWN ? 'both runs' : was === UNKNOWN ? 'the earlier run' : 'the newer run'}, so it cannot be compared.`);
      } else if (was !== now) { out.differs[key] = true; hints.push(`${label} differs (${fmt(was)} vs ${fmt(now)}): ${advice}.`); }
      else out.differs[key] = false;
    }
    if (Object.values(out.differs).every(v => v === false)) hints.push('No version difference recorded between the two runs.');
  }
  out.hints = hints;
  out.hint = `HINT (not a verdict): ${hints.join(' ')}`;
  return out;
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
  return { base: info(base), head: info(head), versionDifferences: versionDifferences(base, head), ...out, counts: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])) };
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
