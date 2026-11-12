import { check, HttpError } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';
import { saveExternalInsights } from '../insights.mjs';

export default async function handle(ctx, rc) {
  const { req, res, url, user, route } = rc;
  const { store } = ctx;
  const { inModule } = ctx.membership;
  const { getModule, productName, sendPack } = ctx.helpers;
  if (route.startsWith('/api/')) {
        const intakeMatch = /^\/api\/modules\/([\w-]+)\/(intake|insights|pack)(?:\/(.*))?$/.exec(route);
        if (intakeMatch && intakeMatch[2] !== 'intake') {
          const [, mid, area, rest = ''] = intakeMatch, module = getModule(mid);
          const countsOf = d => ({ fields: d.fields.length, rules: d.rules.length, flows: d.flows.length, edgeCases: d.edgeCases.length, openQuestions: d.openQuestions.length, draftCases: d.draftCaseIds.length });
          if (area === 'insights' && !rest && req.method === 'GET') { const d = store.insights(mid); check(d, 'No insights yet. Analyze the intake files first.', 404); return json(res, 200, { ...d, productId: module.productId ?? 'augastam', productName: productName(module.productId) }); }
          if (area === 'insights' && rest === 'history' && req.method === 'GET') return json(res, 200, store.insightsHistory(mid).map(d => ({ id: d.id, version: d.version, createdAt: d.createdAt, createdBy: d.createdBy, mode: d.mode, basedOn: d.basedOn ?? null, counts: countsOf(d), changeSummary: d.changeSummary ?? null })));
          if (area === 'pack' && !rest && req.method === 'GET') return sendPack(req, res, module, url, user);
          if (area === 'insights' && !rest && req.method === 'PUT') {
            const saved = saveExternalInsights({ store, module, body: await readJson(req), user, mode: 'assistant' });
            inModule(user, 'insights.save', mid, { insightId: saved.id, draftCases: saved.draftCases });
            return json(res, 201, saved);
          }
          throw new HttpError(404, 'API route not found.');
        }
  }
  return false;
}
