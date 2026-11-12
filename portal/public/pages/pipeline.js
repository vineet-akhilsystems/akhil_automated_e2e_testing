import { api } from '../api.js';
import { humanKey } from '../components/badges.js';
import { $, badge, date, esc, icon } from '../components/dom.js';
import { field, selectField } from '../components/widgets.js';
import { loadAgentStatus, paintAgent, pollAgent, runKey } from './agent.js';
import { onIntake, refreshIntake, repaintIntake } from './intake.js';
import { whoName } from './members.js';
import { can } from '../permissions.js';
import { currentModule, state } from '../state.js';


// ---------------------------------------------------------------------------
// Module knowledge pipeline: readiness checklist, AI/automation gates, target setup, duplicate uploads,
// interrupted-job retry and insights history. Endpoints: docs/superpowers/specs/2026-11-09-module-knowledge-pipeline-design.md section 6.
// Everything degrades quietly when the server does not have an endpoint yet.
// ---------------------------------------------------------------------------
export const rdStore = { get() { try { return localStorage.getItem('qa.readinessCollapsed') === '1'; } catch { return false; } }, set(v) { try { localStorage.setItem('qa.readinessCollapsed', v ? '1' : '0'); } catch { /* collapse state is just not remembered */ } } };
Object.assign(state, { readiness: {}, readinessOff: false, rdCollapsed: rdStore.get(), setup: {}, setupOff: false, setupDraft: {}, historyOf: {}, notices: [], agentInfo: {}, pendingScroll: '' });
const RD_STATUS = { ready: ['Ready', 'green', '✓'], running: ['Running', 'running', '↻'], stale: ['Stale', 'orange', '!'], failed: ['Failed', 'fail', '✕'], missing: ['Missing', 'skipped', '○'], blocked: ['Blocked', 'blocked', '–'] };
const RD_GATES = { ai: ['sources', 'insights', 'automation'], proposal: ['sources', 'insights', 'cases', 'setup', 'discovery'] };
const rdInfo = s => RD_STATUS[s] ?? [humanKey(s ?? 'unknown'), 'skipped', '?'];
const notAvailable = e => e?.status === 404 && /not available on the server/.test(e.message);
let rdTimer, pendTimer;
function announce(text) {
  let n = document.getElementById('rd-live');
  if (!n) { n = document.createElement('div'); n.id = 'rd-live'; n.className = 'visually-hidden'; n.setAttribute('role', 'status'); n.setAttribute('aria-live', 'polite'); document.body.append(n); }
  n.textContent = ''; setTimeout(() => { n.textContent = text; }, 50);
}
async function loadReadiness(id) {
  if (state.readinessOff) return;
  try {
    const next = await api(`/api/modules/${id}/readiness`), prev = state.readiness[id];
    state.readiness[id] = next;
    const changes = (prev?.stages ?? []).flatMap(p => { const s = (next.stages ?? []).find(x => x.id === p.id); return s && s.status !== p.status ? [`${s.label ?? humanKey(s.id)} is now ${rdInfo(s.status)[0].toLowerCase()}`] : []; });
    if (changes.length) announce(`Readiness changed. ${changes.join('. ')}.`);
  } catch (e) { if (e.status === 401) throw e; if (notAvailable(e)) state.readinessOff = true; }
}
async function loadSetup(id) {
  if (state.setupOff) return;
  try { const r = await api(`/api/modules/${id}/setup`); state.setup[id] = r?.setup ?? r ?? {}; }
  catch (e) { if (e.status === 401) throw e; if (notAvailable(e)) state.setupOff = true; }
}
export async function loadHistory(id) {
  try { const r = await api(`/api/modules/${id}/insights/history`); state.historyOf[id] = Array.isArray(r) ? r : r?.versions ?? r?.history ?? []; }
  catch { state.historyOf[id] = []; }
}
export async function loadPipeline(id, sub) {
  await loadReadiness(id);
  if (sub === 'intake' && can('module.settings', id)) await loadSetup(id);
}
export function noteReadiness(id, r) { if (r && Array.isArray(r.stages)) { state.readiness[id] = r; paintReadiness(); } }
export async function refreshReadiness(id) {
  await loadReadiness(id);
  if (state.route[0] !== 'modules' || state.route[1] !== id) return;
  paintReadiness(); scheduleReadiness(id);
}
function scheduleReadiness(id) {
  clearTimeout(rdTimer);
  if (state.readiness[id]?.stages?.some(s => s.status === 'running') && state.route[0] === 'modules' && state.route[1] === id) rdTimer = setTimeout(() => refreshReadiness(id).catch(() => {}), 4000);
}
export const isPending = f => f.extract === 'pending' || f.extract === 'processing';
export function schedulePending(id) {
  clearTimeout(pendTimer);
  if (!onIntake(id) || !state.intake?.files?.some(isPending)) return;
  pendTimer = setTimeout(async () => { if (!onIntake(id)) return; await refreshIntake(id); repaintIntake(id); }, 4000);
}
export function afterRoute() {
  const id = state.route[0] === 'modules' ? state.route[1] : ''; if (!id) return;
  scheduleReadiness(id); if (state.route[2] === 'intake') schedulePending(id);
  if (state.pendingScroll) { const el = $(state.pendingScroll); state.pendingScroll = ''; if (el) { el.scrollIntoView({ block: 'start' }); $('input,select', el)?.focus({ preventScroll: true }); } }
}
function stageActionHtml(m, s) {
  const a = s.action; if (!a) return '';
  const label = typeof a === 'string' ? a : a.label ?? a.title ?? humanKey(a.id ?? 'open');
  const key = `${s.id} ${typeof a === 'string' ? '' : a.id ?? a.type ?? ''} ${label}`.toLowerCase();
  let href = typeof a === 'object' && /^#\//.test(a.href ?? '') ? a.href : '', scroll = '';
  if (!href) {
    if (/setup/.test(key)) { href = `#/modules/${m.id}/intake`; scroll = '#setup-panel'; }
    else if (s.id === 'sources' || s.id === 'insights') href = `#/modules/${m.id}/intake`;
    else if (s.id === 'smoke') href = `#/runs?module=${m.id}`;
    else href = `#/modules/${m.id}/review`;
  }
  return `<button type="button" class="small" data-action="rd-go" data-href="${esc(href)}" data-scroll="${esc(scroll)}" data-fid="rd-go-${esc(s.id)}">${esc(label)}</button>`;
}
export function readinessPanel(m) {
  const r = state.readiness[m.id]; if (state.readinessOff || !r || !Array.isArray(r.stages) || !r.stages.length) return '';
  const st = r.stages, count = k => st.filter(s => s.status === k).length, open = !state.rdCollapsed;
  const summary = `${count('ready')} of ${st.length} stages ready${count('running') ? ` · ${count('running')} running` : ''}${count('stale') ? ` · ${count('stale')} stale` : ''}${count('failed') ? ` · ${count('failed')} failed` : ''}`;
  return `<section class="panel readiness-panel" id="readiness-panel" aria-labelledby="rd-title"><div class="panel-heading"><div><h2 id="rd-title">Readiness</h2><span class="tiny muted" data-rd-summary>${esc(summary)}</span></div><div class="flex">${badge(r.canGenerateAi ? 'AI generation unlocked' : 'AI generation locked', r.canGenerateAi ? 'green' : 'orange')}<button type="button" class="small quiet" data-action="rd-toggle" data-fid="rd-toggle" aria-expanded="${open}" aria-controls="rd-body">${open ? 'Hide checklist' : 'Show checklist'}</button></div></div>`
    + (open ? `<div id="rd-body"><ol class="rd-steps" aria-label="Module pipeline stages">${st.map((s, i) => { const [label, cls, glyph] = rdInfo(s.status); return `<li class="rd-step rd-${esc(s.status)}" data-stage="${esc(s.id)}"><span class="rd-mark" aria-hidden="true">${glyph}</span><div class="rd-main"><div class="rd-title-line"><strong>${i + 1}. ${esc(s.label ?? humanKey(s.id))}</strong>${badge(label, cls)}</div>${s.detail ? `<div class="tiny muted rd-detail">${esc(s.detail)}</div>` : ''}</div>${can('module.view', m.id) ? stageActionHtml(m, s) : ''}</li>`; }).join('')}</ol></div>` : '')
    + '</section>';
}
export function paintReadiness() {
  const m = state.route[0] === 'modules' && state.route[1] ? currentModule() : null, el = $('#readiness-panel');
  if (m && el) {
    const fid = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.fid : null;
    const tmp = document.createElement('div'); tmp.innerHTML = readinessPanel(m); el.replaceWith(...tmp.childNodes);
    if (fid) $(`#readiness-panel [data-fid="${CSS.escape(fid)}"]`)?.focus({ preventScroll: true });
  }
  if (m) { paintAiGate(m); paintAgent('automation'); }
}
// ----- Gates (AI generation and automation proposal) -----
const gateBlockers = (r, kind) => (r.stages ?? []).filter(s => RD_GATES[kind].includes(s.id) && !(s.status === 'ready' || (s.id === 'insights' && s.status === 'stale')));
const blockerList = (m, r, kind) => {
  const list = gateBlockers(r, kind);
  if (list.length) return `<ul class="rd-blockers">${list.map(s => `<li><strong>${esc(s.label ?? humanKey(s.id))}</strong> ${badge(rdInfo(s.status)[0], rdInfo(s.status)[1])}${s.detail ? ` <span class="tiny muted">${esc(s.detail)}</span>` : ''} ${stageActionHtml(m, s)}</li>`).join('')}</ul>`;
  const raw = (r.blockers ?? []).map(b => typeof b === 'string' ? b : b?.detail ?? b?.reason ?? b?.message ?? b?.label ?? '').filter(Boolean);
  return raw.length ? `<ul class="rd-blockers">${raw.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
};
export const aiBlocked = m => !state.readinessOff && state.readiness[m.id]?.canGenerateAi === false;
export function aiGateInner(m) {
  const r = state.readiness[m.id]; if (state.readinessOff || !r) return '';
  if (r.canGenerateAi === false) return `<div class="warning ai-gate" role="status"><strong>AI generation unlocks when the module's automation pipeline is set up.</strong> Manual case writing, intake and analysis stay available.${blockerList(m, r, 'ai')}</div>`;
  const ins = (r.stages ?? []).find(s => s.id === 'insights');
  return ins?.status === 'stale' ? `<div class="warning ai-gate" role="status"><strong>The insights are out of date.</strong> ${esc(ins.detail || 'New sources were added since the last analysis.')} AI generation will use the older insights. Update them first for the best results. ${stageActionHtml(m, ins)}</div>` : '';
}
function paintAiGate(m) {
  const g = $('#ai-gate'); if (g) g.innerHTML = aiGateInner(m);
  const b = $('#ai-submit'); if (b) b.disabled = Boolean(state.aiThinking) || aiBlocked(m);
}
export function proposeGate(m) {
  const r = state.readiness[m.id]; if (state.readinessOff || !r || r.canProposeAutomation !== false) return null;
  const names = gateBlockers(r, 'proposal').map(s => s.label ?? humanKey(s.id));
  return { text: `Blocked until the readiness checklist is complete${names.length ? `: ${names.join(', ')}` : ''}.`, html: `<div class="warning propose-gate" role="status"><strong>The agent needs these before it can propose automation code.</strong>${blockerList(m, r, 'proposal')}</div>` };
}
// ----- Duplicate uploads, notices -----
export function duplicateName(r, u) {
  const d = r?.duplicateOf;
  const name = d && typeof d === 'object' ? d.name ?? d.id : state.intake?.files?.find(f => f.id === d)?.name ?? d;
  return String(name || r?.name || u.file.name);
}
export const noticesHtml = m => state.notices.filter(n => n.moduleId === m.id).map(n => `<div class="info-strip notice" role="status">${badge('Duplicate', 'orange')}<div><p>${esc(n.text)}</p></div><button type="button" class="small quiet" data-action="notice-dismiss" data-id="${n.id}" aria-label="Dismiss this notice">${icon('x')}</button></div>`).join('');
// ----- Target setup -----
export function setupPanel(m) {
  if (state.setupOff || !can('module.settings', m.id) || state.setup[m.id] === undefined) return '';
  const saved = state.setup[m.id] ?? {}, draft = state.setupDraft[m.id] ?? {}, sugg = state.insights?.suggestedSetup;
  const val = { moduleUrl: draft.moduleUrl ?? saved.moduleUrl ?? '', variants: draft.variants ?? (saved.variants ?? []).join(', '), loginProfileId: draft.loginProfileId ?? saved.loginProfileId ?? '' };
  const profiles = [['', 'Choose a login profile'], ...(state.data.environments ?? []).map(e => [e.id, e.name ?? e.id])];
  const suggVariants = Array.isArray(sugg?.variants) ? sugg.variants.join(', ') : sugg?.variants ?? '';
  return `<section class="panel spaced-panel" id="setup-panel" aria-labelledby="setup-title"><div class="panel-heading"><div><h2 id="setup-title">Target setup</h2><span class="tiny muted">Where this module lives in the live application. A lead confirms it once; discovery and code generation use it.</span></div>${saved.confirmedAt ? badge('Confirmed', 'green') : badge('Not confirmed', 'orange')}</div>`
    + `<form id="setup-form" class="setup-body">`
    + (sugg && (sugg.moduleUrl || suggVariants) ? `<div class="info-strip setup-suggestion" role="status">${icon('sparkle')}<div><strong>Suggested from the insights</strong><p>${sugg.moduleUrl ? `URL path <code>${esc(sugg.moduleUrl)}</code>` : ''}${suggVariants ? ` · Variants: ${esc(suggVariants)}` : ''}</p></div><button type="button" class="small" data-action="setup-suggest">Use suggestion</button></div>` : '')
    + `<div class="form-grid three">${field('Module URL path', 'setup-url', val.moduleUrl, 'maxlength="300" placeholder="/registration" autocomplete="off"', 'The page of the live application, for example /registration.')}${field('Variants or tabs', 'setup-variants', val.variants, 'maxlength="500" placeholder="OPD, IPD, Emergency" autocomplete="off"', 'Separate with commas.')}${selectField('Login profile', 'setup-profile', profiles, val.loginProfileId, 'required')}</div>`
    + `<div class="flex setup-foot"><button type="submit" class="primary">${icon('check')} ${saved.confirmedAt ? 'Save and confirm again' : 'Confirm target setup'}</button>${saved.confirmedAt ? `<span class="tiny muted">Confirmed by ${esc(whoName(saved.confirmedBy) || 'someone')} on ${esc(date(saved.confirmedAt))}</span>` : '<span class="tiny muted">Nothing is confirmed yet.</span>'}</div></form></section>`;
}
// ----- Insights version and history -----
export const insightsVersion = (d, meta) => { const v = d?.version ?? meta?.version; return v != null && v !== '' ? ` <span class="badge purple" title="Insights version">v${esc(v)}</span>` : ''; };
export function historyHtml(m) {
  const list = state.historyOf[m.id] ?? []; if (!list.length) return '';
  const sum = c => typeof c === 'string' ? c : c && typeof c === 'object' ? Object.entries(c).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${humanKey(k)}: ${Array.isArray(v) ? v.length : typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : '';
  return `<details class="insights-history"><summary><h3>History</h3><span class="count">${list.length}</span></summary><ul class="history-list">${list.map(h => `<li><span class="badge purple">v${esc(h.version ?? '?')}</span><span class="history-main"><span class="tiny">${esc(date(h.createdAt ?? h.at ?? h.date))}${whoName(h.createdBy ?? h.by ?? h.who) ? ` · ${esc(whoName(h.createdBy ?? h.by ?? h.who))}` : ''}${h.mode ? ` · ${esc(h.mode)}` : ''}</span>${sum(h.changeSummary) ? `<span class="tiny muted history-change">${esc(sum(h.changeSummary))}</span>` : ''}</span></li>`).join('')}</ul></details>`;
}
// ----- Agent jobs: interrupted retry, "nothing new" info -----
export function pipelineConflict(m, kind, e) {
  if (e.status !== 409) return false;
  if (e.body?.readiness) noteReadiness(m.id, e.body.readiness);
  if (/nothing new/i.test(e.message ?? '')) { state.agentInfo[runKey(m.id, kind)] = e.message; paintAgent(kind); return true; }
  return false;
}
export async function retryAgent(kind, jid) {
  const m = currentModule();
  const r = await api(`/api/modules/${m.id}/agent/jobs/${encodeURIComponent(jid)}/retry`, 'POST', {});
  const nid = r?.id ?? r?.jobId ?? jid;
  const run = state.agentRuns[runKey(m.id, kind)] = { moduleId: m.id, kind, jobId: nid, job: { id: nid, kind, agent: r?.agent, status: 'running', startedAt: new Date().toISOString(), log: [], result: null }, failures: 0, file: null };
  delete state.agentInfo[runKey(m.id, kind)];
  paintAgent(kind); pollAgent(run); loadAgentStatus().then(() => paintAgent(kind));
}
