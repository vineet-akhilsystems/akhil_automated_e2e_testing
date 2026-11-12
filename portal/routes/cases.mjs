import { check, textValue, validateCase } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';

export default async function handle(ctx, rc) {
  const { req, res, route } = rc;
  const { store } = ctx;
  const { inModule } = ctx.membership;
  const { audit, stampCase, fourEyesActive, caseContent } = ctx.helpers;
  if (route.startsWith('/api/')) {
        const { user, acc } = rc;
        const moduleMatch = rc.moduleScope; // resolved by routes/modules.mjs (moduleScope)
        if (moduleMatch) {
          const { id, resource, caseId, module } = moduleMatch;
          const mayDeleteCase = existing => { const perms = acc.module(module); return perms.has('case.delete') || Boolean(existing && perms.has('case.edit') && existing.createdBy?.user === user.username); };
          if (resource === 'cases' && !caseId && req.method === 'GET') return json(res, 200, store.cases(id));
          if (resource === 'cases' && caseId === 'review' && req.method === 'POST') {
            const body = await readJson(req);
            check(Array.isArray(body.ids) && body.ids.length > 0 && body.ids.length <= 5000, 'Select between 1 and 5,000 cases.');
            check(['approved', 'rejected'].includes(body.decision), 'Decision must be approved or rejected.');
            const ids = [...new Set(body.ids.map(x => textValue(x, 'Case ID', 80, true)))], note = textValue(body.note ?? '', 'Review note', 2000);
            store.transaction(() => {
              for (const cid of ids) {
                const existing = store.case(id, cid);
                check(existing, `Case ${cid} not found.`, 404);
                // Whoever created the case, last changed its content, or last saved it may not approve or reject it.
                check(!fourEyesActive(module) || ![existing.createdBy, existing.contentBy, existing.updatedBy].some(who => who?.user === user.username), 'Another person must approve this case.', 403);
                store.saveCase(id, { ...existing, reviewStatus: body.decision, reviewedBy: { ...audit(user), decision: body.decision, ...(note ? { note } : {}) } }, existing.version);
              }
            });
            inModule(user, 'case.review', id, { decision: body.decision, count: ids.length, ids: ids.slice(0, 50), noteGiven: Boolean(note) });
            return json(res, 200, { updated: ids.length, decision: body.decision });
          }
          if (resource === 'cases' && caseId === 'bulk' && req.method === 'POST') {
            const body = await readJson(req);
            check(Array.isArray(body.caseIds) && body.caseIds.length > 0 && body.caseIds.length <= 5000, 'Select between 1 and 5,000 cases.');
            check(['enable', 'disable', 'delete', 'priority', 'category'].includes(body.action), 'Choose a supported bulk action.');
            const ids = [...new Set(body.caseIds.map(x => textValue(x, 'Case ID', 80, true)))];
            const ignoreSet = new Set(ids);
            store.transaction(() => {
              // Delete rule: case.delete (lead/admin) may delete any case; case.edit alone (tester) only cases they created. One refusal rejects the whole request.
              if (body.action === 'delete') for (const cid of ids) check(mayDeleteCase(store.case(id, cid)), 'Your role does not allow deleting cases.', 403);
              for (const cid of ids) {
                const existing = store.case(id, cid);
                check(existing, `Case ${cid} not found.`, 404);
                if (body.action === 'delete') {
                  store.deleteCase(id, cid, ignoreSet);
                } else {
                  const next = structuredClone(existing);
                  if (body.action === 'enable' || body.action === 'disable') next.enabled = body.action === 'enable';
                  if (body.action === 'priority') { check(['P0', 'P1', 'P2', 'P3'].includes(body.value), 'Choose priority P0–P3.'); next.priority = body.value; }
                  if (body.action === 'category') next.category = textValue(body.value, 'Suite', 120, true);
                  if (!acc.module(module).has('case.review') && (next.reviewStatus ?? 'approved') !== 'draft') { next.reviewStatus = 'draft'; delete next.reviewedBy; }
                  store.saveCase(id, validateCase(next, module), existing.version);
                }
              }
            });
            inModule(user, 'case.bulk', id, { action: body.action, count: ids.length, ids: ids.slice(0, 50), ...(['priority', 'category'].includes(body.action) ? { value: body.value } : {}) });
            return json(res, 200, { updated: ids.length, action: body.action });
          }
          if (resource === 'cases' && caseId && req.method === 'DELETE') {
            check(acc.module(module).has('case.delete') || acc.module(module).has('case.edit'), 'Your role does not allow this action.', 403);
            const target = store.case(id, caseId);
            if (target) check(mayDeleteCase(target), 'Your role does not allow deleting cases you did not create.', 403);
            const deleted = store.deleteCase(id, caseId);
            inModule(user, 'case.delete', id, { id: caseId });
            return json(res, 200, deleted);
          }
          if (resource === 'cases' && ['POST', 'PUT'].includes(req.method)) {
            const body = await readJson(req);
            const validated = validateCase(body, module);
            if (req.method === 'POST') check(!caseId && !store.case(id, body.id), 'Case ID already exists.', 409);
            else check(caseId && body.id === caseId && store.case(id, caseId), 'Case not found or its ID was changed.', 404);
            const before = req.method === 'PUT' ? store.case(id, caseId) : undefined;
            const savedCase = store.saveCase(id, stampCase(validated, before, user, module, acc), body.version);
            inModule(user, before ? 'case.update' : 'case.create', id, { id: savedCase.id, contentChanged: before ? caseContent(before) !== caseContent(savedCase) : true, reviewStatus: savedCase.reviewStatus ?? null });
            return json(res, req.method === 'POST' ? 201 : 200, savedCase);
          }
        }
  }
  return false;
}
