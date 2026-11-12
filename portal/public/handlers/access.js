import { api } from '../api.js';
import { closeDialog, dialogError } from '../components/dialogs.js';
import { $, $$ } from '../components/dom.js';
import { toast } from '../components/widgets.js';
import { afterAccessChange, focusSoon, paintPerms, paintPersonSelected, roleInfo, searchPeople, showMemberDialog } from '../pages/members.js';
import { loadTeams, showTeamDialog, showTeamMemberDialog } from '../pages/teams.js';
import { selectProduct } from '../pages/workspace.js';
import { loadAccess } from '../permissions.js';
import { renderPage } from '../router.js';
import { drafts, state } from '../state.js';


document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, id, name } = button.dataset;
  try {
    if (action === 'product-access') { await selectProduct(id); location.hash = '/access'; }
    if (action === 'member-add') await showMemberDialog(state.members.scope);
    if (action === 'member-edit') await showMemberDialog(state.members.scope, state.members.rows.find(r => String(r.id) === id));
    if (action === 'member-remove' && confirm(`Remove ${name} from ${state.members.scope.name}? They lose the access this entry gave them.`)) {
      await api(`/api/memberships/${encodeURIComponent(id)}`, 'DELETE');
      await afterAccessChange(); toast(`${name} removed.`); focusSoon('[data-action="member-add"]');
    }
    if (action === 'team-new') showTeamDialog();
    if (action === 'team-edit') showTeamDialog(state.teams.find(t => String(t.id) === id));
    if (action === 'team-add-member') showTeamMemberDialog(state.teams.find(t => String(t.id) === id));
    if (action === 'team-remove-member') {
      await api(`/api/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(button.dataset.user)}`, 'DELETE');
      await loadTeams(); await loadAccess(); renderPage(); toast(`${name} removed from ${button.dataset.team}.`); focusSoon(`[data-action="team-add-member"][data-id="${CSS.escape(id)}"]`);
    }
    if (action === 'team-delete' && confirm(`Delete the team "${name}"? Everyone in it loses the access the team gave them. The people themselves are not deleted.`)) {
      await api(`/api/teams/${encodeURIComponent(id)}`, 'DELETE');
      await loadTeams(); await loadAccess(); renderPage(); toast(`Team ${name} deleted.`); focusSoon('[data-action="team-new"]');
    }
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('change', event => {
  const el = event.target;
  if (!drafts.memberDraft) return;
  if (el.matches('[data-subject-type]')) {
    drafts.memberDraft.subjectType = el.value; $('#subject-user')?.classList.toggle('hidden', el.value !== 'user'); $('#subject-team')?.classList.toggle('hidden', el.value !== 'team');
    (el.value === 'user' ? $('#person-q') : $('#member-team'))?.focus();
  }
  if (el.matches('[data-person-pick]')) { drafts.memberDraft.person = { id: el.value, name: el.dataset.name }; paintPersonSelected(); }
  if (el.matches('[data-member-team]')) drafts.memberDraft.teamId = el.value;
  if (el.matches('[data-member-role]')) { drafts.memberDraft.role = el.value; $$('.role-picker .agent-card').forEach(c => c.classList.toggle('active', c.contains(el))); paintPerms(); }
  if (el.matches('[data-perm]')) {
    const preset = new Set(roleInfo(drafts.memberDraft.role)?.permissions ?? []), p = el.dataset.perm;
    if (el.checked === preset.has(p)) delete drafts.memberDraft.overrides[p]; else drafts.memberDraft.overrides[p] = el.checked;
    paintPerms(p);
  }
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.matches('[data-person-search]')) { clearTimeout(drafts.personTimer); const q = el.value.trim(); drafts.personTimer = setTimeout(() => searchPeople(q), 180); }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['member-form', 'team-form', 'team-member-form'].includes(form.id)) return;
  const f = new FormData(form), button = $('button[type=submit]', form), d = drafts.memberDraft;
  if (button) button.disabled = true;
  try {
    if (form.id === 'member-form') {
      const expiry = f.get('member-expiry'), expiresAt = expiry ? new Date(`${expiry}T23:59:59`).toISOString() : null;
      if (d.row) {
        await api(`/api/memberships/${encodeURIComponent(d.row.id)}`, 'PATCH', { role: d.role, overrides: d.overrides, expiresAt });
        closeDialog(); await afterAccessChange(); toast('Access updated.'); focusSoon(`[data-action="member-edit"][data-id="${CSS.escape(String(d.row.id))}"]`);
      } else {
        const subjectId = d.subjectType === 'team' ? d.teamId : d.person?.id;
        if (!subjectId) throw new Error(d.subjectType === 'team' ? 'Choose a team.' : 'Choose a person from the list.');
        await api(`/api/${d.scope.type}s/${encodeURIComponent(d.scope.id)}/members`, 'POST', { subjectType: d.subjectType, subjectId, role: d.role, overrides: d.overrides, ...(expiresAt ? { expiresAt } : {}) });
        closeDialog(); await afterAccessChange(); toast('Member added.'); focusSoon('[data-action="member-add"]');
      }
    }
    if (form.id === 'team-form') {
      const body = { name: f.get('team-name').trim(), description: f.get('team-description').trim() };
      if (d.team) await api(`/api/teams/${encodeURIComponent(d.team.id)}`, 'PATCH', body); else await api('/api/teams', 'POST', body);
      closeDialog(); await loadTeams(); renderPage(); toast(d.team ? 'Team saved.' : 'Team created.'); focusSoon('[data-action="team-new"]');
    }
    if (form.id === 'team-member-form') {
      if (!d.person) throw new Error('Choose a person from the list.');
      await api(`/api/teams/${encodeURIComponent(d.team.id)}/members`, 'POST', { userId: d.person.id });
      closeDialog(); await loadTeams(); await loadAccess(); renderPage(); toast(`${d.person.name} added to ${d.team.name}.`); focusSoon(`[data-action="team-add-member"][data-id="${CSS.escape(String(d.team.id))}"]`);
    }
  } catch (error) { dialogError(error); }
  finally { if (button) button.disabled = false; }
});
