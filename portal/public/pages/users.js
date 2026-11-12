import { api } from '../api.js';
import { showDialog } from '../components/dialogs.js';
import { badge, date, esc, icon, opts } from '../components/dom.js';
import { empty, field, heading, selectField, toast } from '../components/widgets.js';
import { roleLabel } from '../permissions.js';
import { renderRoute } from '../router.js';
import { drafts, state } from '../state.js';


// ----- Users and account -----
export function usersPage() {
  const rows = state.users ?? [], me = state.user;
  const roles = [['admin', 'Admin', 'Sees and manages everything: products, users, login profiles and every module.'], ['member', 'Member', 'Signs in and sees only what they are given access to.']];
  const roleOptions = u => [...roles.map(r => [r[0], r[1]]), ...(roles.some(r => r[0] === u.role) ? [] : [[u.role, `${roleLabel(u.role)} (legacy)`]])];
  return heading('Administration', 'Users', 'Add people and switch their sign-in on or off. Access to products and modules is given separately.', `<button class="primary" data-action="user-new">${icon('plus')} Add user</button>`)
    + `<div class="info-strip">${icon('info')}<div><strong>Access is given elsewhere</strong><p>Give access under Teams and module Members. A Member sees nothing until a product owner or module lead adds them (or a team they belong to).</p></div></div>`
    + (state.usersError ? `<div class="warning" role="alert">The user list is not available: ${esc(state.usersError)}</div>` : '')
    + `<div class="panel">${rows.length ? `<div class="table-scroll"><table><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last sign-in</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${rows.map(u => { const self = me && String(u.id) === String(me.id); return `<tr><td><strong>${esc(u.displayName || u.username)}</strong>${self ? ' <span class="tiny muted">(you)</span>' : ''}<div class="tiny muted">${esc(u.username)}</div></td><td><select aria-label="Role for ${esc(u.username)}" data-change="user-role" data-id="${esc(u.id)}" ${self ? 'disabled title="You cannot change your own role"' : ''}>${opts(roleOptions(u), u.role)}</select></td><td>${badge(u.disabled ? 'Disabled' : 'Active', u.disabled ? 'fail' : 'green')}</td><td class="tiny">${date(u.lastLoginAt)}</td><td class="row-actions user-actions"><button class="small" data-action="user-password" data-id="${esc(u.id)}">Reset password</button>${self ? '' : `<button class="small" data-action="user-toggle" data-id="${esc(u.id)}" data-disabled="${u.disabled ? '1' : ''}">${u.disabled ? 'Enable' : 'Disable'}</button><button class="small danger" data-action="user-delete" data-id="${esc(u.id)}" data-name="${esc(u.username)}" aria-label="Delete ${esc(u.username)}">${icon('trash')}</button>`}</td></tr>`; }).join('')}</tbody></table></div>` : state.usersError ? '' : empty('No users yet', 'Add the first person to get started.')}`
    + `</div><section class="panel spaced-panel role-help"><div class="panel-heading"><h2>What each role can do</h2></div><dl>${roles.map(([, name, text]) => `<div><dt>${esc(name)}</dt><dd>${esc(text)}</dd></div>`).join('')}</dl></section>`;
}
export const userById = id => (state.users ?? []).find(u => String(u.id) === String(id));
export async function patchUser(id, body, message) { await api(`/api/users/${encodeURIComponent(id)}`, 'PATCH', body); await renderRoute(); if (message) toast(message); }
export function showUserDialog() {
  showDialog('Add a user', 'They sign in with this username and password. Ask them to change the password after they sign in.', `<div class="form-grid">${field('Username', 'new-username', '', 'required maxlength="64" autocomplete="off" autocapitalize="none" spellcheck="false"')}${field('Display name', 'new-display', '', 'maxlength="120" autocomplete="off"')}${selectField('Role', 'new-role', [['member', 'Member (no access until added)'], ['admin', 'Admin (sees everything)']], 'member')}${field('Temporary password', 'new-password', '', 'type="password" required autocomplete="new-password" minlength="8"', 'Use at least 8 characters.')}</div>`, 'user-form', 'Add user', true);
}
export function showUserPasswordDialog(u) {
  drafts.editorDraft = { userId: u.id };
  showDialog(`Reset password for ${u.username}`, 'Set a new password and share it with them in person or by phone.', `<div class="form-grid">${field('New password', 'reset-password', '', 'type="password" required autocomplete="new-password" minlength="8"', 'Use at least 8 characters.')}</div>`, 'user-password-form', 'Reset password', true);
}
export function showChangePasswordDialog() {
  showDialog('Change your password', state.user ? `Signed in as ${state.user.username}.` : '', `<div class="form-grid single">${field('Current password', 'pw-current', '', 'type="password" required autocomplete="current-password"')}${field('New password', 'pw-next', '', 'type="password" required autocomplete="new-password" minlength="8"', 'Use at least 8 characters.')}${field('Repeat new password', 'pw-repeat', '', 'type="password" required autocomplete="new-password" minlength="8"')}</div>`, 'password-form', 'Change password', true);
}
