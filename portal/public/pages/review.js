import { api } from '../api.js';
import { showDialog } from '../components/dialogs.js';
import { badge, date, esc, icon } from '../components/dom.js';
import { empty, heading, textArea, toast } from '../components/widgets.js';
import { agentPanel } from './agent.js';
import { moduleTabs, plainCaseSummary } from './modules.js';
import { can } from '../permissions.js';
import { reload } from '../router.js';
import { adapterFor, currentModule, drafts, state } from '../state.js';


// ----- Review queue -----
export function reviewPage() {
  const m = currentModule();
  if (!m) return empty('Module not found', 'Choose a module from the library.');
  const statusOf = c => c.reviewStatus ?? 'approved', canApprove = can('case.review', m.id), four = fourEyes(m), own = c => four && ownCase(c);
  const counts = { draft: 0, approved: 0, rejected: 0 }; state.cases.forEach(c => counts[statusOf(c)] = (counts[statusOf(c)] ?? 0) + 1);
  const list = state.cases.filter(c => !state.reviewFilter || statusOf(c) === state.reviewFilter);
  const sel = [...state.reviewSel].filter(id => list.some(c => c.id === id));
  const a = adapterFor(m);
  return `<a class="back-link" href="#/modules/${m.id}">${icon('back')} ${esc(m.name)} cases</a>` + heading(m.area, `Review queue · ${m.name}`, 'Cases made from intake files or by AI start as drafts. A person checks each one before it can be run.', `<a class="button-link" href="#/modules/${m.id}/intake">${icon('upload')} Intake</a>`) + moduleTabs(m, 'review')
    + `<div class="info-strip">${icon('info')}<div><strong>Only approved cases can be run.</strong><p>${canApprove ? 'Open a case to edit it, then approve or reject it. Use the tick boxes to decide on many at once.' : 'You can read this list. Ask a module lead to give you permission to review cases.'}${four ? ' This module needs a second person to approve: you cannot approve a case you created or last edited.' : ''}</p></div></div>`
    + `<div class="toolbar spaced-toolbar"><div class="filters" role="group" aria-label="Filter by review status">${[['draft', 'Needs review'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']].map(([v, label]) => `<button class="filter ${state.reviewFilter === v ? 'active' : ''}" data-action="review-filter" data-value="${v}" aria-pressed="${state.reviewFilter === v}">${label}<span class="count">${v ? counts[v] : state.cases.length}</span></button>`).join('')}</div></div>`
    + `<div class="panel">${canApprove && sel.length ? `<div class="selection-bar"><span>${sel.length} selected</span><div class="flex"><button class="small quiet" data-action="review-clear">Clear</button><button class="small danger" data-action="review-reject-bulk">Reject selected</button><button class="small primary" data-action="review-approve-bulk">${icon('check')} Approve selected</button></div></div>` : ''}`
    + (list.length ? `<div class="table-scroll"><table><thead><tr>${canApprove ? `<th><input type="checkbox" data-review-all aria-label="Select all cases shown" ${list.length && list.every(c => state.reviewSel.has(c.id)) ? 'checked' : ''}></th>` : ''}<th>Test case</th><th>Priority</th><th>Status</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${list.map(c => { const st = statusOf(c); return `<tr>${canApprove ? `<td><input type="checkbox" data-review-sel="${esc(c.id)}" aria-label="Select ${esc(c.id)}" ${state.reviewSel.has(c.id) ? 'checked' : ''}></td>` : ''}<td><span class="case-id">${esc(c.id)}</span><div class="case-title-static">${esc(c.title)}</div><div class="case-plain-summary">${esc(plainCaseSummary(c, a))}</div>${c.aiRationale || c.origin?.source || c.source ? `<div class="tiny muted">Why: ${esc(c.aiRationale || c.origin?.source || (typeof c.source === 'string' ? c.source : c.source?.file ?? ''))}</div>` : ''}${c.reviewedBy?.note || c.reviewNote ? `<div class="file-note">Reviewer note: ${esc(c.reviewedBy?.note || c.reviewNote)}</div>` : ''}</td><td><span class="priority ${String(c.priority).toLowerCase()}">● ${esc(c.priority)}</span></td><td>${badge(st === 'draft' ? 'Needs review' : st === 'approved' ? 'Approved' : 'Rejected', st === 'draft' ? 'orange' : st === 'approved' ? 'green' : 'fail')}${c.reviewedBy ? `<div class="tiny muted">${esc(typeof c.reviewedBy === 'string' ? c.reviewedBy : c.reviewedBy.user ?? '')}${c.reviewedBy?.at || c.reviewedAt ? ` · ${date(c.reviewedBy?.at || c.reviewedAt)}` : ''}</div>` : ''}</td><td class="row-actions review-actions">${can('case.edit', m.id) ? `<button class="small" data-action="edit-case" data-id="${esc(c.id)}">${icon('edit')} Edit</button>` : ''}${canApprove && st !== 'approved' ? `<button class="small primary" data-action="review-approve" data-id="${esc(c.id)}" ${own(c) ? `disabled title="${FOUR_EYES_TEXT}" aria-describedby="fe-${esc(c.id)}"` : ''}>Approve</button>` : ''}${canApprove && st !== 'rejected' ? `<button class="small danger" data-action="review-reject" data-id="${esc(c.id)}" ${own(c) ? `disabled title="${FOUR_EYES_TEXT}"` : ''}>Reject</button>` : ''}${canApprove && own(c) ? `<div class="tiny muted four-eyes-note" id="fe-${esc(c.id)}">${FOUR_EYES_TEXT}</div>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : empty(state.reviewFilter === 'draft' ? 'Nothing to review' : 'No cases here', state.reviewFilter === 'draft' ? 'New draft cases from intake analysis will show up here.' : 'Try a different filter.'))
    + '</div>' + (canApprove && can('agent.run', m.id) ? agentPanel(m, 'automation') : '');
}
const FOUR_EYES_TEXT = 'Another person must approve this case.';
export const fourEyes = m => m?.settings?.requireSecondApprover !== false;
export function isMine(v) {
  const u = state.user; if (!u || v == null || v === '') return false;
  return (typeof v === 'object' ? [v.id, v.username, v.user] : [v]).some(x => x != null && (String(x) === String(u.id) || String(x) === String(u.username)));
}
const ownCase = c => isMine(c.createdBy) || isMine(c.updatedBy);
export async function reviewCases(ids, decision, note) {
  const m = currentModule();
  if (fourEyes(m)) {
    const own = ids.filter(id => { const c = state.cases.find(x => x.id === id); return c && ownCase(c); });
    if (own.length) { ids = ids.filter(id => !own.includes(id)); toast(`${own.length} case${own.length === 1 ? '' : 's'} you created or edited ${own.length === 1 ? 'was' : 'were'} left out. ${FOUR_EYES_TEXT}`, true); }
  }
  if (!ids.length) return;
  await api(`/api/modules/${currentModule().id}/cases/review`, 'POST', note ? { ids, decision, note } : { ids, decision });
  ids.forEach(id => state.reviewSel.delete(id));
  await reload(); toast(`${ids.length} case${ids.length === 1 ? '' : 's'} ${decision === 'approved' ? 'approved' : 'rejected'}.`);
}
export function showRejectDialog(ids) {
  drafts.editorDraft = { rejectIds: ids };
  showDialog(`Reject ${ids.length} case${ids.length === 1 ? '' : 's'}`, 'Rejected cases stay in the list but cannot be run. A short reason helps the author.', textArea('Reason (optional)', 'reject-note', '', 'maxlength="1000" rows="3"'), 'reject-form', 'Reject', true);
}
