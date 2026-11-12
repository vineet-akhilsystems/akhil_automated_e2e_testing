import { check } from '../registry.mjs';
import { HttpError } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';

export default async function handle(ctx, rc) {
  const { req, res, url, user, acc, route } = rc;
  const { agent, store } = ctx;
  const { inModule } = ctx.membership;
  const { getModule, readinessFor, gateError } = ctx.helpers;
  if (route.startsWith('/api/')) {
        if (route === '/api/agent/status' && req.method === 'GET') {
          const status = await agent.status(), busyModule = status.busy && store.module(status.busy.moduleId);
          // Which module the agent is busy on is only shown to people who can see that module.
          return json(res, 200, status.busy && !(busyModule && acc.canSee(busyModule)) ? { ...status, busy: { busy: true } } : status);
        }
        const agentMatch = /^\/api\/modules\/([\w-]+)\/agent\/jobs(?:\/([\w-]+)(?:\/(cancel|files|retry))?)?$/.exec(route);
        if (agentMatch) {
          const [, mid, jid, sub] = agentMatch, module = getModule(mid);
          // An automation proposal without sources, insights, an approved case, a confirmed setup and discovery would be guesswork.
          const automationGate = () => { const state = readinessFor(module); if (!state.canProposeAutomation) throw gateError(`An automation proposal is not possible yet. ${state.proposalBlockers.join(' ')}`, state); };
          if (!jid && req.method === 'GET') return json(res, 200, agent.list(mid));
          if (!jid && req.method === 'POST') {
            const body = await readJson(req);
            check(body.kind !== 'automation' || acc.module(module).has('case.review'), 'Only a tester or administrator can ask for an automation proposal.', 403);
            if (body.kind === 'automation') automationGate();
            const job = await agent.start({ module, agent: String(body.agent ?? ''), kind: body.kind ?? 'analyze', fileIds: Array.isArray(body.fileIds) ? body.fileIds.slice(0, 500) : undefined, force: body.force === true, user });
            inModule(user, 'agent.start', mid, { jobId: job.id, agent: String(body.agent ?? ''), kind: body.kind ?? 'analyze', ...(body.force === true ? { force: true } : {}) });
            return json(res, 202, { id: job.id });
          }
          if (jid && sub === 'retry' && req.method === 'POST') {
            const old = agent.get(mid, jid);
            check(old.kind !== 'automation' || acc.module(module).has('case.review'), 'Only a tester or administrator can ask for an automation proposal.', 403);
            check(['interrupted', 'error'].includes(old.status), 'Only an interrupted or failed job can be retried.', 409);
            if (old.kind === 'automation') automationGate();
            const job = await agent.retry({ module, id: jid, user });
            inModule(user, 'agent.retry', mid, { jobId: job.id, retryOf: jid, agent: old.agent, kind: old.kind });
            return json(res, 202, { id: job.id, retryOf: jid });
          }
          if (jid && !sub && req.method === 'GET') return json(res, 200, agent.get(mid, jid));
          if (jid && sub === 'cancel' && req.method === 'POST') { agent.cancel(mid, jid); inModule(user, 'agent.cancel', mid, { jobId: jid }); return json(res, 200, { ok: true }); }
          if (jid && sub === 'files' && req.method === 'GET') return json(res, 200, agent.file(mid, jid, url.searchParams.get('path') ?? ''));
          throw new HttpError(404, 'API route not found.');
        }
  }
  return false;
}
