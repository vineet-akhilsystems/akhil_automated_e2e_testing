// Access control model: permission catalog, preset roles and the pure functions that turn
// memberships into effective permissions. No I/O here; the server feeds in data per request.

export const PERMISSIONS = [
  { id: 'module.view', label: 'See the module', group: 'Module' },
  { id: 'module.settings', label: 'Change module settings', group: 'Module' },
  { id: 'members.manage', label: 'Manage who has access', group: 'Access' },
  { id: 'intake.upload', label: 'Upload intake files', group: 'Intake' },
  { id: 'intake.delete', label: 'Remove intake files', group: 'Intake' },
  { id: 'agent.run', label: 'Run analysis and save insights', group: 'Intake' },
  { id: 'case.create', label: 'Create cases', group: 'Cases' },
  { id: 'case.edit', label: 'Edit cases', group: 'Cases' },
  { id: 'case.delete', label: 'Delete cases', group: 'Cases' },
  { id: 'case.review', label: 'Approve or reject cases', group: 'Cases' },
  { id: 'run.start', label: 'Start test runs', group: 'Runs' },
  { id: 'run.cancel', label: 'Cancel test runs', group: 'Runs' },
  { id: 'triage.write', label: 'Record triage', group: 'Runs' },
  { id: 'report.view', label: 'View results and reports', group: 'Reports' },
  { id: 'module.create', label: 'Create modules in the product', group: 'Product' },
  { id: 'product.view', label: 'See the product', group: 'Product' },
];
export const PERMISSION_IDS = PERMISSIONS.map(p => p.id);
export const PRODUCT_ONLY = ['module.create', 'product.view'];
export const MODULE_PERMISSION_IDS = PERMISSION_IDS.filter(p => !PRODUCT_ONLY.includes(p));

const VIEWER = ['module.view', 'report.view'];
const BA = [...VIEWER, 'intake.upload', 'intake.delete', 'agent.run', 'case.create', 'case.edit'];
const TESTER = [...BA, 'run.start', 'run.cancel', 'triage.write', 'case.review'];
const LEAD = [...TESTER, 'case.delete', 'module.settings', 'members.manage'];
const OWNER = [...LEAD, 'module.create', 'product.view'];

export const ROLES = {
  viewer: { id: 'viewer', label: 'Viewer', description: 'Sees the module, its cases, runs and reports.', permissions: VIEWER, scopes: ['module', 'product'] },
  ba: { id: 'ba', label: 'Business analyst', description: 'Viewer plus uploads intake files, runs analysis and writes draft cases.', permissions: BA, scopes: ['module', 'product'] },
  tester: { id: 'tester', label: 'Tester', description: 'Analyst plus runs tests, records triage and approves cases.', permissions: TESTER, scopes: ['module', 'product'] },
  lead: { id: 'lead', label: 'Module lead', description: 'Tester plus deletes cases, changes module settings and manages who has access.', permissions: LEAD, scopes: ['module', 'product'] },
  owner: { id: 'owner', label: 'Product owner', description: 'Lead on every module of the product, creates modules and manages product access.', permissions: OWNER, scopes: ['product'] },
};
export const roleList = () => Object.values(ROLES).map(r => ({ id: r.id, label: r.label, description: r.description, permissions: [...r.permissions], scopes: [...r.scopes] }));
export const rolesForScope = scopeType => Object.values(ROLES).filter(r => r.scopes.includes(scopeType)).map(r => r.id);

// Preset permissions with per-person ticks applied: true adds, false removes.
export function permissionsOf(role, overrides = {}) {
  const set = new Set(ROLES[role]?.permissions ?? []);
  for (const [id, on] of Object.entries(overrides ?? {})) {
    if (!PERMISSION_IDS.includes(id)) continue;
    if (on === true) set.add(id); else if (on === false) set.delete(id);
  }
  return set;
}

const toMs = now => (now instanceof Date ? now.getTime() : Number.isFinite(now) ? now : Date.now());
export const isLive = (membership, now) => !membership.expiresAt || !(Date.parse(membership.expiresAt) <= toMs(now));
const teamSet = teamsOfUser => new Set([...(teamsOfUser ?? [])].map(t => (typeof t === 'string' ? t : t?.id)));
const union = (sets) => { const out = new Set(); for (const s of sets) for (const p of s) out.add(p); return out; };

// Product-scope permissions: union of every live membership on the product (direct or via a team).
// Product-scope presets apply to every module in the product.
export function effectiveProductPermissions(user, productId, memberships = [], teamsOfUser = [], now = Date.now()) {
  if (user?.role === 'admin') return new Set(PERMISSION_IDS);
  const teams = teamSet(teamsOfUser);
  const mine = memberships.filter(m => m.scopeType === 'product' && m.scopeId === productId && isLive(m, now)
    && ((m.subjectType === 'user' && m.subjectId === user?.id) || (m.subjectType === 'team' && teams.has(m.subjectId))));
  if (!mine.length) return new Set();
  const out = union(mine.map(m => permissionsOf(m.role, m.overrides)));
  out.add('product.view');
  return out;
}

// Module-scope permissions. A direct user membership on the module replaces what the user's teams would give
// at module scope (direct beats team); product-level memberships always apply on top.
export function effectiveModulePermissions(user, module, memberships = [], teamsOfUser = [], now = Date.now()) {
  if (user?.role === 'admin') return new Set(MODULE_PERMISSION_IDS);
  const teams = teamSet(teamsOfUser);
  const productPart = effectiveProductPermissions(user, module?.productId ?? 'augastam', memberships, teams, now);
  const here = memberships.filter(m => m.scopeType === 'module' && m.scopeId === module?.id && isLive(m, now));
  const direct = here.filter(m => m.subjectType === 'user' && m.subjectId === user?.id);
  const chosen = direct.length ? direct : here.filter(m => m.subjectType === 'team' && teams.has(m.subjectId));
  const out = union([productPart, ...chosen.map(m => permissionsOf(m.role, m.overrides))]);
  for (const p of PRODUCT_ONLY) out.delete(p);
  // Nothing else is usable without being able to see the module.
  return out.has('module.view') ? out : new Set();
}
