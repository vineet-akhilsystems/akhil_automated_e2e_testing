import { check } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';
import { loadKnowledge, readLayers, saveLayer, LAYERS } from '../knowledge.mjs';

// The tester knowledge pack for a module: what the AI agent is told about how a senior tester thinks, the product's domain, and the
// module's lessons. Anyone who can see the module can read it. The module's lessons are edited by people who can change module
// settings (leads); the shared mindset and product domain notes are administrator-only because they affect every module.
export default async function handle(ctx, rc) {
  const { req, res, route } = rc;
  const m = /^\/api\/modules\/([\w-]+)\/knowledge$/.exec(route);
  if (!m) return false;
  const { store, knowledgeRoot } = ctx, { inModule } = ctx.membership;
  const module = store.module(m[1]);
  check(module, 'Module not found.', 404);

  if (req.method === 'GET') {
    const used = loadKnowledge({ root: knowledgeRoot, module });
    return json(res, 200, { layers: readLayers({ root: knowledgeRoot, module }), used: { files: used.files, chars: used.chars } });
  }
  if (req.method === 'PUT') {
    const body = await readJson(req);
    check(LAYERS.includes(body.layer), 'Choose which notes to save.');
    check(typeof body.text === 'string', 'Send the text to save.');
    if (body.layer !== 'module') check(rc.acc.admin, 'Only an administrator can change the shared notes. Ask for a lesson to be added to this module instead.', 403);
    const id = body.layer === 'mindset' ? null : body.layer === 'domain' ? String(module.productId ?? 'augastam').toLowerCase() : String(module.id).toLowerCase();
    const saved = saveLayer({ root: knowledgeRoot, layer: body.layer, id, text: body.text });
    inModule(rc.user, 'knowledge.update', module.id, { layer: body.layer, chars: saved.chars });
    return json(res, 200, { ...saved, layers: readLayers({ root: knowledgeRoot, module }), used: (({ files, chars }) => ({ files, chars }))(loadKnowledge({ root: knowledgeRoot, module })) });
  }
  return false;
}
