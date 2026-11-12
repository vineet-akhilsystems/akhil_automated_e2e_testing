import { adapters } from './registry.mjs';

export const TERMINAL = ['passed', 'failed', 'error', 'cancelled', 'interrupted', 'blocked'];
export const FINDINGS = {
  failure: { label: 'Failed assertion', prefix: 'BUG', note: 'Observed behavior did not meet the stated expectation. Root cause and final defect acceptance require triage.' },
  assumption: { label: 'Business rule review', prefix: 'RULE', note: 'The expectation was marked as an assumption. Confirm the business rule before accepting an application defect.' },
  execution: { label: 'Execution issue', prefix: 'EXEC', note: 'Execution could not verify the assertion. Investigate application availability, session, runner or environment; an application defect is not established.' },
  blocked: { label: 'Blocked test', prefix: 'BLOCK', note: 'An external dependency or precondition prevented verification.' },
};
export function classification(result) {
  return ({ FAIL: 'failure', 'FAIL (assumed requirement)': 'assumption', ERROR: 'execution', BLOCKED: 'blocked' })[result?.status] ?? null;
}
export function summarizeRun(run) {
  const counts = { total: run.cases.length, recorded: 0, passed: 0, failed: 0, assumptions: 0, errors: 0, blocked: 0, observed: 0, skipped: 0, unexecuted: 0 };
  for (const c of run.cases) {
    const r = run.results.find(r => r.id === c.id);
    if (!r) { counts.unexecuted++; continue; }
    counts.recorded++;
    const key = ({ PASS: 'passed', FAIL: 'failed', 'FAIL (assumed requirement)': 'assumptions', ERROR: 'errors', BLOCKED: 'blocked', OBSERVED: 'observed', SKIPPED: 'skipped' })[r.status];
    if (key) counts[key]++;
  }
  return counts;
}
const requirementsIn = c => String(c.requirement ?? '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
const imageAttachments = r => (r?.attachments ?? []).filter(a => String(a?.contentType ?? '').startsWith('image/'));
const isExecutedResult = r => Boolean(r && r.status !== 'SKIPPED' && r.verificationPerformed !== false);
function describeEvidence(result, safeText = s => String(s ?? '')) {
  const images = imageAttachments(result);
  const warnings = (result?.evidenceWarnings ?? []).map(safeText).filter(Boolean);
  if (!result) return { executed: false, screenshotCount: 0, evidenceWarnings: [], evidenceState: 'unexecuted', evidenceSummary: 'Not executed - no screenshot captured' };
  if (result.verificationPerformed === false) return { executed: false, screenshotCount: 0, evidenceWarnings: warnings, evidenceState: 'blocked', evidenceSummary: 'Automation blocked before application verification; no screenshot expected' };
  if (result.status === 'SKIPPED') return { executed: false, screenshotCount: images.length, evidenceWarnings: warnings, evidenceState: 'skipped', evidenceSummary: 'Skipped - no screenshot captured' };
  if (images.length > 0 && warnings.length === 0) {
    return { executed: true, screenshotCount: images.length, evidenceWarnings: [], evidenceState: 'captured', evidenceSummary: `${images.length} screenshot${images.length === 1 ? '' : 's'} captured` };
  }
  if (images.length > 0) {
    return { executed: true, screenshotCount: images.length, evidenceWarnings: warnings, evidenceState: 'partial', evidenceSummary: `${images.length} screenshot${images.length === 1 ? '' : 's'} captured (${warnings.length} capture warning${warnings.length === 1 ? '' : 's'})` };
  }
  return {
    executed: true,
    screenshotCount: 0,
    evidenceWarnings: warnings,
    evidenceState: 'missing',
    evidenceSummary: warnings.length ? `Screenshot could not be captured (${warnings[0]})` : 'Screenshot could not be captured - no image attached',
  };
}
export function moduleCoverage(module, cases, runs, environmentId) {
  const enabled = cases.filter(c => c.enabled !== false);
  const adapter = adapters[module.adapter];
  const finished = runs.filter(r => r.module.id === module.id && r.environmentId === environmentId && TERMINAL.includes(r.status))
    .sort((a, b) => String(b.finishedAt ?? b.createdAt).localeCompare(String(a.finishedAt ?? a.createdAt)));
  const evidence = new Map();
  for (const run of finished) for (const result of run.results ?? []) {
    if (evidence.has(result.id)) continue;
    const snapshot = run.cases.find(c => c.id === result.id), current = cases.find(c => c.id === result.id);
    const currentBase = current?.base ? module.config?.bases?.[current.base] : null;
    const usedBase = snapshot?.base ? run.module.config?.bases?.[snapshot.base] : null;
    const stale = !snapshot || current?.version !== snapshot.version || module.adapter !== run.module.adapter || JSON.stringify(currentBase) !== JSON.stringify(usedBase);
    const ev = describeEvidence(result, safeReportText);
    evidence.set(result.id, { status: result.status, stale, runId: run.id, at: run.finishedAt ?? run.createdAt, screenshots: ev.screenshotCount, evidenceState: ev.evidenceState, evidenceSummary: ev.evidenceSummary, evidenceWarnings: ev.evidenceWarnings });
  }
  const caseCoverage = cases.map(c => ({ id: c.id, title: c.title, enabled: c.enabled !== false, requirement: c.requirement ?? '', assumed: Boolean(c.expected?.assumed), automationReadiness: c.action === 'unavailable' ? 'blocked' : c.mode === 'automated' ? 'ready' : 'manual', latest: evidence.get(c.id) ?? null }));
  const requirements = (module.config?.requirements ?? []).map(req => {
    const linked = enabled.filter(c => requirementsIn(c).includes(req.id));
    const verified = linked.filter(c => !c.expected?.assumed && c.expected?.outcome !== 'observe' && evidence.get(c.id)?.status === 'PASS' && !evidence.get(c.id)?.stale);
    return { ...req, caseIds: linked.map(c => c.id), passedCaseIds: verified.map(c => c.id), status: !linked.length ? 'No linked cases' : verified.length === linked.length ? 'Linked checks passed' : 'Needs verification' };
  });
  const fields = adapter ? Object.entries(adapter.fields).map(([key, field]) => ({ key, label: field.label,
    exercisedBy: enabled.filter(c => c.mode === 'automated' && Object.hasOwn({ ...(module.config?.bases?.[c.base] ?? {}), ...c.input }, key)).map(c => c.id),
    checkedBy: enabled.filter(c => c.mode === 'automated' && ['values', 'fieldErrors', 'hints', 'persisted'].some(kind => Object.hasOwn(c.expected?.[kind] ?? {}, key))).map(c => c.id),
  })) : [];
  const actions = adapter ? Object.entries(adapter.actions).filter(([key]) => key !== 'unavailable').map(([key, label]) => ({ key, label, caseIds: enabled.filter(c => c.mode === 'automated' && c.action === key).map(c => c.id) })) : [];
  const variants = adapter ? adapter.variants.map(label => ({ label, caseIds: enabled.filter(c => c.mode === 'automated' && c.registrationType === label).map(c => c.id) })) : [];
  return { moduleId: module.id, environmentId, scopeNote: 'Coverage describes the defined repository and explicit checks, not all possible business behavior. Only finalized runs in this environment are considered. Case or starting-data edits make prior results stale.',
    counts: { total: cases.length, enabled: enabled.length, disabled: cases.length - enabled.length,
      notAutomated: enabled.filter(c => c.action === 'unavailable').length,
      neverRun: enabled.filter(c => !evidence.has(c.id)).length, stale: enabled.filter(c => evidence.get(c.id)?.stale).length,
      passed: enabled.filter(c => !c.expected?.assumed && !evidence.get(c.id)?.stale && evidence.get(c.id)?.status === 'PASS').length,
      failures: enabled.filter(c => !evidence.get(c.id)?.stale && ['FAIL', 'FAIL (assumed requirement)'].includes(evidence.get(c.id)?.status)).length,
      errors: enabled.filter(c => !evidence.get(c.id)?.stale && evidence.get(c.id)?.status === 'ERROR').length,
      assumed: enabled.filter(c => c.expected?.assumed).length, withoutRequirement: enabled.filter(c => !requirementsIn(c).length).length,
      fieldsWithoutChecks: fields.filter(f => !f.checkedBy.length).length, uncoveredRequirements: requirements.filter(r => !r.caseIds.length).length,
      missingEvidence: enabled.filter(c => evidence.has(c.id) && !evidence.get(c.id)?.stale && evidence.get(c.id)?.status !== 'SKIPPED' && evidence.get(c.id)?.evidenceState !== 'blocked' && evidence.get(c.id)?.screenshots === 0).length },
    requirements, fields, actions, variants, cases: caseCoverage };
}

const secretKey = /password|passwd|secret|token|authorization|cookie|session|api[-_]?key/i;
export function safeReportText(value) {
  return String(value ?? '').replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED TOKEN]')
    .replace(/((?:password|passwd|secret|access_token|refresh_token|api_key|authorization)\s*[=:]\s*)[^\s;,]+/gi, '$1[REDACTED]');
}
const safeMap = map => Object.entries(map ?? {}).map(([key, value]) => ({ key, value: secretKey.test(key) ? '[REDACTED]' : safeReportText(typeof value === 'object' ? JSON.stringify(value) : value) }));
function reproduce(run, c, input, adapter) {
  if (c.mode === 'manual' || c.sourceWorkbook) return [...c.steps.map(s => ({ action: safeReportText(s.action), expected: safeReportText(s.expected) })), ...(c.executionAdaptation ? [{ action: `Current-build execution: ${safeReportText(c.executionAdaptation)}`, expected: safeReportText(c.steps[0]?.expected) }] : [])];
  const rows = [{ action: `Open ${run.environmentUrl} and sign in with the configured test account.`, expected: 'The test account can access the module.' },
    { action: `Open ${run.module.name}${c.registrationType ? ` and select ${c.registrationType}` : ''}.`, expected: 'The selected form or module is available.' }];
  if (c.action === 'update') rows.push({ action: `Open target record: ${safeReportText(c.target)}.`, expected: 'The target record is loaded.' });
  rows.push({ action: `Enter the captured inputs listed below${c.base ? `, using starting template "${c.base}"` : ''}.`, expected: 'Use the recorded resolved values where available; template tokens are identified otherwise.' });
  rows.push({ action: adapter?.actions[c.action] ?? c.action, expected: safeReportText(c.expected?.outcome) });
  return rows;
}
export function reportModel(run) {
  const adapter = adapters[run.module.adapter], counts = summarizeRun(run);
  const findings = [];
  const cases = [];
  for (const c of run.cases) {
    const result = run.results.find(r => r.id === c.id), kind = classification(result);
    const templateInputs = { ...(run.module.config?.bases?.[c.base] ?? {}), ...c.input };
    const resolved = result?.resolvedInput;
    const input = safeMap(resolved ?? templateInputs).map(row => ({ ...row, key: adapter?.fields[row.key]?.label ?? row.key }));
    const inputSource = resolved ? 'Resolved execution inputs' : 'Case template inputs (resolved values were not captured for this run)';
    const ev = describeEvidence(result, safeReportText);
    const steps = reproduce(run, c, input, adapter);
    const observedValues = safeMap(result?.values);
    const fieldErrors = safeMap(result?.fieldErrors);
    const toasts = (result?.toasts ?? []).map(safeReportText);
    const checks = safeMap(c.expected ?? {});
    if (kind) {
      const triage = run.triage?.[c.id] ?? {};
      findings.push({ id: `${FINDINGS[kind].prefix}-${c.id}`, caseId: c.id, kind, classification: FINDINGS[kind].label, classificationNote: FINDINGS[kind].note,
        title: safeReportText(c.title), priority: c.priority ?? 'Not set', severity: kind === 'failure' ? triage.severity ?? 'Not assessed' : 'Not applicable',
        owner: safeReportText(triage.owner || 'Unassigned'), reference: safeReportText(triage.reference || 'Not linked'), impact: safeReportText(triage.impact || 'Not assessed'), triageNotes: safeReportText(triage.notes),
        requirement: safeReportText(c.requirement || 'Not linked'), suite: c.category || 'General', mode: c.mode, variant: c.registrationType ?? '',
        preconditions: safeReportText(c.preconditions), expected: safeReportText(result.expected || JSON.stringify(c.expected ?? c.steps)), actual: safeReportText(result.actual),
        mismatches: (result.mismatches ?? []).map(safeReportText), input, inputSource,
        checks, steps, observedValues, fieldErrors, toasts,
        durationMs: result.durationMs ?? 0, attachments: result.attachments ?? [],
        screenshotCount: ev.screenshotCount, evidenceWarnings: ev.evidenceWarnings, evidenceState: ev.evidenceState, evidenceSummary: ev.evidenceSummary,
      });
    }
    cases.push({
      id: c.id,
      caseId: c.id,
      title: safeReportText(c.title),
      suite: c.category || 'General',
      priority: c.priority ?? 'Not set',
      mode: c.mode,
      variant: c.registrationType ?? '',
      requirement: safeReportText(c.requirement),
      preconditions: safeReportText(c.preconditions),
      status: result?.status === 'PASS' && c.expected?.assumed ? 'PASS (assumed rule)' : result?.status ?? 'NOT EXECUTED',
      rawStatus: result?.status ?? 'NOT EXECUTED',
      inFindings: Boolean(kind),
      executed: isExecutedResult(result),
      expected: safeReportText(result?.expected || c.expected?.outcome || c.steps?.map(s => s.expected).join('; ')),
      actual: safeReportText(result?.actual || 'No result was recorded.'),
      mismatches: (result?.mismatches ?? []).map(safeReportText),
      input,
      inputSource,
      checks,
      steps,
      observedValues,
      fieldErrors,
      toasts,
      durationMs: result?.durationMs ?? 0,
      attachments: result?.attachments ?? [],
      screenshotCount: ev.screenshotCount,
      evidenceWarnings: ev.evidenceWarnings,
      evidenceState: ev.evidenceState,
      evidenceSummary: ev.evidenceSummary,
    });
  }
  const executedCases = cases.filter(c => c.executed);
  const evidenceCounts = {
    executed: executedCases.length,
    withScreenshots: executedCases.filter(c => c.screenshotCount > 0).length,
    missingScreenshots: executedCases.filter(c => c.screenshotCount === 0).length,
    warnings: executedCases.filter(c => c.evidenceWarnings.length > 0).length,
    totalScreenshots: executedCases.reduce((sum, c) => sum + c.screenshotCount, 0),
  };
  return { version: 2, title: safeReportText(run.reportDetails?.title || `${run.module.name} - Bug & Test Report`),
    preparedBy: safeReportText(run.reportDetails?.preparedBy || 'Not specified'), release: safeReportText(run.reportDetails?.release || 'Not specified'),
    build: safeReportText(run.reportDetails?.build || 'Not specified'), notes: safeReportText(run.reportDetails?.notes),
    run: { id: run.id, name: safeReportText(run.name), productId: run.productId ?? 'augastam', productName: safeReportText(run.productName || 'Augastam'), module: safeReportText(run.module.name), area: safeReportText(run.module.area), environment: safeReportText(run.environmentName), url: safeReportText(run.environmentUrl), status: run.status,
      mode: run.mode, createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt, error: safeReportText(run.error), scope: run.scope ?? null, workers: run.timing?.shardCount ?? null, wallTimeMs: run.timing?.wallMs ?? null },
    counts, evidenceCounts, assumedCases: run.cases.filter(c => c.expected?.assumed).length, findings, cases,
    scopeNote: 'This report covers only the selected case snapshots in this run. Passing cases do not prove untested requirements or modules. Observations, skipped, blocked and unexecuted cases are not passes. Severity is assessed separately from test priority. Raw server responses and saved login/session files are excluded. Review screenshot contents before sharing outside the team.' };
}
