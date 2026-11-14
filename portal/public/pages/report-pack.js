import { api } from '../api.js';
import { $, $$, date, esc, formatBytes } from '../components/dom.js';
import { showDialog } from '../components/dialogs.js';
import { estimateIsCurrent, describeEstimate, PACK_CLASSES, PACK_EVIDENCE, PACK_PRESETS, PACK_PRIORITIES, PACK_REPORTS, buildPackRequest } from '../report-pack-request.js';

export { PACK_PRESETS, buildPackRequest, describeEstimate };

// Dialog state lives here so the handler and the page agree on one object.
export const pack = { run: null, preset: 'default', estimateTimer: null, estimateSeq: 0, session: 0, pollTimer: null, estimateOk: false, building: false };

const checks = (name, items) => items.map(([value, text]) => `<label class="checkbox-label"><input type="checkbox" name="${name}" value="${esc(value)}" data-change="pack-field"> ${esc(text)}</label>`).join('');
const listField = (id, label, help) => `<div class="form-field"><label for="${id}">${esc(label)}</label><input id="${id}" name="${id}" data-change="pack-field" autocomplete="off"><small>${esc(help)}</small></div>`;

export function packDialogBody() {
  const cards = Object.entries(PACK_PRESETS).map(([key, p]) => `<button type="button" class="pack-card" data-action="pack-preset" data-preset="${key}" aria-pressed="false"><strong>${esc(p.label)}</strong><span class="tiny muted">${esc(p.hint)}</span></button>`).join('');
  return `<div class="pack-section"><h3 id="pack-need">What do you need?</h3><div class="pack-cards" role="group" aria-labelledby="pack-need">${cards}</div></div>
  <div class="pack-section"><h3>Reports</h3><div class="pack-reports">${PACK_REPORTS.map(([key, label, text]) => `<label class="pack-report"><input type="checkbox" name="rp-report" value="${key}" data-change="pack-field"><span><strong>${esc(label)}</strong><small>${esc(text)}</small></span></label>`).join('')}</div></div>
  <details class="pack-section" id="pack-filters"><summary><h3>Which cases</h3><span class="tiny muted" id="pack-filter-note">All cases</span></summary>
    <div class="pack-filter"><fieldset><legend>Result</legend><div class="pack-checks">${checks('rp-class', PACK_CLASSES)}</div></fieldset>
    <fieldset><legend>Priority</legend><div class="pack-checks">${checks('rp-priority', PACK_PRIORITIES.map(p => [p, p]))}</div></fieldset>
    <div class="form-grid">${listField('rp-suites', 'Suites', 'Separate several with commas.')}${listField('rp-requirements', 'Requirement', 'Separate several with commas.')}${listField('rp-severities', 'Severity', 'For example High, Medium.')}${listField('rp-text', 'Contains text', 'Matches the case ID, title or requirement.')}</div></div></details>
  <div class="pack-section"><div class="form-field"><label for="rp-evidence">Screenshots to include</label><select id="rp-evidence" name="rp-evidence" data-change="pack-field">${PACK_EVIDENCE.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></div></div>
  <p class="pack-estimate" id="pack-estimate" role="status" aria-live="polite">Working out the size of this pack…</p>
  <div id="pack-job" class="pack-job hidden" aria-live="polite"></div>
  <div class="pack-section"><h3>Earlier packs for this run</h3><div id="pack-earlier" class="muted tiny">Loading…</div></div>`;
}

export function showReportPackDialog(run) {
  Object.assign(pack, { run, preset: 'default', estimateOk: false, building: false });
  stopPolling();
  showDialog('Report pack', 'Choose what to hand over. The release summary shows a suggested verdict that a person still has to confirm.', packDialogBody(), 'pack-form', 'Create pack', false, 'Packs are ZIP files you can download again later.');
  applyPreset('default');
  loadEarlier();
}

export function formState() {
  const form = $('#pack-form'), all = name => $$(`[name="${name}"]:checked`, form).map(n => n.value);
  return {
    preset: 'custom', reports: all('rp-report'), evidence: $('#rp-evidence', form).value,
    filter: { classes: all('rp-class'), priorities: all('rp-priority'), suites: $('#rp-suites', form).value, requirements: $('#rp-requirements', form).value, severities: $('#rp-severities', form).value, text: $('#rp-text', form).value },
  };
}

export function applyPreset(key) {
  const form = $('#pack-form'), p = PACK_PRESETS[key];
  pack.preset = key;
  for (const n of $$('[name="rp-report"]', form)) n.checked = p.reports.includes(n.value);
  for (const n of $$('[name="rp-class"]', form)) n.checked = (p.filter.classes ?? []).includes(n.value);
  for (const n of $$('[name="rp-priority"]', form)) n.checked = (p.filter.priorities ?? []).includes(n.value);
  for (const [id, k] of [['rp-suites', 'suites'], ['rp-requirements', 'requirements'], ['rp-severities', 'severities']]) $(`#${id}`, form).value = (p.filter[k] ?? []).join(', ');
  $('#rp-text', form).value = p.filter.text ?? '';
  $('#rp-evidence', form).value = p.evidence;
  scheduleEstimate();
}

// Editing any field turns the choice into a custom pack.
export function markCustom() { pack.preset = 'custom'; }

function syncCards() {
  for (const b of $$('.pack-card')) { const on = b.dataset.preset === pack.preset; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); }
  const filters = $('#pack-filters');
  if (filters && pack.preset === 'custom') filters.open = true;
  const note = $('#pack-filter-note');
  if (note) { const f = buildPackRequest({ ...formState(), reports: ['log'] }).filter; note.textContent = Object.keys(f).length ? 'Filtered' : 'All cases'; }
}


function setEstimate(text, ok, problem = false) {
  const line = $('#pack-estimate'); if (!line) return;
  line.textContent = text; line.classList.toggle('problem', problem);
  pack.estimateOk = ok;
  updateCreate();
}
export function updateCreate() {
  const button = $('#pack-form button[type=submit]'); if (button) button.disabled = !pack.estimateOk || pack.building;
}

export function scheduleEstimate() {
  clearTimeout(pack.estimateTimer);
  pack.estimateSeq++; // every form change invalidates estimates still in flight
  syncCards();
  pack.estimateOk = false; updateCreate();
  pack.estimateTimer = setTimeout(runEstimate, 300);
}

async function runEstimate() {
  const seq = pack.estimateSeq, session = pack.session;
  let body;
  try { body = buildPackRequest(formState()); } catch (error) { setEstimate(error.message, false, true); return; }
  const current = () => session === pack.session && seq === pack.estimateSeq && $('#pack-estimate') && estimateIsCurrent(body, currentBody());
  try {
    const e = await api(`/api/runs/${pack.run.id}/report-pack/estimate`, 'POST', body);
    if (!current()) return;
    if (!e.cases) setEstimate('No cases match this filter. Widen it to create a pack.', false, true);
    else setEstimate(describeEstimate(e, pack.run.cases?.length), true);
  } catch (error) { if (current()) setEstimate(error.message, false, true); }
}
function currentBody() { try { return buildPackRequest(formState()); } catch { return null; } }

export async function createPack() {
  const body = buildPackRequest(formState()), session = pack.session;
  pack.building = true; updateCreate();
  const box = $('#pack-job'); box.classList.remove('hidden'); box.innerHTML = '<strong>Building your pack…</strong>';
  try {
    const { id } = await api(`/api/runs/${pack.run.id}/report-pack`, 'POST', body);
    if (session !== pack.session) return; // the dialog was closed or reopened meanwhile: drop it silently
    poll(id, session);
  } catch (error) {
    if (session !== pack.session) return;
    pack.building = false; updateCreate(); box.innerHTML = `<div class="error-banner">${esc(error.message)}</div>`;
  }
}

const downloadUrl = id => `/api/runs/${pack.run.id}/report-packs/${id}/download`;

function poll(id, session) {
  clearTimeout(pack.pollTimer);
  let failures = 0;
  const tick = async () => {
    if (session !== pack.session || !$('#pack-job') || !$('#dialog').open) return; // dialog closed or reopened: stop quietly
    try {
      const job = await api(`/api/runs/${pack.run.id}/report-packs/${id}`);
      if (session !== pack.session) return;
      failures = 0;
      const box = $('#pack-job'); if (!box) return;
      const lines = (job.progress ?? []).map(l => `<li>${esc(l)}</li>`).join('');
      if (job.status === 'running') {
        box.innerHTML = `<strong>Building your pack…</strong><ul class="group-list">${lines}</ul>`;
        pack.pollTimer = setTimeout(tick, 2000);
        return;
      }
      pack.building = false; updateCreate();
      if (job.status === 'done') {
        box.innerHTML = `<strong>Your pack is ready</strong><p><a class="button-link" href="${esc(downloadUrl(id))}" download>Download pack (${esc(formatBytes(job.result.size))})</a></p>`;
        loadEarlier(); box.scrollIntoView({ block: 'nearest' });
      } else box.innerHTML = `<div class="error-banner">${esc(job.error || 'The pack could not be built.')}</div>`;
    } catch (error) {
      if (session !== pack.session) return;
      if (++failures < 3) { pack.pollTimer = setTimeout(tick, 2000); return; } // one failed poll is not the end of the job
      pack.building = false; updateCreate();
      const box = $('#pack-job'); if (box) box.innerHTML = `<div class="error-banner">${esc(error.message)} The pack may still finish: check "Earlier packs for this run" below.</div>`;
    }
  };
  pack.pollTimer = setTimeout(tick, 800);
}

export function stopPolling() { clearTimeout(pack.pollTimer); clearTimeout(pack.estimateTimer); pack.estimateSeq++; pack.session++; }

export async function loadEarlier() {
  const node = $('#pack-earlier'), session = pack.session; if (!node) return;
  try {
    const jobs = (await api(`/api/runs/${pack.run.id}/report-packs`)).filter(j => j.status === 'done' && j.result).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    const target = $('#pack-earlier'); if (!target || session !== pack.session) return;
    target.className = '';
    target.innerHTML = jobs.length ? `<table class="health-table"><thead><tr><th>Created</th><th>Reports</th><th>Cases</th><th>Size</th><th><span class="sr-only">Download</span></th></tr></thead><tbody>${jobs.map(j => `<tr><td>${esc(date(j.finishedAt))}</td><td>${esc((j.request?.reports ?? []).map(k => PACK_REPORTS.find(r => r[0] === k)?.[1] ?? k).join(', '))}</td><td>${esc(j.result.manifest?.filterDescription ?? 'All cases')}</td><td>${esc(formatBytes(j.result.size))}</td><td><a href="${esc(downloadUrl(j.id))}" download>Download</a></td></tr>`).join('')}</tbody></table>` : '<p class="muted tiny">No packs yet for this run.</p>';
  } catch (error) { const target = $('#pack-earlier'); if (target) target.textContent = error.message; }
}
