import { check } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';
import { runTrend, flakyCases, caseHealth, trendSummary, slowestCases } from '../trends.mjs';

// Automation health: quality trend, flaky cases, run alerts (webhook) and scheduled runs.
export default async function handle(ctx, rc) {
  const { req, res, url, route } = rc;
  const { store, notifications, schedules } = ctx;
  const { visibleRun } = ctx.helpers, { authorize } = ctx.access;
  if (!route.startsWith('/api/')) return false;
  const { user, acc } = rc;

  if (route === '/api/trends' && req.method === 'GET') {
    const product = url.searchParams.get('product'), moduleId = url.searchParams.get('module');
    const limit = Math.min(100, Math.max(5, Number.parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));
    const runs = store.runs().filter(r => (!product || (r.productId ?? 'augastam') === product) && (!moduleId || r.module?.id === moduleId) && visibleRun(acc, r));
    const trend = runTrend(runs, { limit });
    const health = caseHealth(runs);
    return json(res, 200, { trend, summary: trendSummary(trend), flaky: flakyCases(runs).slice(0, 25), slowest: slowestCases(runs), healthByCase: moduleId ? Object.fromEntries(health.map(h => [h.id, { verdict: h.verdict, flakeRate: h.flakeRate, last: h.last }])) : undefined });
  }

  if (route === '/api/notifications' || route === '/api/notifications/test') {
    check(acc.admin, 'Only an administrator can change run alerts.', 403);
    if (route === '/api/notifications' && req.method === 'GET') return json(res, 200, notifications.get());
    if (route === '/api/notifications' && req.method === 'PUT') return json(res, 200, notifications.save(await readJson(req)));
    if (route === '/api/notifications/test' && req.method === 'POST') return json(res, 200, await notifications.sendTest());
  }

  if (route === '/api/schedules' && req.method === 'GET') {
    const moduleId = url.searchParams.get('module'), product = url.searchParams.get('product');
    const allowed = s => { const m = store.module(s.moduleId); return Boolean(m) && acc.module(m).has('report.view') && (!product || (m.productId ?? 'augastam') === product) && (!moduleId || s.moduleId === moduleId); };
    return json(res, 200, schedules.list().filter(allowed).map(s => ({ ...s, moduleName: store.module(s.moduleId)?.name })));
  }
  if (route === '/api/schedules' && req.method === 'POST') {
    const body = await readJson(req);
    authorize(user, 'run.start', { module: body.moduleId }, acc);
    const env = ctx.environments.find(e => e.id === body.environmentId);
    check(env && acc.productVisible(env.productId ?? 'augastam'), 'Choose a configured login profile.');
    const module = store.module(body.moduleId);
    check((env.productId ?? 'augastam') === (module.productId ?? 'augastam'), 'The login profile belongs to a different product than this module.', 409);
    check(module.adapter, 'This module has no browser automation connected, so it cannot run on a schedule.', 409);
    return json(res, 201, schedules.create(body, user));
  }
  const match = /^\/api\/schedules\/([\w-]+)$/.exec(route);
  if (match) {
    const existing = schedules.list().find(s => s.id === match[1]);
    check(existing, 'Schedule not found.', 404);
    authorize(user, 'run.start', { module: existing.moduleId }, acc);
    if (req.method === 'PUT') return json(res, 200, schedules.update(match[1], await readJson(req), user));
    if (req.method === 'DELETE') { schedules.remove(match[1]); return json(res, 200, { ok: true }); }
  }
  return false;
}
