import { check } from '../registry.mjs';
import { json } from '../http/respond.mjs';
import { PERMISSIONS as PERMISSION_CATALOG, roleList } from '../access.mjs';

export default async function handle(ctx, rc) {
  const { req, res, url, route, user, acc } = rc;
  const { store } = ctx;
  const { authorize, DENIED } = ctx.access;
        if (route === '/api/access/roles' && req.method === 'GET') return json(res, 200, { roles: roleList(), permissions: PERMISSION_CATALOG.map(p => ({ ...p })) });
        if (route === '/api/me/access' && req.method === 'GET') {
          const products = {}, modules = {};
          for (const p of acc.visibleProducts()) products[p.id] = [...acc.product(p.id)].sort();
          for (const m of acc.visibleModules()) modules[m.id] = [...acc.module(m)].sort();
          return json(res, 200, { admin: acc.admin, products, modules });
        }
        if (route === '/api/directory' && req.method === 'GET') {
          const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
          return json(res, 200, store.users().filter(u => !u.disabled && (!q || u.username.includes(q) || String(u.displayName ?? '').toLowerCase().includes(q)))
            .slice(0, 50).map(u => ({ id: u.id, username: u.username, displayName: u.displayName })));
        }
        if (route === '/api/audit' && req.method === 'GET') {
          const scopeType = url.searchParams.get('scopeType') ?? '', scopeId = url.searchParams.get('scopeId') ?? '';
          if (!acc.admin) {
            check(['module', 'product'].includes(scopeType) && scopeId, DENIED, 403);
            authorize(user, 'members.manage', scopeType === 'module' ? { module: scopeId } : { product: scopeId }, acc);
          }
          return json(res, 200, store.auditLog({ scopeType, scopeId, limit: 200 }));
        }
  return false;
}
