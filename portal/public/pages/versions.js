import { api } from '../api.js';
import { badge, date, esc, icon } from '../components/dom.js';
import { cellTone, changedFilesSummary, columnParts, currentVersion, passRateText, triggerText } from '../components/version.js';
import { empty, heading } from '../components/widgets.js';
import { can } from '../permissions.js';
import { currentModule, state } from '../state.js';
import { moduleTabs } from './modules.js';

export async function loadVersions(moduleId) {
  const only = state.versionsOnlyDiff ? '?onlyDifferences=1' : '';
  const [list, matrix] = await Promise.all([api(`/api/modules/${moduleId}/automation-versions`), api(`/api/modules/${moduleId}/version-matrix${only}`)]);
  state.versions = { list, matrix };
}

const fileList = c => ['added', 'changed', 'removed'].map(k => (c?.[k]?.length ? `<li><strong>${k}</strong>: ${c[k].map(p => `<code>${esc(p)}</code>`).join(', ')}</li>` : '')).join('');

function versionRow(v, canEdit) {
  const sum = changedFilesSummary(v);
  const editing = state.noteEditing === v.number;
  const note = editing
    ? `<form class="note-form" data-note-form="${esc(v.number)}"><input aria-label="Note for automation v${esc(v.number)}" name="note" maxlength="300" value="${esc(v.note)}"><button class="small primary" type="submit">Save</button><button class="small quiet" type="button" data-action="version-note-cancel">Cancel</button></form>`
    : `${v.note ? esc(v.note) : '<span class="muted">No note</span>'}${canEdit ? ` <button class="small quiet" type="button" data-action="version-note-edit" data-number="${esc(v.number)}" aria-label="Edit note for automation v${esc(v.number)}">${icon('edit')}</button>` : ''}`;
  const git = v.uncommitted ? ` ${badge(`Uncommitted${v.gitCommit ? ` (on ${String(v.gitCommit).slice(0, 7)})` : ''}`, 'orange')}`
    : v.gitCommit ? ` <span class="tiny muted" title="Git commit">${esc(String(v.gitCommit).slice(0, 7))}</span>` : '';
  return `<tr data-version="${esc(v.number)}"><td><strong>v${esc(v.number)}</strong> ${v.current ? badge('Current', 'green') : ''}${git}</td>`
    + `<td>${esc(date(v.createdAt))}</td><td>${esc(triggerText(v))}${v.createdBy && v.trigger ? `<div class="tiny muted">${esc(v.trigger)}</div>` : ''}</td>`
    + `<td>${sum.count === null ? '<span class="muted">unknown</span>' : `<details class="changed-files"><summary>${esc(sum.label)}</summary><ul>${fileList(v.changedFiles) || '<li class="muted">No file differences.</li>'}</ul></details>`}<div class="tiny muted">${esc(v.fileCount ?? 0)} files tracked</div></td>`
    + `<td>${esc(v.runs ?? 0)}</td><td>${esc(passRateText(v.passRate))}</td><td class="version-note">${note}</td></tr>`;
}

function matrixPanel(matrix) {
  const head = `<div class="panel-heading"><div><h2>Version matrix</h2><p class="tiny muted matrix-help">Latest result of each case in the latest finished automated run of every version combination. Newest columns first.</p></div><label class="checkbox-label"><input type="checkbox" id="only-differences" data-change="only-differences" ${state.versionsOnlyDiff ? 'checked' : ''}> Only differences</label></div>`;
  if (!matrix.columns.length) return `<div class="panel matrix-panel">${head}${empty('No automated runs yet', 'Finished automated runs will appear here, one column for each version combination.')}</div>`;
  const cols = matrix.columns.map(c => { const p = columnParts(c); return `<th class="matrix-col" title="${esc(c.label)}"><span class="col-typed">${esc(p.typed)}</span><span class="col-sub">profile ${esc(p.profile)}</span><span class="col-sub">automation ${esc(p.automation)}</span></th>`; }).join('');
  const rows = matrix.rows.map(r => `<tr class="${r.differs ? 'differs' : ''}"><td><span class="case-id">${esc(r.caseId)}</span><div class="case-title-line">${esc(r.title)}</div></td>${matrix.columns.map(c => { const s = r.cells[c.key]; return `<td class="matrix-cell ${cellTone(s)}">${s === null || s === undefined ? '<span class="muted">-</span>' : esc(s)}</td>`; }).join('')}</tr>`).join('');
  return `<div class="panel matrix-panel">${head}${matrix.rows.length ? `<div class="table-scroll"><table class="matrix"><thead><tr><th>Case</th>${cols}</tr></thead><tbody>${rows}</tbody></table></div>` : empty('No differences', 'Every case has the same result in all version combinations shown.')}</div>`;
}

export function versionsPage() {
  const m = currentModule(), v = state.versions;
  const canEdit = can('module.settings', m.id);
  const action = canEdit ? `<button class="primary" type="button" data-action="register-version">${icon('plus')} Register current automation now</button>` : '';
  const out = `<a class="back-link" href="#/modules/${esc(m.id)}">${icon('back')} ${esc(m.name)} cases</a>` + heading(m.area, `Versions · ${m.name}`, 'Automation versions are made automatically from the automation files. Each run is stamped with the version it used.', action) + moduleTabs(m, 'versions');
  if (!v) return out + `<div class="panel">${empty('Versions are not available', 'Reload the page to try again.')}</div>`;
  const cur = v.list.current, found = currentVersion(v.list.versions, cur);
  const status = !cur?.hash ? '<div class="warning">The automation files could not be read, so the current version is unknown.</div>'
    : found ? `<p class="tiny muted current-line">Current automation is <strong>v${esc(found.number)}</strong>.</p>`
    : '<div class="warning">The automation files have changed since the last registered version. Click "Register current automation now" or start a run to register them.</div>';
  const table = v.list.versions.length
    ? `<div class="table-scroll"><table class="versions-table"><thead><tr><th>Version</th><th>Date</th><th>Who or trigger</th><th>Changed files (since previous number)</th><th>Runs</th><th>Pass rate</th><th>Note</th></tr></thead><tbody>${v.list.versions.map(x => versionRow(x, canEdit)).join('')}</tbody></table></div>`
    : empty('No automation versions yet', 'The first automated run, or the button above, registers version 1.');
  return `${out}<div class="panel versions-panel"><div class="panel-heading"><h2>Automation versions</h2></div>${table}</div>${status}${matrixPanel(v.matrix)}`;
}
