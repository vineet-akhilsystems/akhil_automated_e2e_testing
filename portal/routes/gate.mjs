import { check } from '../registry.mjs';

// Runs the sign-in check and permission enforcement once for every /api request that is not session/login/logout,
// then publishes rc.user and rc.acc for the routes after it. Never handles a request itself.
export default async function gate(ctx, rc) {
  const { req, route } = rc;
  if (route.startsWith('/api/')) {
    rc.user = ctx.sessions.principal(req);
    check(rc.user, 'Sign in to the testing portal.', 401);
    rc.acc = ctx.access.enforce(rc.user, req.method, route);
  }
  return false;
}
