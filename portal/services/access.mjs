import { check } from '../registry.mjs';
import { effectiveModulePermissions, effectiveProductPermissions } from '../access.mjs';

export function createAccess({ store, users, environments }) {
  const DENIED = 'Your role does not allow this action.';
  const pidOf = m => m.productId ?? 'augastam';
  // Access control: permissions are computed from memberships on every request (never cached in the session).
  function accessFor(user) {
    const admin = user.role === 'admin';
    const ms = admin ? [] : store.memberships(), teams = admin ? [] : store.teamIdsOfUser(user.id), at = Date.now();
    const acc = {
      admin,
      product: pid => effectiveProductPermissions(user, pid, ms, teams, at),
      module: m => effectiveModulePermissions(user, m, ms, teams, at),
      canSee: m => acc.module(m).has('module.view'),
      visibleModules: () => store.modules().filter(acc.canSee),
      productVisible: pid => admin || acc.product(pid).size > 0 || store.modules().some(m => pidOf(m) === pid && acc.canSee(m)),
      visibleProducts: () => store.products().filter(p => acc.productVisible(p.id)),
      anywhere: perm => admin || store.products().some(p => acc.product(p.id).has(perm)) || store.modules().some(m => acc.module(m).has(perm)),
      runStartIn: pid => admin || store.modules().some(m => pidOf(m) === pid && acc.module(m).has('run.start')),
    };
    return acc;
  }
  // The single entry point for scoped checks. Hidden or unknown -> 404, visible but not allowed -> 403.
  function authorize(user, permission, scope = {}, acc = accessFor(user)) {
    if (scope.module !== undefined) {
      const module = typeof scope.module === 'string' ? store.module(scope.module) : scope.module;
      const perms = module ? acc.module(module) : new Set();
      check(module && perms.has('module.view'), 'Not found.', 404);
      check(permission === 'module.view' || perms.has(permission), DENIED, 403);
      return { acc, module, perms };
    }
    if (scope.product !== undefined) {
      const product = store.product(scope.product);
      check(product && acc.productVisible(product.id), 'Not found.', 404);
      const perms = acc.product(product.id);
      check(permission === 'product.view' || perms.has(permission), DENIED, 403);
      return { acc, product, perms };
    }
    if (scope.platform) { check(acc.admin, DENIED, 403); return { acc }; }
    check(acc.anywhere(permission), DENIED, 403);
    return { acc };
  }
  function modulePermission(method, rest) {
    const read = ['GET', 'HEAD'].includes(method);
    let m;
    if (rest === '') return method === 'PUT' ? 'module.settings' : 'module.view';
    if (rest === '/members') return 'members.manage';
    if (rest.startsWith('/agent/jobs')) return method === 'POST' ? 'agent.run' : 'module.view';
    if (/^\/(intake|insights|pack)(\/|$)/.test(rest)) {
      if (read) return 'module.view';
      if (rest === '/insights' && method === 'PUT') return 'agent.run';
      if (rest === '/intake/files' && method === 'POST') return 'intake.upload';
      if (/^\/intake\/files\/[\w-]+$/.test(rest) && method === 'DELETE') return 'intake.delete';
      if (rest === '/intake/analyze' && method === 'POST') return 'agent.run';
      return 'module.settings';
    }
    if (rest === '/cases') return method === 'POST' ? 'case.create' : read ? 'module.view' : 'module.settings';
    if (rest === '/cases/review') return method === 'POST' ? 'case.review' : read ? 'module.view' : 'module.settings';
    if (rest === '/cases/bulk') return method === 'POST' ? 'case.edit' : read ? 'module.view' : 'module.settings';
    if ((m = /^\/cases\/[\w-]+$/.exec(rest))) return method === 'DELETE' ? 'module.view' : method === 'PUT' ? 'case.edit' : method === 'POST' ? 'case.create' : 'module.view';
    if (rest === '/import') return method === 'POST' ? 'case.create' : 'module.settings';
    if (rest === '/export') return 'module.view';
    if (/^\/templates(\/[\w-]+)?$/.test(rest)) return read ? 'module.view' : 'case.review';
    if (rest === '/requirements') return read ? 'module.view' : 'case.edit';
    if (rest === '/coverage') return 'report.view';
    if (rest === '/ai-generate') return method === 'POST' ? 'case.create' : 'module.settings';
    return read ? 'module.view' : 'module.settings';
  }
  const runPermission = resource => resource === 'triage' ? 'triage.write' : resource === 'cancel' ? 'run.cancel'
    : ['report', 'evidence', 'results', 'complete', 'rerun-failures'].includes(resource) ? 'run.start' : 'report.view';
  // Authorizes every /api route before its handler runs. Returns the per-request access context.
  // Routes that depend on the request body (POST /api/modules, POST /api/runs, audit) finish their own check inline.
  function enforce(user, method, route) {
    const acc = accessFor(user), read = ['GET', 'HEAD'].includes(method);
    let m;
    if (route === '/api/me/password') return acc;
    if (route.startsWith('/api/users')) { authorize(user, 'users.admin', { platform: true }, acc); return acc; }
    if (read && ['/api/me/access', '/api/access/roles', '/api/agent/status', '/api/bootstrap', '/api/products', '/api/runs'].includes(route)) return acc;
    if (route === '/api/products' || route === '/api/environments') { authorize(user, route === '/api/products' ? 'product.create' : 'env.write', { platform: true }, acc); return acc; }
    if (route === '/api/directory' || route === '/api/teams') { authorize(user, 'members.manage', {}, acc); return acc; }
    if (/^\/api\/teams\/[\w-]+(\/members(\/[\w-]+)?)?$/.test(route)) { authorize(user, 'members.manage', {}, acc); return acc; } // ownership is checked in the handler
    if (route === '/api/audit' || route === '/api/modules' || (route === '/api/runs' && method === 'POST')) return acc; // inline
    if ((m = /^\/api\/memberships\/([\w-]+)$/.exec(route))) {
      const ms = store.membership(m[1]);
      check(ms, 'Not found.', 404);
      authorize(user, 'members.manage', ms.scopeType === 'module' ? { module: ms.scopeId } : { product: ms.scopeId }, acc);
      return acc;
    }
    if ((m = /^\/api\/products\/([\w-]+)\/members$/.exec(route))) { authorize(user, 'members.manage', { product: m[1] }, acc); return acc; }
    if ((m = /^\/api\/environments\/([\w-]+)\/auth$/.exec(route))) {
      const environment = environments.find(e => e.id === m[1]);
      check(environment, 'Not found.', 404);
      const pid = environment.productId ?? 'augastam';
      check(acc.productVisible(pid), 'Not found.', 404);
      check(acc.runStartIn(pid), DENIED, 403);
      return acc;
    }
    if ((m = /^\/api\/modules\/([\w-]+)(\/.*)?$/.exec(route))) { authorize(user, modulePermission(method, m[2] ?? ''), { module: m[1] }, acc); return acc; }
    if ((m = /^\/api\/runs\/([\w-]+)(?:\/([\w-]+))?/.exec(route))) {
      const run = store.run(m[1]);
      check(run, 'Not found.', 404);
      if (run.kind === 'authentication') {
        check(acc.productVisible(run.productId ?? 'augastam'), 'Not found.', 404);
        check(acc.runStartIn(run.productId ?? 'augastam'), DENIED, 403);
      } else authorize(user, runPermission(m[2]), { module: run.module?.id }, acc);
      return acc;
    }
    authorize(user, 'users.admin', { platform: true }, acc); // anything unlisted is admin-only
    return acc;
  }
  return { accessFor, authorize, modulePermission, runPermission, enforce, pidOf, DENIED };
}
