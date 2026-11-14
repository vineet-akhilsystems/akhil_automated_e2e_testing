// Pure report summary. The verdict is only a suggestion for a human release decision.
import { isOpenFailure as failing } from './filter.mjs';

export const DEFAULT_CRITERIA = { blockSeverities: ['Critical', 'High'], maxExecutionIssues: 0, requireTriage: true };

const COUNTED = new Set(['PASS', 'FAIL', 'FAIL (assumed requirement)', 'ERROR']);
const UNVERIFIED = new Set(['NOT EXECUTED', 'SKIPPED', 'OBSERVED', 'BLOCKED']);
// A run that stopped early: its remaining cases were never verified.
const INCOMPLETE = ['cancelled', 'interrupted', 'error'];
const counted = row => row.executed && !row.quarantined && COUNTED.has(row.rawStatus);

function passRateOf(model) {
  let passed = 0, denom = 0;
  for (const row of model.cases ?? []) {
    if (!counted(row)) continue;
    denom++;
    if (row.rawStatus === 'PASS') passed++;
  }
  return denom ? Math.round((passed / denom) * 1000) / 10 : null;
}

export function suggestVerdict(model, criteria = DEFAULT_CRITERIA) {
  const crit = { ...DEFAULT_CRITERIA, ...criteria };
  const rows = model.cases ?? [];
  const open = (model.findings ?? []).filter(f => !f.quarantined);
  const failures = open.filter(f => f.kind === 'failure');
  const blocking = failures.filter(f => crit.blockSeverities.includes(f.severity));
  const untriaged = failures.filter(f => f.severity === 'Not assessed');
  const execution = open.filter(f => f.kind === 'execution');
  const blocked = open.filter(f => f.kind === 'blocked');
  const note = 'This is a suggestion to support a human release decision, not an approval.';
  if (blocking.length) return { value: 'do-not-release', reasons: [`${blocking.length} open failed check(s) at blocking severity (${crit.blockSeverities.join(', ')}): ${blocking.map(f => f.caseId).join(', ')}.`, note] };
  const triageReasons = [];
  const status = model.run?.status;
  if (INCOMPLETE.includes(status)) triageReasons.push(`The run ended as ${status}, so not every case was verified. Suggest re-running or reviewing the cases that did not run before any release decision.`);
  if (!rows.some(counted)) triageReasons.push('No case was executed and verified (no pass, failure, assumed-rule failure or execution issue was recorded), so the results cannot support a release.');
  if (crit.requireTriage && untriaged.length) triageReasons.push(`${untriaged.length} failed check(s) have no severity assessed: ${untriaged.map(f => f.caseId).join(', ')}.`);
  if (execution.length > crit.maxExecutionIssues) triageReasons.push(`${execution.length} case(s) had execution issues (allowed: ${crit.maxExecutionIssues}).`);
  if (blocked.length) triageReasons.push(`${blocked.length} case(s) were blocked.`);
  if (triageReasons.length) return { value: 'needs-triage', reasons: [...triageReasons, note] };
  if (open.length) return { value: 'release-with-known-issues', reasons: [`${open.length} open finding(s) remain, none at blocking severity.`, note] };
  const unverified = rows.filter(r => !r.executed || UNVERIFIED.has(r.rawStatus) || r.assumed).length;
  return { value: 'release', reasons: ['No open findings were recorded in the executed checks.',
    ...(unverified ? [`${unverified} case${unverified === 1 ? ' was' : 's were'} not executed or not verified; see Not tested.`] : []), note] };
}

export function buildSummary(model, listing, opts = {}) {
  const rows = model.cases ?? [];
  const verdict = suggestVerdict(model, opts.criteria ?? DEFAULT_CRITERIA);
  const openBugsBySeverity = {};
  const risks = [];
  for (const f of model.findings ?? []) {
    if (f.kind === 'failure' && !f.quarantined) openBugsBySeverity[f.severity] = (openBugsBySeverity[f.severity] ?? 0) + 1;
    if (f.quarantined) risks.push(`${f.caseId} failed but is quarantined, so it is not counted as an open bug: ${f.title}.`);
  }
  const tc = model.totalsByClass ?? {};
  const assumed = rows.filter(r => r.assumed).length;
  const notTested = [
    [tc['not-executed'], 'not executed'], [tc.blocked, 'blocked'], [tc.skipped, 'skipped'],
    [tc.observed, 'observed only (not a pass)'], [assumed, 'covered only by assumed rules'],
  ].filter(([n]) => n > 0).map(([n, label]) => `${n} case(s) ${label}`);
  let comparison = null;
  if (opts.previous) {
    const was = new Set();
    for (const r of opts.previous.cases ?? []) if (failing(r)) was.add(r.id);
    let newlyFailing = 0;
    for (const r of rows) if (failing(r) && !was.has(r.id)) newlyFailing++;
    const passingNow = new Set(rows.filter(r => r.rawStatus === 'PASS').map(r => r.id));
    let fixed = 0;
    for (const id of was) if (passingNow.has(id)) fixed++;
    comparison = { passRate: passRateOf(opts.previous), newlyFailing, fixed };
  }
  const run = model.run ?? {};
  return { verdict, scope: [run.module, run.environment].filter(Boolean).join(' / ') + ` (${rows.length} cases in run)`, counts: model.counts, passRate: passRateOf(model),
    openBugsBySeverity, risks, notTested, comparison,
    filterNote: listing?.active ? `Showing ${listing.shown} of ${listing.total} cases. Filter: ${listing.description}` : null };
}
