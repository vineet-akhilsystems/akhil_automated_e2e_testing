import { badge, date, esc, icon, opts } from '../components/dom.js';
import { empty, heading, searchBox, selectField, stats, textArea } from '../components/widgets.js';
import { runRow } from './modules.js';
import { can } from '../permissions.js';
import { adapterFor, state } from '../state.js';

export function runsPage() {
  const urlModule = new URLSearchParams(location.hash.split('?')[1] ?? '').get('module');
  const activeModule = urlModule || state.runModule;
  const runs = state.data.runs.filter(r => (!activeModule || r.module.id === activeModule) && (!state.runStatus || r.status === state.runStatus) && (!state.runSearch || `${r.name} ${r.module.name} ${r.environmentName ?? ''} ${r.status}`.toLowerCase().includes(state.runSearch.toLowerCase())));
  return heading('Execution workspace', 'Test runs', 'Keep every execution, its case snapshot, and the evidence in one place.', can('run.start') ?'<button class="primary" data-action="new-run">'+icon('play')+' New test run</button>' : '')
    + `<div class="toolbar"><div class="filters">${[['', 'All runs'], ['running', 'Running'], ['queued', 'Queued'], ['manual', 'Manual'], ['failed', 'Failed'], ['blocked', 'Blocked'], ['passed', 'Passed']].map(([v, label]) => `<button class="filter ${state.runStatus === v ? 'active' : ''}" data-action="run-status" data-value="${v}">${label}</button>`).join('')}</div><div class="flex"><select aria-label="Filter runs by module" data-filter="runModule">${opts([['', 'All modules'], ...state.data.modules.map(m => [m.id, m.name])], activeModule)}</select>${searchBox('Search test runs…', state.runSearch, 'runSearch')}${urlModule ? '<a class="tiny" href="#/runs">Clear module filter</a>' : ''}</div></div><div class="panel">${runs.length ? runs.map(runRow).join('') : empty('No runs here yet', 'Start a run from the case repository. Manual and automated runs will appear here.', can('run.start') ?'<button data-action="new-run">Create test run</button>' : '')}</div>`;
}
const artifactUrl = (run, name) => `/api/runs/${run.id}/files/${name.split('/').map(encodeURIComponent).join('/')}`;
export const isFindingResult = result => ['FAIL', 'ERROR', 'BLOCKED', 'FAIL (assumed requirement)'].includes(result?.status);
const imageAttachmentsOf = result => (result?.attachments ?? []).filter(a => a.contentType?.includes('image'));
export function renderKvBox(title, entries) {
  if (!entries.length) return '';
  return `<div class="kv-box"><strong>${esc(title)}</strong>${entries.map(([k, v]) => `<div class="kv-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>`;
}
export function runDetailPage() {
  const r = state.runDetail;
  if (!r) return empty('Run not found', 'Choose a run from the history.');
  const total = r.cases.length, done = r.results.length, adapter = adapterFor(r.module);
  const finalized = ['passed', 'failed', 'error', 'cancelled', 'interrupted', 'blocked'].includes(r.status);
  const executedResults = r.results.filter(x => x.status !== 'SKIPPED' && x.verificationPerformed !== false);
  const withScreenshots = executedResults.filter(x => imageAttachmentsOf(x).length > 0).length;
  const missingScreenshots = executedResults.filter(x => imageAttachmentsOf(x).length === 0).length;
  const warningsCount = r.results.filter(x => x.evidenceWarnings?.length > 0).length;
  const totalScreenshots = r.results.reduce((n, x) => n + imageAttachmentsOf(x).length, 0);
  const passedCount = r.results.filter(x => x.status === 'PASS').length;
  const findingsCount = r.results.filter(isFindingResult).length;
  const observedOrSkippedCount = r.results.filter(x => ['OBSERVED', 'SKIPPED'].includes(x.status)).length;
  const matchesFilter = (c, result) => {
    if (state.runCaseSearch && !`${c.id} ${c.title} ${c.category ?? ''} ${c.requirement ?? ''} ${result?.status ?? ''}`.toLowerCase().includes(state.runCaseSearch.toLowerCase())) return false;
    if (state.runCaseFilter === 'findings') return isFindingResult(result);
    if (state.runCaseFilter === 'passed') return result?.status === 'PASS';
    if (state.runCaseFilter === 'observed') return ['OBSERVED', 'SKIPPED'].includes(result?.status);
    if (state.runCaseFilter === 'missing-evidence') return Boolean(result && result.status !== 'SKIPPED' && (imageAttachmentsOf(result).length === 0 || result.evidenceWarnings?.length));
    return true;
  };
  const filteredCases = r.cases.filter(c => matchesFilter(c, r.results.find(x => x.id === c.id)));
  const actions = `${r.kind !== 'authentication' ? `<button class="primary" data-action="download-report" data-id="${r.id}" ${!finalized || !state.data.capabilities?.pdfReport ? 'disabled title="Finish the run and apply the server update first"' : ''}>${icon('download')} Download bug report (PDF)</button>${finalized && state.data.capabilities?.pdfReport && can('run.start', r.module.id) ?`<button data-action="report-details">Report details</button>` : ''}` : ''}<a class="back-link" href="/api/runs/${r.id}/export?format=xlsx">${icon('download')} Export Excel</a><a class="back-link" href="/api/runs/${r.id}/export">JSON</a>${['queued', 'running'].includes(r.status) && can('run.cancel', r.module.id) ? `<button class="danger" data-action="cancel-run" data-id="${r.id}">Cancel run</button>` : ''}${r.status === 'manual' && can('run.start', r.module.id) ?`<button class="primary" data-action="complete-run" data-id="${r.id}" ${done < total ? 'disabled' : ''}>Close run</button>` : ''}${['passed', 'failed', 'error', 'interrupted', 'cancelled', 'blocked'].includes(r.status) && r.kind !== 'authentication' && can('run.start', r.module.id) ? `${findingsCount ? `<button class="primary" data-action="rerun-failed" data-id="${r.id}" title="Start a new run with only the cases that failed or were blocked">${icon('play')} Re-run failures (${findingsCount})</button>` : ''}<button data-action="rerun" data-id="${r.id}">${icon('play')} Rerun all cases</button>` : ''}`;
  return `<a class="back-link" href="#/runs">${icon('back')} Test runs</a>` + heading(r.module.area || 'Test run', r.name, `${r.module.name} · ${r.environmentName} · ${r.environmentUrl}`, actions)
    + `<div class="flex between"><div class="run-subline">${badge(r.status)}<span>Created ${date(r.createdAt)}</span><span>${r.mode === 'manual' ? 'Manual execution' : r.cases.length && r.cases.every(c => c.action === 'unavailable') ? 'Automation availability check; no application execution' : 'Automated browser execution'}</span><span>${done} / ${total} cases recorded</span></div></div>${r.error ? `<div class="error-banner">${esc(r.error)}</div>` : ''}<div class="section-line"><small>Execution progress</small><small>${total ? Math.round(done / total * 100) : r.status === 'passed' ? 100 : 0}%</small></div><progress class="run-progress" max="${Math.max(total, 1)}" value="${done || (r.kind === 'authentication' && r.status === 'passed' ? 1 : 0)}" aria-label="Cases completed"></progress>
    ${r.addedDependencies?.length ? `<p class="form-help">Included prerequisite cases: ${r.addedDependencies.map(esc).join(', ')}.</p>` : ''}
    ${r.kind === 'authentication' ? `<div class="panel spaced-panel">${empty(r.status === 'passed' ? 'Application session refreshed' : 'Application login', r.status === 'passed' ? 'Return to your module to start an automated test run.' : 'The worker signs in using the selected profile. If login fails, check Settings. Login output and recordings are suppressed to protect passwords.')}</div>` : `
    <div class="spaced-panel">${stats([
      ['Passed cases', passedCount, `Of ${total} selected in this run`, 'check', 'green'],
      ['Findings & issues', findingsCount, 'Failed, rule review, error or blocked', 'info', findingsCount ? 'orange' : ''],
      ['Screenshot evidence', `${withScreenshots}/${executedResults.length}`, `${totalScreenshots} screenshot${totalScreenshots === 1 ? '' : 's'} attached`, 'layers', missingScreenshots ? 'orange' : 'green'],
      ['Screenshot gaps', missingScreenshots, warningsCount ? `${warningsCount} case(s) with capture warnings` : 'Executed without a screenshot', 'clock', missingScreenshots || warningsCount ? 'orange' : ''],
    ])}</div>
    <div class="section-line"><h2>Case results</h2><small>Cases and data captured when this run was created</small></div>
    <div class="toolbar"><div class="filters">${[
      ['', 'All cases', total],
      ['findings', 'Findings & issues', findingsCount],
      ['passed', 'Passed', passedCount],
      ['observed', 'Observed / skipped', observedOrSkippedCount],
      ['missing-evidence', 'Missing screenshot', missingScreenshots + warningsCount],
    ].map(([val, label, count]) => `<button class="filter ${state.runCaseFilter === val ? 'active' : ''}" data-action="run-case-filter" data-value="${val}">${esc(label)}<span class="count">${count}</span></button>`).join('')}</div>${searchBox('Filter run cases…', state.runCaseSearch, 'runCaseSearch')}</div>
    <div class="panel">${filteredCases.length ? filteredCases.map(c => {
      const result = r.results.find(x => x.id === c.id);
      const images = imageAttachmentsOf(result);
      const executed = Boolean(result && result.status !== 'SKIPPED' && result.verificationPerformed !== false);
      const rawInputs = result?.resolvedInput ?? (c.mode === 'automated' ? { ...(r.module.config?.bases?.[c.base] ?? {}), ...c.input } : {});
      const inputEntries = Object.entries(rawInputs ?? {}).map(([k, v]) => [adapter?.fields[k]?.label ?? k, String(v)]);
      const valueEntries = Object.entries(result?.values ?? {}).map(([k, v]) => [adapter?.fields[k]?.label ?? k, String(v)]);
      const errorEntries = Object.entries(result?.fieldErrors ?? {}).map(([k, v]) => [adapter?.fields[k]?.label ?? k, String(v)]);
      const evidenceBadge = images.length
        ? badge(`${images.length} screenshot${images.length === 1 ? '' : 's'}`, result.evidenceWarnings?.length ? 'orange' : 'green')
        : executed ? badge('No screenshot', 'fail') : '';
      return `<details class="result-case" ${result && isFindingResult(result) ? 'open' : ''}><summary>${badge(result?.status ?? (r.status === 'manual' ? 'Untested' : 'Pending'))}<span class="case-name"><span class="case-id">${esc(c.id)}</span> &nbsp;${esc(c.title)}</span>${evidenceBadge}<span class="muted tiny">${result?.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s` : ''}</span>${icon('chevron')}</summary>${c.preconditions ? `<p class="form-help"><strong>Preconditions:</strong> ${esc(c.preconditions)}</p>` : ''}${state.data.capabilities?.triage && finalized && result && isFindingResult(result) ? `<div class="triage-line"><span class="tiny muted">Severity: ${esc(r.triage?.[c.id]?.severity ?? 'Not assessed')} · Owner: ${esc(r.triage?.[c.id]?.owner || 'Unassigned')}${r.triage?.[c.id]?.reference ? ` · Ref: ${esc(r.triage[c.id].reference)}` : ''}</span>${can('triage.write', r.module.id) ? `<button class="small" data-action="triage" data-id="${c.id}">Triage finding</button>` : ''}</div>` : ''}${c.steps?.length && c.mode === 'automated' ? `<div class="form-help"><strong>Original workbook procedure</strong>${c.executionAdaptation ? `<p><strong>Current-build adaptation:</strong> ${esc(c.executionAdaptation)}</p>` : ''}${c.steps.map(s => `<p>${esc(s.action)}<br>Expected: ${esc(s.expected)}</p>`).join('')}</div>` : ''}${c.mode === 'manual' ? c.steps.map((s, i) => `<div class="manual-step"><span class="step-no">${i + 1}</span><div>${esc(s.action)}</div><div class="muted">${esc(s.expected)}</div></div>`).join('') : `<p class="form-help">Action: ${esc(adapter?.actions[c.action] ?? c.action)} · Starting data: ${esc(c.base || 'None')}${c.registrationType ? ` · Variant: ${esc(c.registrationType)}` : ''}${c.requirement ? ` · Requirement: ${esc(c.requirement)}` : ''} ${c.expected?.assumed ? '· Business rule needs review' : ''}</p>`}
      ${result ? `<div class="result-top"><div class="result-box"><strong>Expected result</strong>${esc(result.expected)}</div><div class="result-box ${isFindingResult(result) ? 'result-fail' : ''}"><strong>Actual result</strong>${esc(result.actual)}</div></div>${result.mismatches?.length ? `<ul>${result.mismatches.map(v => `<li>${esc(v)}</li>`).join('')}</ul>` : ''}
      ${(inputEntries.length || valueEntries.length || errorEntries.length) ? `<div class="kv-grid">${renderKvBox(result.resolvedInput ? 'Resolved execution inputs' : 'Configured inputs', inputEntries)}${renderKvBox('Observed field values', valueEntries)}${renderKvBox('Observed field errors', errorEntries)}</div>` : ''}
      ${result.toasts?.length ? `<p class="form-help"><strong>Observed messages:</strong> ${result.toasts.map(esc).join(' · ')}</p>` : ''}
      ${executed && images.length === 0 ? `<div class="error-banner"><strong>Screenshot could not be captured:</strong> ${esc(result.evidenceWarnings?.length ? result.evidenceWarnings.join(' · ') : 'No screenshot attachment was recorded during execution.')}</div>` : result.evidenceWarnings?.length ? `<div class="warning"><strong>Screenshot capture warning:</strong> ${esc(result.evidenceWarnings.join(' · '))}</div>` : ''}
      ${images.length ? `<div class="evidence-section"><div class="section-line"><h3>Screenshot evidence (${images.length})</h3><small>Captured stage screenshots</small></div><div class="evidence-grid">${images.map(a => `<figure class="evidence-card"><figcaption class="flex between"><span>${esc(a.name || 'Screenshot')}</span><a href="${artifactUrl(r, a.path)}" target="_blank" rel="noopener">Open full size ↗</a></figcaption><a href="${artifactUrl(r, a.path)}" target="_blank" rel="noopener"><img loading="lazy" class="evidence-image" src="${artifactUrl(r, a.path)}" alt="${esc(a.name || `Evidence for ${c.id}`)}"></a></figure>`).join('')}</div></div>` : ''}
      <div class="artifacts">${(result.attachments ?? []).map(a => `<a href="${artifactUrl(r, a.path)}" target="_blank" rel="noopener">${esc(a.name || (a.contentType?.includes('image') ? 'Screenshot' : 'Artifact'))} ↗</a>`).join('')}</div>` : '<p class="form-help">No result recorded yet.</p>'}
      ${r.status === 'manual' && can('run.start', r.module.id) ? `<form class="manual-result" data-manual-result="${c.id}"><div class="form-grid">${selectField('Result', `status-${c.id}`, ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'], result?.status ?? 'PASS')}${textArea('What actually happened?', `actual-${c.id}`, result?.actual ?? '', 'required maxlength="10000"')}</div>${state.data.capabilities?.manualEvidence ? '<label class="form-field evidence-upload">Screenshot evidence (PNG, optional)<input type="file" name="evidence" accept="image/png"><small>Up to 4 MB. Attach before closing the manual run.</small></label>' : ''}<button class="small primary" type="submit">Save result</button></form>` : ''}</details>`;
    }).join('') : empty('No matching cases in this run', 'Try a different filter or search term.')}</div>`}
    ${r.mode === 'automated' && r.status !== 'queued' ? `<div class="section-line"><h2>Runner evidence</h2><button class="small" data-action="show-log" data-id="${r.id}">View runner log</button></div><div id="runner-log"></div>` : ''}<p class="form-help">${r.mode === 'manual' && r.status === 'manual' ? 'Record all case results, then close this run to preserve the final results.' : 'Past runs retain their original case definitions even after the repository is edited.'}</p>`;
}
