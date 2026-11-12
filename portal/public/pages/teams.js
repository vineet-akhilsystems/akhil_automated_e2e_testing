import { api } from '../api.js';
import { showDialog } from '../components/dialogs.js';
import { $, badge, esc, icon } from '../components/dom.js';
import { empty, field, heading, textArea } from '../components/widgets.js';
import { personPicker, searchPeople } from './members.js';
import { isMine } from './review.js';
import { canManageAnywhere, isAdmin } from '../permissions.js';
import { drafts, state } from '../state.js';


// Teams
export async function loadTeams() {
  try { const r = await api('/api/teams'); state.teams = Array.isArray(r) ? r : r.teams ?? []; state.teamsError = ''; }
  catch (e) { state.teams = []; state.teamsError = e.message; }
}
const canEditTeam = t => isAdmin() || t.createdBy == null || isMine(t.createdBy);
export function teamsPage() {
  if (!canManageAnywhere()) return empty('Teams are not available to you', 'Only admins and people who manage members can see teams.');
  const teams = state.teams ?? [];
  return heading('Access', 'Teams', 'A team is a reusable group of people. Attach a team to a module or product under Members and everyone in it gets that access.', `<button class="primary" data-action="team-new">${icon('plus')} Create team</button>`)
    + (state.teamsError ? `<div class="warning" role="alert">The team list is not available: ${esc(state.teamsError)}</div>` : '')
    + (teams.length ? `<div class="team-grid">${teams.map(t => { const mem = t.members ?? [], mine = canEditTeam(t); return `<article class="panel team-card" aria-labelledby="team-${esc(t.id)}"><div class="team-head"><div><h2 id="team-${esc(t.id)}">${esc(t.name)}</h2><p class="tiny muted">${esc(t.description || 'No description.')}</p></div>${badge(`${t.memberCount ?? mem.length} member${(t.memberCount ?? mem.length) === 1 ? '' : 's'}`)}</div>${mem.length ? `<ul class="chip-list">${mem.map(p => `<li class="chip">${esc(p.displayName || p.username)}${mine ? `<button type="button" class="chip-x" data-action="team-remove-member" data-id="${esc(t.id)}" data-user="${esc(p.id)}" data-name="${esc(p.displayName || p.username)}" data-team="${esc(t.name)}" aria-label="Remove ${esc(p.displayName || p.username)} from ${esc(t.name)}">×</button>` : ''}</li>`).join('')}</ul>` : '<p class="tiny muted">No one is in this team yet.</p>'}<div class="team-actions">${mine ? `<button class="small" data-action="team-add-member" data-id="${esc(t.id)}">${icon('plus')} Add person</button><button class="small" data-action="team-edit" data-id="${esc(t.id)}">${icon('edit')} Edit</button><button class="small danger" data-action="team-delete" data-id="${esc(t.id)}" data-name="${esc(t.name)}" aria-label="Delete team ${esc(t.name)}">${icon('trash')} Delete</button>` : '<span class="tiny muted">Only an admin or the person who created this team can change it.</span>'}</div></article>`; }).join('')}</div>` : `<div class="panel">${empty('No teams yet', 'Create a team, add people, then attach it to a module or product under Members.', '<button class="primary" data-action="team-new">Create team</button>')}</div>`);
}
export function showTeamDialog(team) {
  drafts.memberDraft = { team };
  showDialog(team ? `Edit ${team.name}` : 'Create a team', 'A team is a named group of people you can give access to together.', `<div class="form-grid single">${field('Team name', 'team-name', team?.name ?? '', 'required maxlength="80" autocomplete="off"')}${textArea('Description', 'team-description', team?.description ?? '', 'maxlength="300" rows="3"')}</div>`, 'team-form', team ? 'Save team' : 'Create team', true);
  $('#team-name')?.focus();
}
export function showTeamMemberDialog(team) {
  drafts.memberDraft = { team, person: null, exclude: new Set((team.members ?? []).map(p => String(p.id))) };
  showDialog(`Add a person to ${team.name}`, 'They get whatever access this team has.', `<div class="form-grid single">${personPicker()}</div>`, 'team-member-form', 'Add to team', true);
  searchPeople(''); $('#person-q')?.focus();
}
