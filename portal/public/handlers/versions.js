import { api } from '../api.js';
import { toast } from '../components/widgets.js';
import { renderPage, renderRoute } from '../router.js';
import { state } from '../state.js';

// Versions and Tree tabs: register now, note edit, matrix filter, tree node selection.
document.addEventListener('click', async event => {
  const button = event.target?.closest?.('[data-action]');
  const action = button?.dataset.action;
  if (!['register-version', 'version-note-edit', 'version-note-cancel', 'tree-node'].includes(action)) return;
  const id = state.route[1];
  try {
    if (action === 'register-version') {
      button.disabled = true;
      const r = await api(`/api/modules/${id}/automation-versions`, 'POST', {});
      toast(r.existing ? `Nothing changed: automation v${r.number} is already the current version.` : `Registered automation v${r.number}.`);
      await renderRoute();
    }
    if (action === 'version-note-edit') { state.noteEditing = Number(button.dataset.number); renderPage(); document.querySelector('.note-form input')?.focus(); }
    if (action === 'version-note-cancel') { state.noteEditing = null; renderPage(); }
    if (action === 'tree-node') { state.treeNode = button.dataset.id; renderPage(); }
  } catch (error) { toast(error.message, true); if (button) button.disabled = false; }
});
document.addEventListener('submit', async event => {
  const form = event.target?.closest?.('[data-note-form]');
  if (!form) return;
  event.preventDefault();
  try {
    await api(`/api/modules/${state.route[1]}/automation-versions/${form.dataset.noteForm}`, 'PUT', { note: new FormData(form).get('note') ?? '' });
    state.noteEditing = null; toast('Note saved.'); await renderRoute();
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('change', async event => {
  const t = event.target;
  if (t?.dataset?.change === 'only-differences') { state.versionsOnlyDiff = t.checked; try { await renderRoute(); } catch (e) { toast(e.message, true); } }
  if (t?.dataset?.change === 'tree-show-empty') { state.treeShowEmpty = t.checked; renderPage(); }
});
