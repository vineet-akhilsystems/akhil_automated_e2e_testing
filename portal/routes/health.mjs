import { check } from '../registry.mjs';
import { TERMINAL } from '../quality.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';
import { analyzeRun } from '../failures.mjs';
import { compareRuns, previousRun } from '../compare.mjs';
import { runTrend, flakyCases, caseHealth, trendSummary, slowestCases } from '../trends.mjs';

// Automation health: quality trend, flaky cases, run alerts (webhook) and scheduled runs.
export default async function handle(ctx, rc) {
  const { req, res, url, route } = rc;
  const { store, notifications, schedules, tickets } = ctx;
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

  let m;
  if ((m = /^\/api\/runs\/([\w-]+)\/(failures|compare)$/.exec(route)) && req.method === 'GET') {
    const run = store.run(m[1]);
    check(run && run.kind === 'tests', 'Run not found.', 404);
    if (m[2] === 'failures') return json(res, 200, { ...analyzeRun(run, previousRun(store.runs().filter(r => visibleRun(acc, r)), run)), written: run.postmortem ?? null });
    const other = url.searchParams.get('to');
    const base = other ? store.run(other) : previousRun(store.runs().filter(r => visibleRun(acc, r)), run);
    if (other) check(base && base.kind === 'tests' && base.module?.id === run.module?.id && visibleRun(acc, base), 'Choose another run of the same module.', 404);
    return json(res, 200, base ? compareRuns(base, run) : { none: true });
  }

  if (route === '/api/tickets/settings') {
    check(acc.admin, 'Only an administrator can change ticket settings.', 403);
    if (req.method === 'GET') return json(res, 200, tickets.get());
    if (req.method === 'PUT') return json(res, 200, tickets.save(await readJson(req)));
  }
  if ((m = /^\/api\/runs\/([\w-]+)\/postmortem$/.exec(route)) && req.method === 'PUT') {
    const body = await readJson(req), run = store.run(m[1]);
    check(run && run.kind === 'tests' && TERMINAL.includes(run.status), 'Finish this run before saving a post-mortem.', 409);
    check(typeof body.text === 'string' && body.text.trim().length >= 10 && body.text.length <= 4000, 'Write between 10 and 4000 characters.');
    run.postmortem = { text: body.text.trim(), by: ctx.helpers.audit(user), at: new Date().toISOString() };
    store.saveRun(run); ctx.helpers.runEvent(user, 'run.postmortem', run, { length: run.postmortem.text.length });
    return json(res, 200, run.postmortem);
  }
  if ((m = /^\/api\/runs\/([\w-]+)\/ticket$/.exec(route)) && req.method === 'POST') {
    const body = await readJson(req), run = store.run(m[1]);
    check(run && run.kind === 'tests' && TERMINAL.includes(run.status), 'Finish this run before creating a ticket.', 409);
    const caseId = body.caseId, existing = run.triage?.[caseId];
    if (existing?.ticketUrl) return json(res, 200, { url: existing.ticketUrl, key: existing.ticketKey, existing: true });
    const ticket = await tickets.create(run, caseId);
    const latest = store.run(run.id);
    latest.triage = { ...latest.triage, [caseId]: { severity: 'Not assessed', by: ctx.helpers.audit(user), ...(latest.triage?.[caseId] ?? {}), reference: ticket.key, ticketUrl: ticket.url, ticketKey: ticket.key, ticketProvider: ticket.provider } };
    store.saveRun(latest); ctx.helpers.runEvent(user, 'run.ticket', latest, { caseId, provider: ticket.provider, key: ticket.key });
    return json(res, 201, ticket);
  }

  // CI: start a run of every approved executable automated case in a module, then poll GET /api/runs/:id.
  if (route === '/api/ci/runs' && req.method === 'POST') {
    const body = await readJson(req);
    check(typeof body.moduleId === 'string' && typeof body.environmentId === 'string', 'Send moduleId and environmentId.');
    return json(res, 201, await ctx.helpers.startAll({ moduleId: body.moduleId, environmentId: body.environmentId, name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : `CI run (${new Date().toLocaleString()})` }, user, { source: 'ci' }));
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
