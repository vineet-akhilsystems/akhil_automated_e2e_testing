import { api } from './api.js';
import { state } from './state.js';

// Permissions come from GET /api/me/access (state.access = { admin, products, modules }).
// Without user accounts (single access-key mode) everything is allowed. If the server has no /api/me/access
// (older build) we fall back to the old role-based gating through legacyPerms.
const LEGACY_VIEW = ['module.view', 'report.view'];
const LEGACY_BA = [...LEGACY_VIEW, 'intake.upload', 'intake.delete', 'agent.run', 'case.create', 'case.edit', 'module.create', 'module.settings'];
const LEGACY_TESTER = [...LEGACY_BA, 'run.start', 'run.cancel', 'triage.write', 'case.review'];
const legacyPerms = { viewer: LEGACY_VIEW, ba: LEGACY_BA, tester: LEGACY_TESTER };
export const isAdmin = () => !state.user || (state.access ? Boolean(state.access.admin) : state.user.role === 'admin');
const currentModuleId = () => state.route?.[0] === 'modules' && state.route[1] ? state.route[1] : '';
// Module-scoped permission. Without a module id: the open module, else "on any visible module".
export function can(permission, moduleId = currentModuleId()) {
  if (isAdmin()) return true;
  if (!state.access) return (legacyPerms[state.user.role] ?? []).includes(permission);
  const has = id => (state.access.modules?.[id] ?? []).includes(permission);
  if (moduleId) return has(moduleId) || (state.access.products?.[state.productId] ?? []).includes(permission);
  return (state.data?.modules ?? []).some(m => has(m.id)) || (state.access.products?.[state.productId] ?? []).includes(permission);
}
export const canProduct = (permission, productId = state.productId) => isAdmin() || (state.access ? (state.access.products?.[productId] ?? []).includes(permission) : (legacyPerms[state.user.role] ?? []).includes(permission));
// Anywhere the person may manage members: decides who sees the Teams page.
export const canManageAnywhere = () => isAdmin() || (state.access ? [...Object.values(state.access.products ?? {}), ...Object.values(state.access.modules ?? {})].some(list => list.includes('members.manage')) : false);
export const hasNoAccess = () => Boolean(state.access) && !state.access.admin && !Object.values(state.access.products ?? {}).some(l => l.length) && !Object.values(state.access.modules ?? {}).some(l => l.length);
export const NO_ACCESS_TEXT = 'You have no access yet. Ask an administrator or module lead to add you.';
export const roleLabel = r => ({ admin: 'Admin', member: 'Member', tester: 'Tester', ba: 'Business analyst', viewer: 'Viewer', lead: 'Module lead', owner: 'Product owner' })[r] ?? r ?? '';
export async function loadAccess() {
  try { const r = await api('/api/me/access'); state.access = r && typeof r === 'object' && ('modules' in r || 'admin' in r) ? { admin: Boolean(r.admin), products: r.products ?? {}, modules: r.modules ?? {} } : null; }
  catch (e) { if (e.status === 401) throw e; if (e.status === 404) state.access = null; /* other errors keep what we knew; first load falls back to role-based gating */ }
}
