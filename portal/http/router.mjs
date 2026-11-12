// createRouter(routes) -> async (ctx, rc) => boolean.
// Each route is `async (ctx, rc) => boolean` (true = handled). They are tried in array order, so first match wins.
// A route that already started the response (e.g. `return json(res, ...)`, which returns undefined) also counts as handled.
// rc = { req, res, url, route, method, user, acc }. Handled means a route returned true or rc.res.headersSent. Returning false means no route matched; the caller returns 404 for /api/ paths and otherwise serves static files.
export function createRouter(routes) {
  return async (ctx, rc) => {
    for (const handle of routes) {
      const handled = await handle(ctx, rc);
      if (handled || rc.res?.headersSent) return true;
    }
    return false;
  };
}
