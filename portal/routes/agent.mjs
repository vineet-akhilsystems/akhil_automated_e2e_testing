import { check, HttpError, adapters, reloadAdapters } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';
import { install, InstallError } from '../../qa/tools/install-module-adapter.mjs';
import { convertCaseToAutomated } from '../automate.mjs';

export default async function handle(ctx, rc) {
  const { req, res, url, user, acc, route } = rc;
  const { agent, store } = ctx;
  const { authorize } = ctx.access;
  const { inModule } = ctx.membership;
  const { getModule, readinessFor, gateError } = ctx.helpers;
  if (route.startsWith('/api/')) {
        if (route === '/api/agent/status' && req.method === 'GET') {
          const status = await agent.status(), busyModule = status.busy && store.module(status.busy.moduleId);
          // Which module the agent is busy on is only shown to people who can see that module.
          return json(res, 200, status.busy && !(busyModule && acc.canSee(busyModule)) ? { ...status, busy: { busy: true } } : status);
        }
        // AI quality, limits and usage (administrators only): the three presets, today's job count and a 7-day usage summary.
        if (route === '/api/ai/policy') {
          const policy = agent.policy;
          check(policy, 'AI settings are not available on this server.', 404);
          check(user.role === 'admin', 'Only an administrator can view or change AI settings.', 403);
          if (req.method === 'GET') return json(res, 200, { ...policy.get(), presets: policy.presets(), usage: policy.usage(7) });
          if (req.method === 'PUT') {
            const body = await readJson(req), before = policy.get(), saved = policy.save(body);
            store.audit({ actor: user.username, action: 'ai.policy', scopeType: 'system', scopeId: 'ai', subject: null, detail: { from: before, to: saved } });
            return json(res, 200, { ...saved, presets: policy.presets(), usage: policy.usage(7) });
          }
          throw new HttpError(405, 'Method not allowed.');
        }
        const agentMatch = /^\/api\/modules\/([\w-]+)\/agent\/jobs(?:\/([\w-]+)(?:\/(cancel|files|retry|install))?)?$/.exec(route);
        if (agentMatch) {
          const [, mid, jid, sub] = agentMatch, module = getModule(mid);
          // An automation proposal without sources, insights, an approved case, a confirmed setup and discovery would be guesswork.
          const automationGate = () => { const state = readinessFor(module); if (!state.canProposeAutomation) throw gateError(`An automation proposal is not possible yet. ${state.proposalBlockers.join(' ')}`, state); };
          if (!jid && req.method === 'GET') return json(res, 200, agent.list(mid));
          if (!jid && req.method === 'POST') {
            const body = await readJson(req);
            check(body.kind !== 'automation' || acc.module(module).has('case.review'), 'Only a tester or administrator can ask for an automation proposal.', 403);
            if (body.kind === 'automation') automationGate();
            // Letting the agent read source code from the server's disk is limited to testers and administrators.
            const wantsCode = Array.isArray(body.codePaths) ? body.codePaths.some(p => String(p).trim()) : body.codePaths != null;
            check(!wantsCode || acc.module(module).has('case.review'), 'Only a tester or administrator can point the agent at a codebase.', 403);
            const job = await agent.start({ module, agent: String(body.agent ?? ''), kind: body.kind ?? 'analyze', fileIds: Array.isArray(body.fileIds) ? body.fileIds.slice(0, 500) : undefined, force: body.force === true, critic: body.critic !== false, prompt: body.prompt, codePaths: body.codePaths, user });
            inModule(user, 'agent.start', mid, { jobId: job.id, agent: String(body.agent ?? ''), kind: body.kind ?? 'analyze', ...(body.force === true ? { force: true } : {}), ...(body.prompt ? { hasPrompt: true } : {}), ...(wantsCode ? { codePaths: body.codePaths.length } : {}) });
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
          if (jid && sub === 'install' && req.method === 'POST') {
            authorize(user, 'module.settings', { module }, acc);
            await readJson(req);
            const job = agent.get(mid, jid);
            check(job.status === 'done', 'Only a finished AI job can be installed.', 409);
            check(job.kind === 'automation', 'Only an automation proposal job can be installed.', 400);
            const productId = module.productId ?? 'augastam';
            let installed;
            try {
              installed = await install(
                ['--module', mid, '--product', productId, '--job', jid, '--data-dir', ctx.dataDir, '--yes', '--force'],
                { root: ctx.layoutRoot, run: () => ({ code: 0, output: '' }), log: () => {} },
              );
            } catch (e) {
              if (e instanceof InstallError) throw new HttpError(400, e.message);
              throw e;
            }
            reloadAdapters({ root: ctx.layoutRoot, warn: () => {} });
            const validated = adapters[mid];
            check(validated, `Adapter "${mid}" did not register after installation.`, 500);
            const existing = store.cases(mid);
            const nextModule = {
              ...module,
              adapter: mid,
              config: {
                ...module.config,
                bases: { ...(module.config?.bases ?? {}), ...(validated.bases ?? {}) },
                requirements: module.config?.requirements ?? [],
              },
            };
            let convertedCases = 0;
            const savedModule = store.transaction(() => {
              const savedMod = store.saveModule(nextModule, module.version);
              for (const c of existing) {
                const converted = convertCaseToAutomated(c, savedMod, validated);
                store.saveCase(mid, converted, c.version);
                if (c.mode !== 'automated') convertedCases++;
              }
              return savedMod;
            });
            inModule(user, 'agent.install', mid, { jobId: jid, adapter: mid, convertedCases });
            return json(res, 200, { ok: true, adapter: mid, files: installed.files, convertedCases, readiness: readinessFor(savedModule) });
          }
          throw new HttpError(404, 'API route not found.');
        }
  }
  return false;
}
