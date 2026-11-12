import { api } from '../api.js';
import { humanKey } from '../components/badges.js';
import { showDialog } from '../components/dialogs.js';
import { $, badge, date, esc, icon, opts } from '../components/dom.js';
import { empty, heading } from '../components/widgets.js';
import { moduleTabs } from './modules.js';
import { isMine } from './review.js';
import { productName } from './workspace.js';
import { can, canProduct, loadAccess, roleLabel } from '../permissions.js';
import { reload } from '../router.js';
import { currentModule, drafts, state } from '../state.js';


// ---------------------------------------------------------------------------
// Access control: members (module and product), teams, activity.
// Talks to the endpoints in docs/superpowers/specs/2026-11-09-access-control-design.md.
// ---------------------------------------------------------------------------
const FALLBACK_ACCESS_META = {
  roles: [
    { id: 'viewer', label: 'Viewer', description: 'Can open the module and read cases, runs and reports. Cannot change anything.', permissions: ['module.view', 'report.view'] },
    { id: 'ba', label: 'Business analyst', description: 'Viewer, plus upload requirement files, run the analysis agent and write or edit cases. Cannot run tests.', permissions: ['module.view', 'report.view', 'intake.upload', 'intake.delete', 'agent.run', 'case.create', 'case.edit'] },
    { id: 'tester', label: 'Tester', description: 'Business analyst, plus run tests, triage findings and approve or reject cases.', permissions: ['module.view', 'report.view', 'intake.upload', 'intake.delete', 'agent.run', 'case.create', 'case.edit', 'run.start', 'run.cancel', 'triage.write', 'case.review'] },
    { id: 'lead', label: 'Module lead', description: 'Tester, plus delete cases, change module settings and manage who has access.', permissions: ['module.view', 'report.view', 'intake.upload', 'intake.delete', 'agent.run', 'case.create', 'case.edit', 'run.start', 'run.cancel', 'triage.write', 'case.review', 'case.delete', 'module.settings', 'members.manage'] },
    { id: 'owner', label: 'Product owner', description: 'Lead on every module in the product, and can create modules and manage product access.', permissions: ['module.view', 'report.view', 'intake.upload', 'intake.delete', 'agent.run', 'case.create', 'case.edit', 'run.start', 'run.cancel', 'triage.write', 'case.review', 'case.delete', 'module.settings', 'members.manage', 'module.create', 'product.view'] },
  ],
  permissions: [
    { id: 'module.view', label: 'Open the module', group: 'Basics' }, { id: 'report.view', label: 'See reports and coverage', group: 'Basics' }, { id: 'product.view', label: 'See the product', group: 'Basics' },
    { id: 'intake.upload', label: 'Upload requirement files', group: 'Intake and agent' }, { id: 'intake.delete', label: 'Delete intake files (own uploads)', group: 'Intake and agent' }, { id: 'agent.run', label: 'Run the analysis agent', group: 'Intake and agent' },
    { id: 'case.create', label: 'Create cases', group: 'Cases' }, { id: 'case.edit', label: 'Edit cases', group: 'Cases' }, { id: 'case.review', label: 'Approve or reject cases', group: 'Cases' }, { id: 'case.delete', label: 'Delete cases', group: 'Cases' },
    { id: 'run.start', label: 'Start test runs', group: 'Runs' }, { id: 'run.cancel', label: 'Cancel test runs', group: 'Runs' }, { id: 'triage.write', label: 'Triage findings', group: 'Runs' },
    { id: 'module.settings', label: 'Change module settings', group: 'Administration' }, { id: 'members.manage', label: 'Manage who has access', group: 'Administration' }, { id: 'module.create', label: 'Create modules', group: 'Administration' },
  ],
};
async function loadAccessMeta() {
  if (state.accessMeta) return state.accessMeta;
  try {
    const r = await api('/api/access/roles');
    state.accessMeta = Array.isArray(r?.roles) && r.roles.length ? { roles: r.roles, permissions: Array.isArray(r.permissions) && r.permissions.length ? r.permissions : FALLBACK_ACCESS_META.permissions } : FALLBACK_ACCESS_META;
  } catch (e) { if (e.status === 401) throw e; state.accessMeta = FALLBACK_ACCESS_META; }
  return state.accessMeta;
}
const permLabel = id => (state.accessMeta ?? FALLBACK_ACCESS_META).permissions.find(p => p.id === id)?.label ?? humanKey(String(id).replace('.', ' '));
export const roleInfo = id => (state.accessMeta ?? FALLBACK_ACCESS_META).roles.find(r => r.id === id);
export const whoName = v => v && typeof v === 'object' ? v.displayName || v.username || v.name || v.id || '' : v ?? '';
const dayOnly = v => v ? new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const dayInput = v => { if (!v) return ''; const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const roleBadge = id => badge(roleInfo(id)?.label ?? roleLabel(id), ({ owner: 'purple', lead: 'purple', tester: 'green', ba: 'blue', viewer: 'skipped' })[id] ?? 'skipped');
export const focusSoon = selector => requestAnimationFrame(() => $(selector)?.focus());
export async function afterAccessChange() { await loadAccess(); await reload(); }

export async function loadMembers(scope) {
  await loadAccessMeta();
  const next = { scope, rows: null, error: '', audit: null, auditError: '' };
  try { const r = await api(`/api/${scope.type}s/${encodeURIComponent(scope.id)}/members`); next.rows = Array.isArray(r) ? r : r.members ?? []; } catch (e) { next.error = e.message; }
  try { const r = await api(`/api/audit?scopeType=${scope.type}&scopeId=${encodeURIComponent(scope.id)}`); next.audit = Array.isArray(r) ? r : r.entries ?? []; } catch (e) { next.auditError = e.message; }
  state.members = next;
}
function effectiveSummary(r) {
  const eff = r.effective ?? roleInfo(r.role)?.permissions ?? [], preset = new Set(roleInfo(r.role)?.permissions ?? []);
  const added = Object.entries(r.overrides ?? {}).filter(([k, v]) => v && !preset.has(k)).length, removed = Object.entries(r.overrides ?? {}).filter(([k, v]) => !v && preset.has(k)).length;
  const custom = added || removed ? ` · ${[added ? `+${added} added` : '', removed ? `${removed} removed` : ''].filter(Boolean).join(', ')}` : '';
  return `<details class="perm-summary"><summary>${eff.length} permission${eff.length === 1 ? '' : 's'}${custom}</summary><ul class="chip-list">${eff.map(p => `<li class="chip">${esc(permLabel(p))}</li>`).join('')}</ul></details>`;
}
function membersTable() {
  const mm = state.members, scope = mm.scope;
  if (mm.error) return `<div class="warning" role="alert">The member list is not available: ${esc(mm.error)}</div>`;
  if (!mm.rows) return '<div class="loading">Loading members…</div>';
  if (!mm.rows.length) return empty('Nobody has been added yet', `Add a person or a team to give them access to ${scope.name}.`, '<button class="primary" data-action="member-add">Add member</button>');
  return `<div class="table-scroll"><table class="members-table"><thead><tr><th>Person or team</th><th>Role</th><th>Permissions</th><th>Expires</th><th>Added by</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${mm.rows.map(r => { const s = r.subject ?? {}, me = s.type === 'user' && isMine(s.id), expired = r.expiresAt && new Date(r.expiresAt) < new Date(); return `<tr><td><strong>${esc(s.name ?? s.id)}</strong>${me ? ' <span class="tiny muted">(you)</span>' : ''}<div class="tiny muted">${s.type === 'team' ? 'Team' : 'Person'}</div></td><td>${roleBadge(r.role)}</td><td>${effectiveSummary(r)}</td><td class="tiny">${r.expiresAt ? `${esc(dayOnly(r.expiresAt))}${expired ? ` ${badge('Expired', 'fail')}` : ''}` : 'Never'}</td><td class="tiny">${esc(whoName(r.createdBy) || '—')}<br>${r.createdAt ? date(r.createdAt) : ''}</td><td class="row-actions user-actions">${me ? '<span class="tiny muted">You cannot change your own access</span>' : `<button class="small" data-action="member-edit" data-id="${esc(r.id)}" aria-label="Edit ${esc(s.name ?? s.id)}">${icon('edit')} Edit</button><button class="small danger" data-action="member-remove" data-id="${esc(r.id)}" data-name="${esc(s.name ?? s.id)}" aria-label="Remove ${esc(s.name ?? s.id)}">${icon('trash')} Remove</button>`}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function activityPanel() {
  const mm = state.members;
  const items = mm.audit ?? [];
  const line = e => `<li><span class="tiny muted">${esc(date(e.at))}</span> <strong>${esc(whoName(e.actor))}</strong> ${esc(humanKey(e.action ?? '').toLowerCase())}${e.subject ? ` <span>${esc(whoName(e.subject))}</span>` : ''}${e.detail ? ` <span class="tiny muted">${esc(typeof e.detail === 'string' ? e.detail : Object.entries(e.detail).map(([k, v]) => `${humanKey(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', '))}</span>` : ''}</li>`;
  return `<section class="panel spaced-panel" aria-labelledby="activity-title"><div class="panel-heading"><div><h2 id="activity-title">Activity</h2><span class="tiny muted">Recent changes to access here</span></div></div>${mm.auditError ? `<div class="activity-empty tiny muted">Activity is not available: ${esc(mm.auditError)}</div>` : items.length ? `<ul class="activity-list" tabindex="0" aria-label="Recent access changes">${items.slice(0, 40).map(line).join('')}</ul>` : '<div class="activity-empty tiny muted">Nothing has changed yet.</div>'}</section>`;
}
function membersPanel() {
  const mm = state.members, scope = mm.scope;
  return `<section class="panel" aria-labelledby="members-title"><div class="panel-heading"><div><h2 id="members-title">${scope.type === 'product' ? 'People and teams with product access' : 'People and teams in this module'}</h2><span class="tiny muted">${mm.rows ? `${mm.rows.length} ${mm.rows.length === 1 ? 'entry' : 'entries'}` : ''}</span></div><button class="primary small" data-action="member-add">${icon('plus')} Add member</button></div>${membersTable()}</section>` + activityPanel();
}
export function membersPage() {
  const m = currentModule();
  if (!m) return empty('Module not found', 'Choose a module from the library.');
  if (!can('members.manage', m.id)) return `<a class="back-link" href="#/modules/${m.id}">${icon('back')} ${esc(m.name)} cases</a>` + empty('Members are not available to you', 'Only a module lead, product owner or admin can see who has access here.');
  return `<a class="back-link" href="#/modules/${m.id}">${icon('back')} ${esc(m.name)} cases</a>` + heading(m.area, `Members · ${m.name}`, 'Choose who can open this module and what each person or team may do.', '<a class="button-link" href="#/teams">' + icon('people') + ' Teams</a>') + moduleTabs(m, 'members')
    + `<div class="info-strip">${icon('info')}<div><strong>Roles given on the product apply here too</strong><p>People who are product owners or have a product role already see every module. Manage those under Product access. Attach a team here to share this module with another group, usually as Viewer.</p></div></div><div class="spaced-panel"></div>` + (state.members?.scope.id === m.id ? membersPanel() : '<div class="loading">Loading members…</div>');
}
export function accessPage() {
  if (!canProduct('members.manage')) return empty('Product access is not available to you', 'Only a product owner or admin can manage product access.');
  return `<a class="back-link" href="#/modules">${icon('back')} Module library</a>` + heading(`${productName()} access`, 'Product access', 'Roles given here apply to every module in this product. For one module only, use the Members tab inside that module.', '<a class="button-link" href="#/teams">' + icon('people') + ' Teams</a>')
    + `<div class="info-strip">${icon('info')}<div><strong>Product owner is the product-wide lead</strong><p>An owner is a lead on every module, can create modules and manage this page. Other roles here give the same access in every module of the product.</p></div></div><div class="spaced-panel"></div>` + (state.members?.scope.type === 'product' ? membersPanel() : '<div class="loading">Loading access…</div>');
}

// Person picker shared by the member and team dialogs.
let personToken = 0;
export const personPicker = () => `<div class="form-field wide person-picker"><label for="person-q">Find a person</label><input id="person-q" type="search" data-person-search autocomplete="off" placeholder="Type a name or username" aria-describedby="person-selected"><div id="person-results" class="person-results" role="radiogroup" aria-label="Matching people"></div><div class="tiny" id="person-selected" role="status" aria-live="polite"></div></div>`;
export async function searchPeople(q) {
  const mine = ++personToken, box = $('#person-results'); if (!box) return;
  try {
    const r = await api(`/api/directory?q=${encodeURIComponent(q)}`);
    if (mine !== personToken || !$('#person-results')) return;
    const list = (Array.isArray(r) ? r : r.people ?? []).filter(p => !drafts.memberDraft?.exclude?.has(String(p.id)));
    box.innerHTML = list.length ? list.slice(0, 30).map(p => { const name = p.displayName || p.username; return `<label class="person-opt"><input type="radio" name="person" value="${esc(p.id)}" data-person-pick data-name="${esc(name)}" ${drafts.memberDraft?.person?.id === p.id ? 'checked' : ''}><span><strong>${esc(name)}</strong><small>${esc(p.username)}</small></span></label>`; }).join('') : '<p class="tiny muted">No one matches. Check the spelling, or ask an admin to create the user first.</p>';
  } catch (e) { if (mine === personToken && $('#person-results')) box.innerHTML = `<p class="tiny muted">People search is not available: ${esc(e.message)}</p>`; }
}
export const paintPersonSelected = () => { const n = $('#person-selected'); if (n) n.textContent = drafts.memberDraft?.person ? `Selected: ${drafts.memberDraft.person.name}` : ''; };

export async function showMemberDialog(scope, row) {
  const meta = await loadAccessMeta();
  const roles = meta.roles.filter(r => scope.type === 'product' || r.id !== 'owner');
  const perms = meta.permissions.filter(p => scope.type === 'product' || !['module.create', 'product.view'].includes(p.id));
  let teams = null;
  if (!row) { try { const r = await api('/api/teams'); teams = Array.isArray(r) ? r : r.teams ?? []; } catch { teams = null; } }
  const s = row?.subject;
  drafts.memberDraft = { scope, row, roles, perms, teams, subjectType: s?.type ?? 'user', person: s?.type === 'user' ? { id: s.id, name: s.name ?? s.id } : null, teamId: s?.type === 'team' ? s.id : '', role: row?.role ?? (roles.find(r => r.id === 'viewer') ?? roles[0])?.id, overrides: { ...(row?.overrides ?? {}) }, exclude: new Set((state.members?.rows ?? []).filter(r => r.subject?.type === 'user').map(r => String(r.subject.id))) };
  const d = drafts.memberDraft;
  const subjectPart = row
    ? `<div class="form-field wide"><span class="field-label">${s?.type === 'team' ? 'Team' : 'Person'}</span><div class="subject-fixed"><strong>${esc(s?.name ?? s?.id)}</strong></div></div>`
    : `<fieldset class="form-field wide seg"><legend>Who do you want to add?</legend><label class="seg-opt"><input type="radio" name="subject-type" value="user" data-subject-type checked><span>A person</span></label><label class="seg-opt"><input type="radio" name="subject-type" value="team" data-subject-type><span>A team</span></label></fieldset>`
      + `<div id="subject-user" class="wide-block">${personPicker()}</div><div id="subject-team" class="wide-block hidden"><div class="form-field"><label for="member-team">Team</label>${teams ? `<select id="member-team" name="member-team" data-member-team>${opts(teams.map(t => [t.id, `${t.name}${t.memberCount != null ? ` (${t.memberCount})` : ''}`]), '', 'Choose a team')}</select>${teams.length ? '' : '<small>No teams yet. Create one on the Teams page first.</small>'}` : '<small>The team list is not available to you.</small>'}</div></div>`;
  showDialog(row ? 'Edit access' : 'Add a member', `${scope.type === 'product' ? 'Product-wide access for' : 'Access to'} ${scope.name}.`,
    `<div class="form-grid single">${subjectPart}`
    + `<fieldset class="form-field wide agent-picker role-picker"><legend>Role</legend>${roles.map(r => `<label class="agent-card ${r.id === d.role ? 'active' : ''}"><input type="radio" name="member-role" value="${esc(r.id)}" data-member-role ${r.id === d.role ? 'checked' : ''}><span><strong>${esc(r.label)}</strong><span class="tiny muted">${esc(r.description ?? '')}</span></span></label>`).join('')}</fieldset>`
    + `<details class="form-field wide perm-details" id="perm-details" ${Object.keys(d.overrides).length ? 'open' : ''}><summary>Customize permissions <span class="tiny muted" id="perm-note"></span></summary><p class="form-help">Ticked boxes are what this person or team can do. They start from the role. Tick or untick single permissions to add or remove them for this entry only.</p><div id="perm-groups"></div></details>`
    + `<div class="form-field"><label for="member-expiry">Access ends on (optional)</label><input id="member-expiry" name="member-expiry" type="date" value="${esc(dayInput(row?.expiresAt))}" min="${dayInput(new Date())}"><small>Leave empty for no end date. Access stops at the end of that day.</small></div></div>`,
    'member-form', row ? 'Save changes' : 'Add member', false, 'You can only give permissions you hold yourself.');
  paintPerms(); if (!row) searchPeople('');
  $(row ? '[data-member-role]:checked' : '#person-q')?.focus();
}
export function paintPerms(focusId) {
  const d = drafts.memberDraft, box = $('#perm-groups'); if (!box) return;
  const preset = new Set(roleInfo(d.role)?.permissions ?? d.roles.find(r => r.id === d.role)?.permissions ?? []);
  for (const [k, v] of Object.entries(d.overrides)) if (v === preset.has(k)) delete d.overrides[k];
  const groups = new Map(); d.perms.forEach(p => { const g = p.group ?? 'Other'; groups.set(g, [...(groups.get(g) ?? []), p]); });
  box.innerHTML = [...groups].map(([g, list]) => `<fieldset class="perm-group"><legend>${esc(g)}</legend>${list.map(p => { const on = d.overrides[p.id] ?? preset.has(p.id), flag = p.id in d.overrides ? (on ? 'added' : 'removed') : preset.has(p.id) ? 'from role' : ''; return `<label class="checkbox-label perm-opt"><input type="checkbox" data-perm="${esc(p.id)}" ${on ? 'checked' : ''}><span>${esc(p.label)}${flag ? ` <span class="perm-flag ${flag === 'from role' ? 'preset' : flag}">${flag}</span>` : ''}</span></label>`; }).join('')}</fieldset>`).join('');
  const n = Object.keys(d.overrides).length; $('#perm-note').textContent = n ? `· ${n} change${n === 1 ? '' : 's'} from the role` : '· same as the role';
  if (focusId) box.querySelector(`[data-perm="${CSS.escape(focusId)}"]`)?.focus();
}
