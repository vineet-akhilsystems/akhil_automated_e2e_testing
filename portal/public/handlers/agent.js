import { api } from '../api.js';
import { closeDialog, dialogError } from '../components/dialogs.js';
import { $ } from '../components/dom.js';
import { toast } from '../components/widgets.js';
import { agentStore, openAgentJob, paintAgent, runKey, showAgentFile, showAgentInsights, startAgent } from '../pages/agent.js';
import { addFiles, refreshIntake, runUploads, startAnalysis } from '../pages/intake.js';
import { reviewCases, showRejectDialog } from '../pages/review.js';
import { patchUser, showChangePasswordDialog, showUserDialog, showUserPasswordDialog, userById } from '../pages/users.js';
import { renderPage, renderRoute } from '../router.js';
import { currentModule, drafts, state } from '../state.js';


// ----- Events for the features above -----
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, id, value, name } = button.dataset;
  try {
    if (action === 'change-password') showChangePasswordDialog();
    if (action === 'user-new') showUserDialog();
    if (action === 'user-password') showUserPasswordDialog(userById(id));
    if (action === 'user-toggle') await patchUser(id, { disabled: !button.dataset.disabled }, button.dataset.disabled ? 'User enabled.' : 'User disabled. They are signed out of new sessions.');
    if (action === 'user-delete' && confirm(`Delete the user "${name}"? This cannot be undone. Disabling them is usually safer.`)) { await api(`/api/users/${encodeURIComponent(id)}`, 'DELETE'); await renderRoute(); toast('User deleted.'); }
    if (action === 'upload-start') runUploads();
    if (action === 'upload-remove') { state.uploads = state.uploads.filter(u => u.uid !== id); renderPage(); }
    if (action === 'upload-retry') { const u = state.uploads.find(x => x.uid === id); if (u) { u.status = 'staged'; u.pct = 0; u.error = ''; runUploads(); renderPage(); } }
    if (action === 'intake-analyze') await startAnalysis(currentModule().id);
    if (action === 'intake-delete' && confirm(`Delete "${name}" from this module? Insights already made from it are kept.`)) {
      await api(`/api/modules/${currentModule().id}/intake/files/${encodeURIComponent(id)}`, 'DELETE');
      state.intakeSel?.delete(id); await refreshIntake(currentModule().id); renderPage(); toast('File deleted.');
    }
    if (action === 'agent-start') await startAgent(button.dataset.kind);
    if (action === 'agent-cancel') { const run = state.agentRuns[runKey(currentModule().id, button.dataset.kind)]; if (run) { await api(`/api/modules/${run.moduleId}/agent/jobs/${encodeURIComponent(run.jobId)}/cancel`, 'POST', {}); toast('Cancelling…'); } }
    if (action === 'agent-view') await openAgentJob(currentModule().id, button.dataset.kind, id);
    if (action === 'agent-file') await showAgentFile(button.dataset.kind, button.dataset.path);
    if (action === 'agent-insights') await showAgentInsights();
    if (action === 'review-filter') { state.reviewFilter = value; renderPage(); }
    if (action === 'review-clear') { state.reviewSel.clear(); renderPage(); }
    if (action === 'review-approve') await reviewCases([id], 'approved');
    if (action === 'review-approve-bulk') await reviewCases([...state.reviewSel], 'approved');
    if (action === 'review-reject') showRejectDialog([id]);
    if (action === 'review-reject-bulk') showRejectDialog([...state.reviewSel]);
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('change', async event => {
  const el = event.target;
  try {
    if (el.matches('[data-agent-pick]')) { state.agentPick = el.value; agentStore.set(el.value); paintAgent('analyze'); paintAgent('automation'); }
    if (el.matches('[data-intake-input]')) { addFiles([...el.files]); el.value = ''; }
    if (el.matches('[data-intake-sel]')) { state.intakeSel ??= new Set(); if (el.checked) state.intakeSel.add(el.dataset.intakeSel); else state.intakeSel.delete(el.dataset.intakeSel); renderPage(); }
    if (el.matches('[data-review-sel]')) { if (el.checked) state.reviewSel.add(el.dataset.reviewSel); else state.reviewSel.delete(el.dataset.reviewSel); renderPage(); }
    if (el.matches('[data-review-all]')) { const ids = state.cases.filter(c => !state.reviewFilter || (c.reviewStatus ?? 'approved') === state.reviewFilter).map(c => c.id); ids.forEach(i => el.checked ? state.reviewSel.add(i) : state.reviewSel.delete(i)); renderPage(); }
    if (el.dataset.change === 'user-role') { try { await patchUser(el.dataset.id, { role: el.value }, 'Role updated.'); } catch (e) { await renderRoute(); throw e; } }
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.matches('[data-staged-note]')) { const u = state.uploads.find(x => x.uid === el.dataset.stagedNote); if (u) u.note = el.value; }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['user-form', 'user-password-form', 'password-form', 'reject-form'].includes(form.id)) return;
  const f = new FormData(form), button = $('button[type=submit]', form);
  if (button) button.disabled = true;
  try {
    if (form.id === 'user-form') {
      await api('/api/users', 'POST', { username: f.get('new-username').trim(), displayName: f.get('new-display').trim(), role: f.get('new-role'), password: f.get('new-password') });
      closeDialog(); await renderRoute(); toast('User added.');
    }
    if (form.id === 'user-password-form') { await patchUser(drafts.editorDraft.userId, { password: f.get('reset-password') }); closeDialog(); toast('Password reset.'); }
    if (form.id === 'password-form') {
      if (f.get('pw-next') !== f.get('pw-repeat')) throw new Error('The two new passwords do not match.');
      await api('/api/me/password', 'POST', { current: f.get('pw-current'), next: f.get('pw-next') });
      closeDialog(); toast('Password changed.');
    }
    if (form.id === 'reject-form') { const ids = drafts.editorDraft.rejectIds; closeDialog(); await reviewCases(ids, 'rejected', f.get('reject-note').trim()); }
  } catch (error) { dialogError(error); }
  finally { if (button) button.disabled = false; }
});
