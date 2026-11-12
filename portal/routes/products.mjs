import { check, textValue, adapters } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';
import { ROLES } from '../users.mjs';
import { AI_PRESETS, presetsFor } from '../ai-generator.mjs';

export default async function handle(ctx, rc) {
  const { req, res, url, user, acc, route } = rc;
  const { store, users, options } = ctx;
  const { sessionUser } = ctx.sessions;
  const { authorize, pidOf } = ctx.access;
  const { record } = ctx.membership;
  const { productList, envsFor, publicEnvironment, visibleRun, summaryRun } = ctx.helpers;
        if (route === '/api/products' && req.method === 'GET') return json(res, 200, productList(acc));
        if (route === '/api/products' && req.method === 'POST') {
          const body = await readJson(req);
          const name = textValue(body.name, 'Product name', 80, true);
          const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          check(/^[a-z][a-z0-9-]*$/.test(id), 'The product name must start with an English letter and use English letters/numbers.');
          check(!store.product(id), 'A product with that name already exists.', 409);
          const saved = store.saveProduct({ id, name, description: textValue(body.description ?? '', 'Description', 1000) });
          record(user, { action: 'product.create', scopeType: 'product', scopeId: id, subject: null, detail: { name } });
          return json(res, 201, { id: saved.id, name: saved.name, description: saved.description });
        }
        if (route === '/api/bootstrap' && req.method === 'GET') {
          const asked = url.searchParams.get('product');
          const product = asked ? authorize(user, 'product.view', { product: asked }, acc).product : (acc.productVisible('augastam') && store.product('augastam')) || acc.visibleProducts()[0] || null;
          const mine = product ? acc.visibleModules().filter(m => pidOf(m) === product.id) : [];
          return json(res, 200, { product: product ? { id: product.id, name: product.name, description: product.description ?? '' } : null, products: productList(acc), user: sessionUser(user), roles: ROLES, project: (options.env ?? process.env).PORTAL_PROJECT_NAME || 'Augastam', capabilities: { intake: true, insights: true, review: true, modulePack: true, rerunFailures: true, accounts: users.exists(), insightsMode: (options.env ?? process.env).ANTHROPIC_API_KEY ? 'llm' : 'heuristic', coverage: true, pdfReport: true, triage: true, manualEvidence: true, bulkCases: true, aiGenerator: true }, aiPresets: AI_PRESETS, modules: mine.map(m => {
            const cases = store.cases(m.id);
            return { ...m, aiPresets: presetsFor(m), caseCount: cases.length, automatedCount: cases.filter(c => c.mode === 'automated' && c.action !== 'unavailable' && c.enabled !== false).length, blockedAutomationCount: cases.filter(c => c.action === 'unavailable').length, reviewCount: cases.filter(c => c.expected?.assumed).length, draftCount: cases.filter(c => c.reviewStatus === 'draft').length, rejectedCount: cases.filter(c => c.reviewStatus === 'rejected').length, requirementCount: (m.config?.requirements ?? []).length };
          }), environments: product ? envsFor(product.id).map(e => publicEnvironment(e, acc.runStartIn(product.id))) : [], adapters: Object.values(adapters).map(({ spec, ...a }) => a), runs: product ? store.runs().filter(r => (r.productId ?? 'augastam') === product.id && visibleRun(acc, r)).map(summaryRun) : [] });
        }
  return false;
}
