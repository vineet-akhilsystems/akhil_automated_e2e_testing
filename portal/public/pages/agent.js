import { api } from '../api.js';
import { humanKey } from '../components/badges.js';
import { $, badge, date, esc, formatBytes, icon, isApproved } from '../components/dom.js';
import { toast } from '../components/widgets.js';
import { onIntake, refreshIntake } from './intake.js';
import { pipelineConflict, proposeGate, refreshReadiness } from './pipeline.js';
import { bootUrl } from './workspace.js';
import { can } from '../permissions.js';
import { renderPage } from '../router.js';
import { currentModule, state } from '../state.js';


// ----- Coding agent (runs on the portal server; the UI only starts, watches and cancels jobs) -----
const AGENT_NAMES = { claude: 'Claude Code', codex: 'Codex' };
const agentName = id => AGENT_NAMES[id] ?? humanKey(id ?? 'agent');
export const agentStore = { get() { try { return localStorage.getItem('qa.codingAgent'); } catch { return null; } }, set(v) { try { localStorage.setItem('qa.codingAgent', v); } catch { /* choice is just not remembered */ } } };
Object.assign(state, { agentStatus: null, agentStatusError: '', agentJobs: {}, agentRuns: {}, agentPick: agentStore.get() });
export const runKey = (moduleId, kind) => `${moduleId}:${kind}`;
const agentChoice = () => { const av = (state.agentStatus?.agents ?? []).filter(a => a.available); return av.some(a => a.id === state.agentPick) ? state.agentPick : av[0]?.id ?? ''; };
const agentTime = t => { if (t == null || t === '') return ''; const d = new Date(t); return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleTimeString(); };
const agentStatusBadge = s => badge(s === 'running' ? 'Running' : s === 'done' ? 'Finished' : s === 'cancelled' ? 'Cancelled' : s === 'error' ? 'Failed' : s === 'interrupted' ? 'Interrupted' : s ?? 'Unknown', s === 'running' ? 'running' : s === 'done' ? 'green' : s === 'error' ? 'fail' : 'orange');
export async function loadAgentStatus() {
  try { state.agentStatus = await api('/api/agent/status'); state.agentStatusError = ''; }
  catch (e) { state.agentStatus = null; state.agentStatusError = e.message; }
}
async function loadAgentJobs(id) {
  try { const r = await api(`/api/modules/${id}/agent/jobs`); state.agentJobs[id] = Array.isArray(r) ? r : r.jobs ?? []; }
  catch { state.agentJobs[id] ??= []; }
}
export async function loadAgent(id) {
  await Promise.all([loadAgentStatus(), loadAgentJobs(id)]);
  for (const kind of ['analyze', 'automation']) {
    const latest = (state.agentJobs[id] ?? []).find(j => j.kind === kind);
    if (!state.agentRuns[runKey(id, kind)] && (latest?.status === 'running' || latest?.status === 'interrupted')) { try { await openAgentJob(id, kind, latest.id); } catch { /* shown in the history list instead */ } }
  }
  paintAgent('analyze'); paintAgent('automation');
}
export async function openAgentJob(moduleId, kind, jobId) {
  const job = await api(`/api/modules/${moduleId}/agent/jobs/${encodeURIComponent(jobId)}`);
  const run = state.agentRuns[runKey(moduleId, kind)] = { moduleId, kind, jobId, job, failures: 0, file: null };
  paintAgent(kind); if (job.status === 'running') pollAgent(run);
}
export async function startAgent(kind, force = false) {
  const m = currentModule(), body = { agent: agentChoice(), kind };
  if (force) body.force = true;
  if (kind === 'analyze') { const ids = [...state.intakeSel ?? []].filter(id => state.intake?.files?.some(f => f.id === id)); if (ids.length) body.fileIds = ids; }
  let r;
  try { r = await api(`/api/modules/${m.id}/agent/jobs`, 'POST', body); }
  catch (e) { if (pipelineConflict(m, kind, e)) return; if (e.status === 409) loadAgentStatus().then(() => paintAgent(kind)); throw e; }
  delete state.agentInfo[runKey(m.id, kind)];
  const run = state.agentRuns[runKey(m.id, kind)] = { moduleId: m.id, kind, jobId: r.id, job: { id: r.id, kind, agent: body.agent, status: 'running', startedAt: new Date().toISOString(), log: [], result: null }, failures: 0, file: null };
  paintAgent(kind); pollAgent(run); loadAgentStatus().then(() => paintAgent(kind));
}
export async function pollAgent(run) {
  if (run.polling) return; run.polling = true;
  try {
    while (run.job.status === 'running') {
      await new Promise(r => setTimeout(r, 1500));
      try { run.job = await api(`/api/modules/${run.moduleId}/agent/jobs/${encodeURIComponent(run.jobId)}`); run.failures = 0; }
      catch (e) { if (e.status === 404 || ++run.failures > 5) run.job = { ...run.job, status: 'error', message: e.message }; }
      paintAgent(run.kind);
    }
  } finally { run.polling = false; }
  await Promise.all([loadAgentJobs(run.moduleId), loadAgentStatus()]);
  refreshReadiness(run.moduleId).catch(() => {});
  const { job } = run, m = run.moduleId;
  if (run.kind === 'analyze' && job.status === 'done') {
    await refreshIntake(m);
    try { state.data = await api(bootUrl()); if (state.route[0] === 'modules' && state.route[1] === m) state.cases = await api(`/api/modules/${m}/cases`); } catch { /* counts refresh on next load */ }
  }
  toast(job.status === 'done' ? (run.kind === 'analyze' ? 'The coding agent finished. Insights are ready and draft cases are in the review queue.' : 'The coding agent finished. Review the proposed files below.') : job.status === 'cancelled' ? 'The coding agent job was cancelled.' : `The coding agent did not finish. ${job.message ?? ''}`, job.status === 'error');
  if (run.kind === 'analyze' && job.status === 'done' && onIntake(m)) renderPage(); else paintAgent(run.kind);
}
export async function showAgentInsights() {
  const m = currentModule(); await refreshIntake(m.id); renderPage();
  const h = $('#insights-title'); if (h) { h.tabIndex = -1; h.scrollIntoView({ block: 'start' }); h.focus({ preventScroll: true }); }
}
export async function showAgentFile(kind, path) {
  const m = currentModule(), run = state.agentRuns[runKey(m.id, kind)]; if (!run) return;
  const r = await api(`/api/modules/${m.id}/agent/jobs/${encodeURIComponent(run.jobId)}/files?path=${encodeURIComponent(path)}`);
  run.file = { path: r.path ?? path, text: r.text ?? '' }; paintAgent(kind);
}
function agentLogHtml(job) {
  const log = job?.log ?? [];
  return log.length ? log.map(l => `<div><span class="agent-t">${esc(agentTime(l.t))}</span> ${esc(l.text)}</div>`).join('') : `<div class="agent-t">${job ? 'Waiting for the agent to say something…' : 'The log appears here once a job starts.'}</div>`;
}
function agentStatusLine(run, m) {
  const job = run?.job; if (!job) return '';
  const agent = agentName(job.agent), draft = job.result?.draftCases, nFiles = job.result?.files?.length;
  if (job.status === 'running') return `Running with ${esc(agent)}… started ${esc(date(job.startedAt))}. This can take a few minutes.`;
  if (job.status === 'cancelled') return `Cancelled. ${esc(job.message ?? '')}`;
  if (job.status === 'error') return `<span class="agent-err">Failed: ${esc(job.message || 'The agent did not finish.')}</span>`;
  if (job.status === 'interrupted') return `Interrupted: the portal restarted or the job was stopped before it finished. Nothing from it was saved.${job.message ? ` ${esc(job.message)}` : ''} ${can('agent.run', m.id) ? `<button class="small" type="button" data-action="agent-retry" data-kind="${esc(job.kind ?? run.kind)}" data-id="${esc(job.id ?? run.jobId)}" data-fid="retry">Retry</button>` : ''}`;
  if (job.status !== 'done') return esc(job.message ?? '');
  if (job.kind === 'automation') return `Finished with ${esc(agent)}. ${nFiles ?? 0} proposed file${nFiles === 1 ? '' : 's'}. Nothing was installed or run.`;
  return `Finished with ${esc(agent)}. <button class="link-button" type="button" data-action="agent-insights" data-fid="insights">View the insights</button> · <a href="#/modules/${esc(m.id)}/review">Review queue</a>${draft != null ? ` (${Number(draft)} draft case${Number(draft) === 1 ? '' : 's'} waiting)` : ''}`;
}
function agentPanelInner(m, kind) {
  const auto = kind === 'automation', run = state.agentRuns[runKey(m.id, kind)], job = run?.job, running = job?.status === 'running';
  const st = state.agentStatus, agents = st?.agents ?? [], choice = agentChoice(), busy = st?.busy, otherBusy = busy && !running;
  const canGo = can('agent.run', m.id), approved = state.cases.filter(isApproved).length;
  const nSel = [...state.intakeSel ?? []].filter(id => state.intake?.files?.some(f => f.id === id)).length, nFiles = state.intake?.files?.length ?? 0;
  const gate = auto ? proposeGate(m) : null, info = state.agentInfo[runKey(m.id, kind)];
  const reason = gate?.text ?? (!choice ? '' : auto && !approved ? 'Approve at least one case first.' : !auto && !nFiles ? 'Add files to this module first.' : otherBusy ? `Another agent job is already running${busy.moduleId ? ` (module ${busy.moduleId})` : ''}. Wait for it to finish.` : '');
  const label = auto ? 'Generate automation proposal' : `Analyze with ${choice ? agentName(choice) : 'agent'}`;
  const history = (state.agentJobs[m.id] ?? []).filter(j => j.kind === kind).slice(0, 5), files = job?.result?.files ?? [];
  return `<div class="panel-heading"><div><h2 id="ag-${kind}-title">${auto ? 'Generate automation proposal' : 'Analyze with your coding agent'}</h2><span class="tiny muted">${auto ? 'For a developer to review. Not installed or run automatically.' : "Reads this module's files and writes proposals for review."}</span></div>${job ? agentStatusBadge(job.status) : ''}</div>`
    + `<div class="agent-body"><p class="agent-explain">${auto ? 'Turns the approved cases into Playwright spec files, written as proposals for a developer to review. The files are <strong>not</strong> installed or run automatically. It needs at least one approved case. It runs on the portal server using the subscription signed in there.' : "Runs on the portal server using the subscription signed in there. The agent only reads this module's uploaded files and writes proposals; nothing runs until a person approves."}</p>`
    + (state.agentStatusError ? `<div class="warning" role="status">The coding agent is not available right now: ${esc(state.agentStatusError)}</div>`
      : !st ? '<div class="tiny muted" role="status">Checking which agents are installed…</div>'
      : `<fieldset class="agent-picker"><legend class="visually-hidden">Choose the coding agent</legend>${agents.map(a => `<label class="agent-card ${a.id === choice ? 'active' : ''} ${a.available ? '' : 'off'}"><input type="radio" name="agent-${kind}" value="${esc(a.id)}" data-agent-pick data-fid="pick-${esc(a.id)}" ${a.id === choice ? 'checked' : ''} ${a.available && !running ? '' : 'disabled'}><span><strong>${esc(a.label || agentName(a.id))}</strong><span class="tiny ${a.available ? 'agent-ok' : 'muted'}">${a.available ? `Available${a.version ? ` · ${esc(a.version)}` : ''}` : 'Not installed'}${a.note ? ` · ${esc(a.note)}` : ''}</span></span></label>`).join('') || '<span class="tiny muted">No coding agents were reported by the server.</span>'}</fieldset>`)
    + (!auto && canGo && nFiles ? `<div class="tiny muted">${nSel ? `${nSel} ticked file${nSel === 1 ? '' : 's'} will be analyzed.` : 'All files in this module will be analyzed. Tick files in the table above to choose only some.'}</div>` : '')
    + `<div class="flex agent-actions">${canGo ? `<button class="primary" type="button" data-action="agent-start" data-kind="${kind}" data-fid="start" ${!choice || running || reason ? 'disabled' : ''}>${icon('sparkle')} ${running ? 'Running…' : esc(label)}</button>` : `<span class="tiny muted">You can watch but not start jobs.</span>`}${canGo && running ? `<button type="button" data-action="agent-cancel" data-kind="${kind}" data-fid="cancel">Cancel</button>` : ''}${canGo && reason ? `<span class="tiny muted">${esc(reason)}</span>` : ''}</div>`
    + (gate ? gate.html : '')
    + (info ? `<div class="info-strip agent-info" role="status">${icon('info')}<div><strong>Nothing new to analyse</strong><p>${esc(info)}</p></div>${canGo ? `<button type="button" class="small" data-action="agent-force" data-kind="${kind}" data-fid="force">Run anyway</button>` : ''}</div>` : '')
    + `<div class="agent-status" role="status" aria-live="polite">${agentStatusLine(run, m)}</div>`
    + `<div class="agent-log" id="ag-${kind}-log" role="log" aria-live="off" aria-label="Agent log" tabindex="0">${agentLogHtml(job)}</div>`
    + (auto && job?.status === 'done' ? `<div class="agent-files"><h3>Proposed files</h3>${files.length ? `<ul>${files.map(f => `<li><button type="button" class="small ${run.file?.path === f.path ? 'primary' : ''}" data-action="agent-file" data-kind="${kind}" data-path="${esc(f.path)}" data-fid="file-${esc(f.path)}" aria-pressed="${run.file?.path === f.path}">${esc(f.path)}</button><span class="tiny muted">${formatBytes(f.size)}</span></li>`).join('')}</ul>` : '<p class="tiny muted">The agent did not write any files.</p>'}${run.file ? `<pre class="agent-pre" tabindex="0" aria-label="Contents of ${esc(run.file.path)} (read only)">${esc(run.file.text)}</pre>` : files.length ? '<p class="tiny muted">Choose a file to read it here. Nothing is editable.</p>' : ''}</div>` : '')
    + (history.length ? `<div class="agent-history"><h3>Recent jobs</h3><ul>${history.map(j => `<li>${agentStatusBadge(j.status)}<span class="agent-hist-main">${esc(agentName(j.agent))} · ${esc(date(j.startedAt))}${j.createdBy ? ` · ${esc(j.createdBy)}` : ''}${j.message ? `<span class="tiny muted"> · ${esc(j.message)}</span>` : ''}</span>${j.status === 'interrupted' && canGo ? `<button type="button" class="small" data-action="agent-retry" data-kind="${kind}" data-id="${esc(j.id)}" data-fid="retry-${esc(j.id)}">Retry</button>` : ''}<button type="button" class="small quiet" data-action="agent-view" data-kind="${kind}" data-id="${esc(j.id)}" data-fid="view-${esc(j.id)}" aria-label="Show the log of the ${esc(agentName(j.agent))} job from ${esc(date(j.startedAt))}">View</button></li>`).join('')}</ul></div>` : '')
    + '</div>';
}
export const agentPanel = (m, kind) => `<section class="panel spaced-panel agent-panel" id="ag-${kind}-panel" aria-labelledby="ag-${kind}-title">${agentPanelInner(m, kind)}</section>`;
export function paintAgent(kind) {
  const el = $(`#ag-${kind}-panel`), m = currentModule(); if (!el || !m) return;
  const fid = document.activeElement && el.contains(document.activeElement) ? document.activeElement.closest('[data-fid]')?.dataset.fid : null;
  const old = $('.agent-log', el), stick = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 30, pos = old?.scrollTop ?? 0;
  el.innerHTML = agentPanelInner(m, kind);
  const log = $('.agent-log', el); if (log) log.scrollTop = stick ? log.scrollHeight : pos;
  if (fid) el.querySelector(`[data-fid="${CSS.escape(fid)}"]`)?.focus({ preventScroll: true });
}
