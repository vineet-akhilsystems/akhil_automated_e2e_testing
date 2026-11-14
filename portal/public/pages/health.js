import { api } from '../api.js';
import { esc } from '../components/dom.js';
import { isAdmin, can } from '../permissions.js';
import { state } from '../state.js';

// Automation health: pass-rate and duration trend, flaky cases, run alerts and scheduled runs.
// Everything here is read from /api/trends, /api/notifications and /api/schedules; nothing is computed from guesses.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtMs = ms => ms == null ? '—' : ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;
const when = iso => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Inline SVG sparkline. `title` is read by screen readers; the last point is marked. */
export function sparkline(values, { title, fixed = null, color = 'var(--accent)' } = {}) {
  const pts = values.filter(v => v !== null && v !== undefined);
  if (pts.length < 2) return `<div class="spark-empty">${pts.length ? 'One run so far' : 'No runs yet'}</div>`;
  const w = 240, h = 56, pad = 5, lo = fixed ? fixed[0] : Math.min(...pts), hi = fixed ? fixed[1] : Math.max(...pts), span = hi - lo || 1;
  const x = i => pad + (i * (w - pad * 2)) / (pts.length - 1), y = v => h - pad - ((v - lo) / span) * (h - pad * 2);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = pts.length - 1;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(last).toFixed(1)}" cy="${y(pts[last]).toFixed(1)}" r="3.5" fill="${color}"/></svg>`;
}

const verdictBadge = v => v === 'flaky' ? '<span class="badge orange" title="Passed only on retry, or failed again after recovering more than once">Flaky</span>' : '<span class="badge" title="Started failing once in recent runs: a regression, or one that was fixed">Changed</span>';
const history = last => `<span class="flake-history" aria-label="Recent results, oldest first">${last.map(x => `<i class="fh fh-${x}" title="${x === 'P' ? 'Passed' : x === 'F' ? 'Passed on retry' : x === 'X' ? 'Failed' : 'Not counted'}"></i>`).join('')}</span>`;

let panelCount = 0;
/** Placeholder that loads itself. `module` limits it to one module; otherwise it covers the current product. */
export function healthPanel({ module = null, compact = false } = {}) {
  const id = `health-panel-${++panelCount}`;
  setTimeout(() => loadHealth(id, module, compact), 0);
  return `<div class="panel health-panel${compact ? ' compact' : ''}" id="${id}"><p class="muted">Loading automation health…</p></div>`;
}

export async function loadHealth(id, module, compact) {
  const node = document.getElementById(id); if (!node) return;
  try {
    const q = new URLSearchParams({ ...(module ? { module } : { product: state.productId ?? 'augastam' }), limit: '30' });
    const data = await api(`/api/trends?${q}`);
    if (document.getElementById(id) !== node) return;
    node.innerHTML = paintHealth(data, compact);
  } catch (error) { node.innerHTML = `<h2>Automation health</h2><p class="form-help">${esc(error.message)}</p>`; }
}

function paintHealth({ trend, summary, flaky, slowest }, compact) {
  if (!trend.length) return `<div class="panel-heading"><h2>Automation health</h2></div><p class="muted">Trends appear after the first automated run finishes. Failed cases are retried once, and a case that passes only on retry is shown here as flaky.</p>`;
  const l = summary.latest, delta = summary.delta;
  const deltaText = delta === null ? 'first measured run' : delta === 0 ? 'no change since previous run' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} points since previous run`;
  const tiles = `<div class="health-tiles">
    <div><span class="tiny muted">Latest pass rate</span><strong>${l.passRate}%</strong><small class="${delta < 0 ? 'down' : delta > 0 ? 'up' : ''}">${deltaText}</small></div>
    <div><span class="tiny muted">Average, last ${summary.runs} runs</span><strong>${summary.average}%</strong><small>${esc(l.name)}</small></div>
    <div><span class="tiny muted">Flaky cases</span><strong>${flaky.filter(f => f.verdict === 'flaky').length}</strong><small>${flaky.length ? 'need a look' : 'none detected'}</small></div>
    <div><span class="tiny muted">Latest duration</span><strong>${fmtMs(l.wallMs)}</strong><small>${l.executed} cases executed</small></div></div>`;
  const charts = `<div class="health-charts"><div><span class="tiny muted">Pass rate per run (%)</span>${sparkline(trend.map(p => p.passRate), { title: `Pass rate over the last ${trend.length} runs, latest ${l.passRate} percent`, fixed: [0, 100], color: 'var(--green)' })}</div>
    <div><span class="tiny muted">Run duration</span>${sparkline(trend.map(p => p.wallMs), { title: 'Run duration over recent runs' })}</div></div>`;
  const flakyRows = flaky.length ? `<table class="health-table"><thead><tr><th>Case</th><th>Status</th><th>Last results</th><th>Passed on retry</th></tr></thead><tbody>${flaky.slice(0, compact ? 5 : 10).map(c => `<tr><td><strong>${esc(c.id)}</strong> <span class="muted">${esc(c.title ?? '')}</span>${compact ? '' : `<div class="tiny muted">${esc(c.moduleName ?? '')}</div>`}</td><td>${verdictBadge(c.verdict)}</td><td>${history(c.last)}</td><td>${c.flakyRuns}</td></tr>`).join('')}</tbody></table><p class="tiny muted">Green = passed, amber = passed only on retry, red = failed. Flaky means it passed on retry, or failed again after recovering more than once. Changed means it started failing once (a regression, or one that was fixed).</p>` : '<p class="muted">No flaky cases detected in recent runs.</p>';
  const slow = !compact && slowest.length ? `<h3>Slowest cases in the latest run</h3><ol class="slow-list">${slowest.map(s => `<li><span><strong>${esc(s.id)}</strong> <span class="muted">${esc(s.title ?? '')}</span></span><span>${fmtMs(s.ms)}</span></li>`).join('')}</ol>` : '';
  return `<div class="panel-heading"><h2>Automation health</h2><span class="badge">last ${trend.length} automated run${trend.length === 1 ? '' : 's'}</span></div>${tiles}${charts}<h3>Flaky and changed cases</h3>${flakyRows}${slow}`;
}

// ---- Settings: run alerts and scheduled runs (administrators) ----------------------------------------------------------

export const automationShell = () => isAdmin() ? '<div class="panel alert-panel" id="alerts-panel"><p class="muted">Loading run alerts…</p></div><div class="panel alert-panel" id="schedules-panel"><p class="muted">Loading scheduled runs…</p></div>' : '';
export function loadAutomationPanels() { loadAlerts(); loadSchedules(); }

const WHEN = [['failures', 'Only when a run has failures, errors or flaky cases'], ['always', 'After every automated run'], ['never', 'Never (alerts off)']];
export async function loadAlerts() {
  const node = document.getElementById('alerts-panel'); if (!node) return;
  try {
    const a = await api('/api/notifications');
    node.innerHTML = `<h2>Run alerts</h2><p class="form-help">Post a short summary to Slack, Microsoft Teams or any address that accepts JSON when an automated run finishes. The address is stored on the server and never shown again after saving.</p>
      <form id="alerts-form" class="alerts-form"><div class="form-field"><label for="alert-url">Webhook address</label><input id="alert-url" name="webhookUrl" type="url" autocomplete="off" placeholder="${a.configured ? `Saved for ${esc(a.host)}. Paste a new address to replace it.` : 'https://hooks.slack.com/services/…'}"></div>
      <div class="form-field"><label for="alert-when">Send</label><select id="alert-when" name="when">${WHEN.map(([v, t]) => `<option value="${v}" ${a.when === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      <div class="flex"><button class="primary small" type="submit">Save alerts</button><button class="small" type="button" data-action="alert-test" ${a.configured ? '' : 'disabled'}>Send a test alert</button>${a.configured ? '<button class="small quiet" type="button" data-action="alert-clear">Remove address</button>' : ''}</div></form>
      <p class="tiny muted">${a.lastSentAt ? `Last attempt ${esc(when(a.lastSentAt))}: ${esc(a.lastResult)}` : 'No alert sent yet.'}</p>`;
  } catch (error) { node.innerHTML = `<h2>Run alerts</h2><p class="form-help">${esc(error.message)}</p>`; }
}

export async function loadSchedules() {
  const node = document.getElementById('schedules-panel'); if (!node) return;
  try {
    const list = await api(`/api/schedules?product=${encodeURIComponent(state.productId ?? 'augastam')}`);
    const modules = state.data.modules.filter(m => m.adapter), envs = state.data.environments ?? [];
    const row = s => `<tr><td><strong>${esc(s.name)}</strong><div class="tiny muted">${esc(s.moduleName ?? s.moduleId)}</div></td><td>${s.days.length === 7 ? 'Every day' : s.days.map(d => DAYS[d]).join(', ')} at ${esc(s.time)}</td><td>${s.lastError ? `<span class="badge fail" title="${esc(s.lastError)}">Could not start</span><div class="tiny muted">${esc(s.lastError)}</div>` : s.lastFiredOn ? `Last ran ${esc(s.lastFiredOn)}${s.lastRunId ? ` · <a href="#/runs/${esc(s.lastRunId)}">open run</a>` : ''}` : '<span class="muted">Not run yet</span>'}</td><td class="flex"><button class="small" data-action="schedule-toggle" data-id="${esc(s.id)}" data-enabled="${s.enabled ? '0' : '1'}">${s.enabled ? 'Pause' : 'Resume'}</button><button class="small quiet" data-action="schedule-delete" data-id="${esc(s.id)}">Delete</button></td></tr>`;
    node.innerHTML = `<h2>Scheduled runs</h2><p class="form-help">Run a module's approved automated cases on a timetable, using a saved login profile. The portal must be running at that time; if it was off, the run starts when the portal next starts that day. The application login session must still be valid.</p>
      ${list.length ? `<table class="health-table"><thead><tr><th>Schedule</th><th>When</th><th>Status</th><th></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table>` : '<p class="muted">No scheduled runs yet.</p>'}
      ${modules.length && envs.length ? `<form id="schedule-form" class="schedule-form"><h3>Add a schedule</h3><div class="form-grid">
        <div class="form-field"><label for="sch-name">Name</label><input id="sch-name" name="name" required maxlength="100" placeholder="Nightly smoke"></div>
        <div class="form-field"><label for="sch-module">Module</label><select id="sch-module" name="moduleId">${modules.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></div>
        <div class="form-field"><label for="sch-env">Login profile</label><select id="sch-env" name="environmentId">${envs.map(e => `<option value="${esc(e.id)}">${esc(e.name ?? e.id)}</option>`).join('')}</select></div>
        <div class="form-field"><label for="sch-time">Time (24-hour, server clock)</label><input id="sch-time" name="time" type="time" value="02:00" required></div></div>
        <fieldset class="day-picker"><legend class="tiny muted">Days</legend>${[1, 2, 3, 4, 5, 6, 0].map(d => `<label><input type="checkbox" name="days" value="${d}" ${d >= 1 && d <= 5 ? 'checked' : ''}> ${DAYS[d]}</label>`).join('')}</fieldset>
        <button class="primary small" type="submit">Add schedule</button></form>` : '<p class="muted">Add a module with browser automation and a login profile first.</p>'}`;
  } catch (error) { node.innerHTML = `<h2>Scheduled runs</h2><p class="form-help">${esc(error.message)}</p>`; }
}

/** Small badge for run results: shown beside a case that passed only after a retry. */
export const flakyBadge = result => result?.flaky ? `<span class="badge orange" title="Failed first, then passed on retry. The pass is real but unreliable.">Flaky · passed on attempt ${Number(result.attempts) || 2}</span>` : '';
export { can };
