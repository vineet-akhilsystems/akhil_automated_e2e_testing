import { api } from '../api.js';
import { downloadLink, extractBadge, humanKey, kindInfo, normPct } from '../components/badges.js';
import { $, badge, date, esc, formatBytes, icon } from '../components/dom.js';
import { empty, heading, toast } from '../components/widgets.js';
import { agentPanel } from './agent.js';
import { loginScreen } from './login.js';
import { moduleTabs } from './modules.js';
import { duplicateName, historyHtml, insightsVersion, loadHistory, noticesHtml, refreshReadiness, schedulePending, setupPanel } from './pipeline.js';
import { bootUrl } from './workspace.js';
import { can } from '../permissions.js';
import { renderPage } from '../router.js';
import { currentModule, drafts, state } from '../state.js';

export async function loadIntake(id) {
  state.intake = null; state.insights = null; state.intakeError = '';
  await refreshIntake(id, true);
}
export async function refreshIntake(id, firstLoad = false) {
  try { state.intake = await api(`/api/modules/${id}/intake`); state.intakeError = ''; }
  catch (e) { if (firstLoad) state.intakeError = e.message; schedulePending(id); return; }
  state.insights = null;
  if (state.intake.insights) { try { state.insights = await api(`/api/modules/${id}/insights`); } catch { /* the header still shows the summary */ } await loadHistory(id); }
  schedulePending(id);
  if (!firstLoad) refreshReadiness(id).catch(() => {});
}
export const onIntake = id => state.route[0] === 'modules' && state.route[2] === 'intake' && (!id || state.route[1] === id);
export function repaintIntake(id) { if (onIntake(id) && !document.activeElement?.matches?.('[data-staged-note], #setup-form input, #setup-form select')) renderPage(); }

function uploadRow(u) {
  const [ic, label] = kindInfo({ name: u.file.name, type: u.file.type });
  const busy = u.status === 'uploading', done = u.status === 'done';
  return `<li class="upload-row" data-up="${u.uid}"><span class="file-icon">${icon(ic)}</span><div class="upload-main"><div class="flex between"><strong class="file-name">${esc(u.file.name)}</strong><span class="tiny muted">${esc(label)} · ${formatBytes(u.file.size)}</span></div>`
    + `<input class="note-input" data-staged-note="${u.uid}" value="${esc(u.note)}" maxlength="500" placeholder="Optional note, for example 'latest agreed screen design'" aria-label="Note for ${esc(u.file.name)}" ${u.status === 'staged' ? '' : 'disabled'}>`
    + `<div class="upload-progress"><progress max="100" value="${u.pct}" data-up-progress="${u.uid}" aria-label="Upload progress for ${esc(u.file.name)}"></progress><span class="tiny" data-up-text="${u.uid}">${u.status === 'staged' ? 'Ready' : u.status === 'error' ? esc(u.error) : done ? 'Uploaded' : `${u.pct}%`}</span></div></div>`
    + `<div class="upload-actions">${u.status === 'error' ? `<button class="small" data-action="upload-retry" data-id="${u.uid}">Try again</button>` : ''}${busy || done ? '' : `<button class="small quiet" data-action="upload-remove" data-id="${u.uid}" aria-label="Remove ${esc(u.file.name)} from the list">${icon('x')}</button>`}</div></li>`;
}
function insightItem(x) {
  if (x == null || x === '') return '';
  if (typeof x !== 'object') return `<li>${esc(x)}</li>`;
  const mainKey = ['title', 'name', 'label', 'rule', 'question', 'text', 'description', 'summary', 'file'].find(k => typeof x[k] === 'string' && x[k]);
  const rest = Object.entries(x).filter(([k, v]) => k !== mainKey && v != null && v !== '' && !(Array.isArray(v) && !v.length));
  const show = v => Array.isArray(v) ? v.map(i => typeof i === 'object' ? JSON.stringify(i) : i).join(' → ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `<li>${mainKey ? `<strong>${esc(x[mainKey])}</strong>` : ''}${rest.length ? `<div class="ins-meta">${rest.map(([k, v]) => `<span><b>${esc(humanKey(k))}:</b> ${esc(show(v))}</span>`).join('')}</div>` : ''}</li>`;
}
function insightsPanel(m) {
  const d = state.insights, meta = state.intake?.insights;
  if (!meta && !d) return `<section class="panel spaced-panel">${empty('No insights yet', 'Upload the files you have, then press Analyze. You will get a summary, fields, rules, flows, edge cases and open questions here, plus draft test cases to review.')}</section>`;
  const mode = d?.mode ?? meta?.mode, when = d?.createdAt ?? meta?.createdAt, agentMode = /^agent/i.test(mode ?? '');
  const sections = [['Fields and data', 'fields'], ['Business rules', 'rules'], ['Flows', 'flows'], ['Edge cases', 'edgeCases'], ['Open questions', 'openQuestions'], ['Sources', 'sources']];
  return `<section class="panel spaced-panel insights-panel" aria-labelledby="insights-title"><div class="panel-heading"><div><h2 id="insights-title">Insights${insightsVersion(d, meta)}</h2><span class="tiny muted">Created ${date(when)}${meta?.status && meta.status !== 'done' && meta.status !== 'ok' ? ` · ${esc(meta.status)}` : ''}</span></div><div class="flex">${badge(agentMode ? `Written by coding agent (${/codex/i.test(mode) ? 'codex' : /claude/i.test(mode) ? 'claude' : 'unknown'})` : mode === 'llm' ? 'Written by AI' : mode === 'assistant' ? 'Written by your assistant' : mode === 'heuristic' ? 'Rule-based (no AI)' : 'Unknown method', mode === 'llm' || mode === 'assistant' || agentMode ? 'purple' : 'orange')}</div></div>`
    + (mode === 'heuristic' ? '<div class="warning insights-warning">These insights came from fixed rules, not an AI model, because no AI key is set on the server. They are a starting point. Read them with care and expect gaps.</div>' : mode === 'llm' || mode === 'assistant' || agentMode ? '<div class="info-strip insights-note">' + icon('sparkle') + '<div><strong>Written by an AI model from your files</strong><p>Check the points against the source files before you rely on them.</p></div></div>' : '')
    + (!d ? '<div class="empty"><p>The insights text could not be loaded. Try again in a moment.</p></div>' : `<div class="insights-body"><div class="insight-block"><h3>Summary</h3><p>${esc(d.summary || 'No summary was produced.')}</p></div>${sections.map(([title, key]) => { const items = Array.isArray(d[key]) ? d[key] : []; return `<details class="insight-block" ${items.length && key !== 'sources' ? 'open' : ''}><summary><h3>${title}</h3><span class="count">${items.length}</span></summary>${items.length ? `<ul class="insight-list">${items.map(insightItem).join('')}</ul>` : '<p class="tiny muted">Nothing found.</p>'}</details>`; }).join('')}${historyHtml(m)}</div>`)
    + '</section>';
}
export function intakePage() {
  const m = currentModule();
  if (!m) return empty('Module not found', 'Choose a module from the library.');
  const canUp = can('intake.upload', m.id), canDel = can('intake.delete', m.id), canAnalyze = can('agent.run', m.id), d = state.intake, files = d?.files ?? [], ups = state.uploads.filter(u => u.moduleId === m.id);
  const job = state.analysis?.moduleId === m.id ? state.analysis : null, analyzing = job?.status === 'running';
  const staged = ups.filter(u => u.status === 'staged').length, sel = [...state.intakeSel ?? []].filter(id => files.some(f => f.id === id));
  const actions = `${d ? downloadLink(`/api/modules/${m.id}/pack`, 'Download module pack') : ''}${canAnalyze ? `<button class="primary" data-action="intake-analyze" ${!files.length || analyzing ? 'disabled' : ''}>${icon('sparkle')} ${analyzing ? 'Analyzing…' : sel.length ? `Analyze ${sel.length} selected` : 'Analyze files'}</button>` : ''}`;
  let html = `<a class="back-link" href="#/modules/${m.id}">${icon('back')} ${esc(m.name)} cases</a>` + heading(m.area, `Intake · ${m.name}`, 'Drop in everything you know about this module: sheets, documents, screenshots, recordings. Analyze reads it and prepares insights and draft test cases for review.', actions) + moduleTabs(m, 'intake');
  if (state.intakeError) return html + `<div class="warning" role="alert">Intake is not available right now: ${esc(state.intakeError)}</div>`;
  if (!d) return html + '<div class="loading">Loading intake…</div>';
  if (canUp) html += `<label class="dropzone" data-dropzone for="intake-input"><span class="dz-icon">${icon('upload')}</span><strong>Drop files here, or click to choose</strong><span class="tiny muted">Any file type. Spreadsheets, PDFs, Word files, text, images and large videos are all fine. You can add several at once.</span><input class="visually-hidden" id="intake-input" type="file" multiple data-intake-input></label>`;
  else html += `<div class="info-strip">${icon('info')}<div><strong>View only</strong><p>You can read and download intake files. Ask a module lead to give you upload access.</p></div></div>`;
  html += noticesHtml(m);
  if (ups.length) html += `<section class="panel spaced-panel" aria-labelledby="up-title"><div class="panel-heading"><h2 id="up-title">Upload list</h2><div class="flex"><span class="tiny muted" role="status">${state.uploading ? 'Uploading… keep this page open for large files.' : `${staged} ready`}</span><button class="primary small" data-action="upload-start" ${staged && !state.uploading ? '' : 'disabled'}>${icon('upload')} Upload ${staged || ''} file${staged === 1 ? '' : 's'}</button></div></div><ul class="upload-list">${ups.map(uploadRow).join('')}</ul></section>`;
  if (job) html += `<section class="panel spaced-panel analysis-panel" aria-labelledby="an-title"><div class="panel-heading"><h2 id="an-title">Analysis</h2>${badge(job.status === 'running' ? 'Running' : job.status === 'done' ? 'Finished' : 'Failed', job.status === 'running' ? 'running' : job.status === 'done' ? 'green' : 'fail')}</div><div class="analysis-body" role="status" aria-live="polite"><progress max="100" value="${job.progress}" aria-label="Analysis progress"></progress><div class="tiny muted">${job.progress}% ${esc(job.message || '')}</div>${job.status === 'error' ? `<div class="error-banner">${esc(job.message || 'The analysis did not finish.')}</div>` : ''}${job.status === 'done' ? `<p class="tiny">Draft test cases (if any) are waiting in the <a href="#/modules/${m.id}/review">review queue</a>.</p>` : ''}</div></section>`;
  html += `<section class="panel spaced-panel" aria-labelledby="files-title"><div class="panel-heading"><h2 id="files-title">Files in this module</h2><span class="tiny muted">${files.length} file${files.length === 1 ? '' : 's'} · ${formatBytes(files.reduce((n, f) => n + (f.size || 0), 0))}</span></div>`
    + (files.length ? `<div class="table-scroll"><table><thead><tr>${canAnalyze ? '<th><span class="visually-hidden">Choose for analysis</span></th>' : ''}<th>File</th><th>Size</th><th>Text</th><th>Added</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${files.map(f => { const [ic, label] = kindInfo(f); return `<tr>${canAnalyze ? `<td><input type="checkbox" data-intake-sel="${esc(f.id)}" aria-label="Analyze only ${esc(f.name)}" ${sel.includes(f.id) ? 'checked' : ''}></td>` : ''}<td><div class="file-cell"><span class="file-icon">${icon(ic)}</span><div><strong class="file-name">${esc(f.name)}</strong><div class="tiny muted">${esc(label)}</div>${f.note ? `<div class="file-note">${esc(f.note)}</div>` : ''}</div></div></td><td>${formatBytes(f.size)}</td><td>${extractBadge(f)}</td><td class="tiny">${esc(f.uploadedBy ?? '—')}<br>${date(f.uploadedAt)}</td><td class="row-actions"><a class="icon-link" href="/api/modules/${m.id}/intake/files/${encodeURIComponent(f.id)}/download" download title="Download ${esc(f.name)}" aria-label="Download ${esc(f.name)}">${icon('download')}</a>${canDel && (can('case.delete', m.id) || f.uploadedBy === state.user?.username) ? `<button data-action="intake-delete" data-id="${esc(f.id)}" data-name="${esc(f.name)}" title="Delete ${esc(f.name)}" aria-label="Delete ${esc(f.name)}">${icon('trash')}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` + (canAnalyze ? '<div class="list-more"><span class="tiny muted">Tick files to analyze only those. Leave all unticked to analyze everything.</span></div>' : '') : empty('No files yet', canUp ? 'Drop your first file above. Nothing is shared outside this workspace.' : 'No files have been added to this module.'))
    + '</section>' + setupPanel(m) + agentPanel(m, 'analyze') + insightsPanel(m);
  return html;
}
export function addFiles(list) {
  const m = currentModule(); if (!m || !can('intake.upload', m.id)) return;
  for (const file of list) state.uploads.push({ uid: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, moduleId: m.id, file, note: '', pct: 0, status: 'staged', error: '' });
  renderPage();
}
function paintUpload(u) {
  const bar = $(`[data-up-progress="${u.uid}"]`), txt = $(`[data-up-text="${u.uid}"]`);
  if (bar) bar.value = u.pct; if (txt) txt.textContent = u.status === 'error' ? u.error : u.status === 'done' ? 'Uploaded' : `${u.pct}%`;
}
function uploadOne(u) {
  return new Promise(resolve => {
    u.status = 'uploading'; u.pct = 0; u.error = '';
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/modules/${u.moduleId}/intake/files`);
    xhr.setRequestHeader('x-file-name', encodeURIComponent(u.file.name));
    if (u.note.trim()) xhr.setRequestHeader('x-file-note', encodeURIComponent(u.note.trim()));
    xhr.setRequestHeader('Content-Type', u.file.type || 'application/octet-stream');
    xhr.upload.onprogress = e => { if (e.lengthComputable) { u.pct = Math.round(e.loaded / e.total * 100); paintUpload(u); } };
    const fail = message => { u.status = 'error'; u.error = message; paintUpload(u); resolve(); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        u.status = 'done'; u.pct = 100;
        try { const r = JSON.parse(xhr.responseText); if (r?.duplicate || r?.duplicateOf) u.duplicateOf = duplicateName(r, u); } catch { /* not JSON: treat as a normal upload */ }
        paintUpload(u); resolve(); return;
      }
      let message = ''; try { message = JSON.parse(xhr.responseText).error; } catch { /* not JSON */ }
      if (xhr.status === 401) loginScreen();
      fail(message || (xhr.status === 404 ? 'Uploads are not available on the server yet.' : xhr.status === 403 ? 'Your role cannot upload files.' : xhr.status === 413 ? 'This file is larger than the server allows.' : `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => fail('The connection dropped. Try again.');
    xhr.onabort = () => fail('Upload cancelled.');
    xhr.send(u.file);
    repaintIntake(u.moduleId);
  });
}
export async function runUploads() {
  if (state.uploading) return;
  state.uploading = true;
  const touched = new Set();
  try {
    for (let u; (u = state.uploads.find(x => x.status === 'staged'));) {
      touched.add(u.moduleId); await uploadOne(u);
      if (u.status === 'done') { state.uploads = state.uploads.filter(x => x !== u); if (u.duplicateOf) state.notices.push({ id: ++drafts.noticeSeq, moduleId: u.moduleId, text: `Already uploaded as ${u.duplicateOf}: nothing to process.` }); await refreshIntake(u.moduleId); }
      repaintIntake(u.moduleId);
    }
  } finally { state.uploading = false; }
  const failed = state.uploads.filter(u => u.status === 'error').length;
  toast(failed ? `${failed} file${failed === 1 ? '' : 's'} did not upload. See the list for the reason.` : 'Upload finished.', Boolean(failed));
  for (const id of touched) repaintIntake(id);
}
export async function startAnalysis(moduleId) {
  const ids = [...state.intakeSel ?? []];
  const r = await api(`/api/modules/${moduleId}/intake/analyze`, 'POST', ids.length ? { fileIds: ids } : {});
  const job = state.analysis = { moduleId, jobId: r.jobId, status: 'running', message: 'Starting…', progress: 0, failures: 0 };
  repaintIntake(moduleId); pollAnalysis(job);
}
async function pollAnalysis(job) {
  while (job.status === 'running') {
    await new Promise(r => setTimeout(r, 1500));
    try { const s = await api(`/api/modules/${job.moduleId}/intake/analyze/${job.jobId}`); job.status = s.status === 'done' || s.status === 'error' ? s.status : 'running'; job.message = s.message ?? ''; job.progress = normPct(s.progress); job.failures = 0; }
    catch (e) { if (++job.failures > 5) { job.status = 'error'; job.message = e.message; } }
    repaintIntake(job.moduleId);
  }
  if (job.status === 'done') {
    job.progress = 100; await refreshIntake(job.moduleId);
    try { state.data = await api(bootUrl()); if (state.route[0] === 'modules' && state.route[1] === job.moduleId) state.cases = await api(`/api/modules/${job.moduleId}/cases`); } catch { /* counts refresh on next load */ }
    toast('Analysis finished. Insights are ready and draft cases are in the review queue.');
  } else toast(`Analysis did not finish. ${job.message}`, true);
  repaintIntake(job.moduleId);
}
