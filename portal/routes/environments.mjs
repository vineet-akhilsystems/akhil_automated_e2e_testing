import { check, textValue } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';
import { LOGIN_KEYS } from '../environment-settings.mjs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export default async function handle(ctx, rc) {
  const { req, res, route } = rc;
  const { dataDir, store, queue, environments, settings } = ctx;
  const { record } = ctx.membership;
  const { now, audit, credentialsFor, publicEnvironment, getProduct, productName, summaryRun } = ctx.helpers;
  if (route.startsWith('/api/')) {
        const { user } = rc;
        if (route === '/api/environments' && req.method === 'POST') {
          const body = await readJson(req);
          const previous = environments.find(e => e.id === body.id);
          const productId = body?.productId ?? previous?.productId ?? 'augastam';
          check(typeof productId === 'string', 'Choose a product.');
          getProduct(productId);
          check(!previous || (previous.productId ?? 'augastam') === productId, 'A login profile cannot be moved to another product. Create a new profile instead.', 409);
          body.productId = productId;
          check(!store.runs().some(r => r.environmentId === body.id && ['queued', 'running'].includes(r.status)), 'Wait for this profile\'s queued or running jobs to finish before changing login settings.', 409);
          // Which fields changed is logged, never their values.
          const before = previous ? credentialsFor(previous) : {}, fieldsChanged = previous ? ['name', 'url'].filter(k => body[k] !== undefined && body[k] !== previous[k]) : [];
          for (const k of Object.keys(LOGIN_KEYS)) { const v = body.credentials?.[k]; if (v !== undefined && v !== '' && (!previous || v !== before?.[k])) fieldsChanged.push(k); }
          const saved = settings.save(body, previous, previous ? credentialsFor(previous) : null);
          record(user, { action: previous ? 'environment.update' : 'environment.create', scopeType: 'product', scopeId: productId, subject: null, detail: { environment: saved.id, ...(previous ? { fieldsChanged } : {}) } });
          // A fresh directory prevents reuse of an old account/session after edits.
          const environment = { ...saved, managed: true, authDir: path.join(dataDir, 'auth', saved.id, `v${saved.version}`) };
          const index = environments.findIndex(e => e.id === saved.id);
          if (index < 0) environments.push(environment); else environments[index] = environment;
          return json(res, previous ? 200 : 201, publicEnvironment(environment));
        }
        const authMatch = /^\/api\/environments\/([\w-]+)\/auth$/.exec(route);
        if (authMatch && req.method === 'POST') {
          const environment = environments.find(e => e.id === authMatch[1]);
          check(environment, 'Not found.', 404);
          check((environment.productId ?? 'augastam') === 'augastam', 'Login automation for this product has not been built yet. Manual testing and intake work now; ask a developer to add the login adapter.', 409);
          check(publicEnvironment(environment).loginConfigured, 'Add the application credentials in Settings first.', 409);
          check(!store.runs().some(r => r.kind === 'authentication' && r.environmentId === environment.id && ['queued', 'running'].includes(r.status)), 'Login is already queued or running.', 409);
          const run = { id: randomUUID(), name: `Refresh ${environment.name} login`, kind: 'authentication', mode: 'automated', environmentId: environment.id, environmentName: environment.name, environmentUrl: environment.url, productId: 'augastam', productName: productName('augastam'),
            module: { id: 'authentication', name: 'Application login', area: 'Shared setup' }, cases: [], results: [], status: 'queued', createdAt: now() };
          run.createdBy = audit(user); store.saveRun(run);
          record(user, { action: 'environment.auth.refresh', scopeType: 'product', scopeId: 'augastam', subject: null, detail: { environment: environment.id, runId: run.id } });
          setImmediate(queue.pump); return json(res, 201, summaryRun(run));
        }
  }
  return false;
}
