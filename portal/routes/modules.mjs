import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { adapters, check, textValue, validateCase, HttpError } from '../registry.mjs';
import { moduleCoverage } from '../quality.mjs';
import { generateAiCases } from '../ai-generator.mjs';
import { cleanModuleUrl, cleanVariants } from '../readiness.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const { toXlsx, fromXlsx } = require('../../qa/tools/cases-io.js');

const MODULE_RE = /^\/api\/modules\/([\w-]+)(?:\/(cases|import|export|templates|coverage|requirements|ai-generate)(?:\/([\w-]+))?)?$/;

// Shared preamble for every /api/modules/:id[/(cases|import|export|templates|coverage|requirements|ai-generate)[/:caseId]] route.
// Resolves the module once (getModule: 404 when unknown) and caches it on rc.moduleScope, so route files
// that run later (cases) reuse it instead of looking it up again. Returns null when the path does not match.
export function moduleScope(ctx, rc) {
  if (rc.moduleScope !== undefined) return rc.moduleScope;
  const m = MODULE_RE.exec(rc.route);
  if (!m) return (rc.moduleScope = null);
  const [, id, resource, caseId] = m;
  return (rc.moduleScope = { id, resource, caseId, module: ctx.helpers.getModule(id) });
}

export default async function handle(ctx, rc) {
  const { req, res, url, user, acc, route } = rc;
  const { dataDir, store } = ctx;
  const { authorize } = ctx.access;
  const { record, inModule } = ctx.membership;
  const { now, audit, getModule, productName, envsFor, readinessFor, gateError, stampCase, fourEyes, fourEyesActive, caseContent } = ctx.helpers;
  if (route.startsWith('/api/')) {

        if (route === '/api/modules' && req.method === 'POST') {
          const body = await readJson(req);
          const name = textValue(body.name, 'Module name', 120, true);
          const product = authorize(user, 'module.create', { product: textValue(body.productId ?? 'augastam', 'Product', 80, true) }, acc).product;
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const id = slug && (product.id === 'augastam' ? slug : `${product.id}-${slug}`);
          check(id && !store.module(id), 'A module with that name already exists, or its name needs English letters/numbers.', 409);
          const prefix = textValue(body.prefix, 'Case prefix', 12, true).toUpperCase();
          check(/^[A-Z][A-Z0-9]{1,11}$/.test(prefix), 'Use 2–12 letters/numbers for the case prefix.');
          const adapter = body.adapter ? String(body.adapter) : null;
          if (adapter) check(Object.hasOwn(adapters, adapter), 'Choose a registered automation adapter.');
          const created = store.transaction(() => {
            const saved = store.saveModule({ id, productId: product.id, name, prefix, area: textValue(body.area ?? 'Setup', 'Area', 80, true), description: textValue(body.description ?? '', 'Description', 1000), adapter, config: { bases: {}, requirements: [] } });
            store.saveMembership({ id: randomUUID(), subjectType: 'user', subjectId: user.id, scopeType: 'module', scopeId: id, role: 'lead', overrides: {}, createdBy: user.username, createdAt: now() });
            record(user, { action: 'module.create', scopeType: 'module', scopeId: id, subject: null, detail: { productId: product.id, name } });
            record(user, { action: 'membership.add', scopeType: 'module', scopeId: id, subject: { type: 'user', id: user.id, name: user.username }, detail: { role: 'lead', overrides: {}, expiresAt: null, auto: true } });
            return saved;
          });
          return json(res, 201, created);
        }
        const setupMatch = /^\/api\/modules\/([\w-]+)\/(setup|readiness)$/.exec(route);
        if (setupMatch) {
          const [, mid, what] = setupMatch, module = getModule(mid);
          const setupView = m => ({ setup: m.setup ?? null, suggestedSetup: store.insights(m.id)?.suggestedSetup ?? null });
          if (what === 'readiness' && req.method === 'GET') return json(res, 200, readinessFor(module));
          if (what === 'setup' && req.method === 'GET') return json(res, 200, setupView(module));
          if (what === 'setup' && req.method === 'PUT') {
            const body = await readJson(req), productId = module.productId ?? 'augastam';
            const moduleUrl = cleanModuleUrl(body.moduleUrl), variants = cleanVariants(body.variants ?? []);
            check(typeof body.loginProfileId === 'string' && envsFor(productId).some(e => e.id === body.loginProfileId), `Choose a login profile of the product "${productName(productId)}".`);
            const setup = { moduleUrl, variants, loginProfileId: body.loginProfileId, confirmedBy: user.username, confirmedAt: now() };
            const saved = store.transaction(() => {
              const result = store.saveModule({ ...module, setup }, body.version ?? module.version);
              record(user, { action: 'module.setup', scopeType: 'module', scopeId: mid, subject: null, detail: { moduleUrl, variants, loginProfileId: setup.loginProfileId, previous: module.setup ? { moduleUrl: module.setup.moduleUrl, variants: module.setup.variants, loginProfileId: module.setup.loginProfileId } : null } });
              return result;
            });
            return json(res, 200, setupView(saved));
          }
          throw new HttpError(405, 'Method not allowed.');
        }
        const scope = moduleScope(ctx, rc);
        if (scope) {
          const { id, resource, caseId, module } = scope;
          if (resource === 'ai-generate' && req.method === 'POST') {
            const body = await readJson(req);
            // AI generation needs processed sources, insights and a connected automation package (stale insights only warn).
            const state = readinessFor(module);
            if (!state.canGenerateAi) throw gateError(`AI case generation is not available yet. ${state.blockers.join(' ')}`, state);
            const generated = await generateAiCases({ module, existingCases: store.cases(id), runs: store.runs().filter(r => r.module?.id === id), environments: envsFor(module.productId ?? 'augastam'), options: body });
            return json(res, 200, { ...generated, warnings: state.warnings });
          }
          if (resource === 'coverage' && req.method === 'GET') {
            const pool = envsFor(module.productId ?? 'augastam');
            const environmentId = url.searchParams.get('environmentId') ?? pool[0]?.id ?? '';
            check(!environmentId || pool.some(e => e.id === environmentId), 'Choose a configured environment.');
            return json(res, 200, moduleCoverage(module, store.cases(id), store.runs().filter(r => r.module?.id === id), environmentId));
          }
          if (resource === 'requirements' && req.method === 'PUT') {
            const body = await readJson(req);
            check(Array.isArray(body.requirements) && body.requirements.length <= 500, 'Use up to 500 requirement definitions per module.');
            const requirements = body.requirements.map(r => ({ id: textValue(r?.id, 'Requirement ID', 120, true), title: textValue(r?.title, 'Requirement title', 500, true) }));
            check(requirements.every(r => !/[,;\n]/.test(r.id)), 'Requirement IDs cannot contain commas, semicolons or newlines.');
            check(new Set(requirements.map(r => r.id)).size === requirements.length, 'Requirement IDs must be unique.');
            const saved = store.saveModule({ ...module, config: { ...module.config, requirements } }, body.version);
            inModule(user, 'module.requirements', id, { count: requirements.length });
            return json(res, 200, saved);
          }
          if (!resource && req.method === 'PUT') {
            const body = await readJson(req);
            const adapter = body.adapter === undefined ? module.adapter : (body.adapter ? String(body.adapter) : null);
            if (adapter) check(Object.hasOwn(adapters, adapter), 'Choose a registered automation adapter.');
            let settings = module.settings;
            if (body.settings !== undefined) {
              check(body.settings && typeof body.settings === 'object' && typeof body.settings.requireSecondApprover === 'boolean', 'settings.requireSecondApprover must be true or false.');
              settings = { ...module.settings, requireSecondApprover: body.settings.requireSecondApprover };
            }
            const saved = store.transaction(() => {
              const result = store.saveModule({ ...module, name: textValue(body.name ?? module.name, 'Module name', 120, true), area: textValue(body.area ?? module.area, 'Area', 80, true), description: textValue(body.description ?? module.description ?? '', 'Description', 1000), adapter, settings }, body.version);
              if (fourEyes(module) !== fourEyes(result)) record(user, { action: 'module.settings', scopeType: 'module', scopeId: id, subject: null, detail: { requireSecondApprover: { from: fourEyes(module), to: fourEyes(result) } } });
              const changedFields = ['name', 'area', 'description', 'adapter'].filter(k => (module[k] ?? null) !== (result[k] ?? null));
              if (changedFields.length) record(user, { action: 'module.update', scopeType: 'module', scopeId: id, subject: null, detail: { fields: changedFields } });
              return result;
            });
            return json(res, 200, saved);
          }
          if (resource === 'templates' && !caseId && req.method === 'PUT') {
            const body = await readJson(req);
            check(module.adapter, 'This module does not use automation data templates.');
            const name = textValue(body.name, 'Template name', 80, true);
            check(/^[\w-]+$/.test(name) && !['__proto__', 'constructor', 'prototype'].includes(name), 'Use letters, numbers, underscores or dashes for the template name.');
            validateCase({ id: 'TEMPLATE', title: 'Template validation', category: 'General', mode: 'automated', input: body.input, action: 'fill', expected: { outcome: 'field-state' } }, module);
            // Cases built on a template take their data from it, so under the second-approver rule a changed template sends them back to review.
            // Fill order follows the key order, so a reordered template counts as changed.
            const changed = JSON.stringify(module.config?.bases?.[name] ?? null) !== JSON.stringify(body.input ?? null);
            const reset = [];
            const saved = store.transaction(() => {
              const result = store.saveModule({ ...module, config: { ...module.config, bases: { ...module.config.bases, [name]: body.input } } }, body.version);
              if (changed) {
                // (the editor is the content author of every case on this template, so they can never approve any of them)
                for (const c of store.cases(id).filter(x => x.base === name)) {
                  const { reviewedBy, ...rest } = c, strict = fourEyesActive(module), downgrade = strict && (c.reviewStatus ?? 'approved') !== 'draft';
                  store.saveCase(id, { ...(downgrade ? rest : c), ...(downgrade ? { reviewStatus: 'draft' } : {}), contentBy: audit(user) }, c.version);
                  if (downgrade) reset.push(c.id);
                }
                if (reset.length) record(user, { action: 'cases.reset', scopeType: 'module', scopeId: id, subject: null, detail: { reason: 'template changed', template: name, caseIds: reset } });
              }
              record(user, { action: 'template.update', scopeType: 'module', scopeId: id, subject: null, detail: { template: name, created: module.config?.bases?.[name] === undefined, changed, casesReset: reset.length } });
              return result;
            });
            return json(res, 200, { ...saved, resetCases: reset });
          }
          if (resource === 'templates' && caseId && req.method === 'DELETE') {
            check(Object.hasOwn(module.config?.bases ?? {}, caseId), 'Template not found.', 404);
            const usedBy = store.cases(id).filter(c => c.base === caseId).map(c => c.id);
            check(!usedBy.length, `Cannot delete template "${caseId}" because it is used by: ${usedBy.slice(0, 8).join(', ')}.`, 409);
            const bases = { ...module.config.bases }; delete bases[caseId];
            const saved = store.saveModule({ ...module, config: { ...module.config, bases } }, module.version);
            inModule(user, 'template.delete', id, { template: caseId });
            return json(res, 200, saved);
          }
          if (resource === 'export' && req.method === 'GET') {
            const cases = store.cases(id);
            if (url.searchParams.get('format') !== 'xlsx') {
              res.setHeader('Content-Disposition', `attachment; filename="${id}-cases.json"`);
              return json(res, 200, { module: id, bases: module.config.bases, requirements: module.config.requirements ?? [], cases });
            }
            const temp = path.join(dataDir, `${randomUUID()}.xlsx`);
            try {
              if (module.adapter) await toXlsx(cases, temp);
              else {
                const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('cases');
                ws.columns = ['id', 'title', 'category', 'priority', 'notes', 'preconditions', 'requirement', 'steps'].map(k => ({ header: k, key: k, width: k === 'steps' ? 80 : 25 }));
                cases.forEach(c => ws.addRow({ ...c, steps: JSON.stringify(c.steps) }));
                ws.getRow(1).font = { bold: true }; await wb.xlsx.writeFile(temp);
              }
              const data = fs.readFileSync(temp);
              res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${id}-cases.xlsx"` }); res.end(data);
            } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
            return;
          }
          if (resource === 'import' && req.method === 'POST') {
            const body = await readJson(req); let values;
            if (body.format === 'xlsx') {
              const temp = path.join(dataDir, `${randomUUID()}.xlsx`);
              try {
                fs.writeFileSync(temp, Buffer.from(body.data ?? '', 'base64'));
                if (module.adapter) values = await fromXlsx(temp);
                else {
                  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(temp);
                  const ws = wb.getWorksheet('cases'); check(ws, 'Workbook needs a cases sheet.'); values = [];
                  const headers = ws.getRow(1).values;
                  ws.eachRow((row, index) => { if (index === 1) return;
                    const c = { mode: 'manual', steps: [] };
                    for (let i = 1; i < headers.length; i++) { const key = String(headers[i]); if (['id', 'title', 'category', 'priority', 'notes', 'preconditions', 'requirement', 'steps'].includes(key)) c[key] = String(row.getCell(i).text ?? ''); }
                    try { c.steps = JSON.parse(c.steps || '[]'); } catch { throw new HttpError(400, `Invalid steps JSON in row ${index}.`); }
                    values.push(c);
                  });
                }
              } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'Cannot read this Excel workbook. Use a portal export as the template.'); }
              finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
            } else values = Array.isArray(body.data) ? body.data : body.data?.cases;
            check(Array.isArray(values) && values.length > 0 && values.length <= 5000, 'Import must contain 1–5,000 cases.');
            if (body.upsert) authorize(user, 'case.edit', { module }, acc);
            const validated = values.map(c => validateCase(c, module));
            check(new Set(validated.map(c => c.id)).size === validated.length, 'Import contains duplicate case IDs.');
            if (!body.upsert) {
              for (const c of validated) check(!store.case(id, c.id), `Case ${c.id} already exists. Import uses new IDs only; edit existing cases in the portal.`, 409);
            }
            let changedContent = 0;
            store.transaction(() => validated.forEach(c => { const old = store.case(id, c.id); const next = store.saveCase(id, stampCase(c, old, user, module, acc), old?.version); if (!old || caseContent(old) !== caseContent(next)) changedContent++; }));
            inModule(user, 'case.import', id, { count: validated.length, upsert: Boolean(body.upsert), contentChanged: changedContent, ids: validated.slice(0, 50).map(c => c.id) });
            return json(res, 201, { imported: validated.length });
          }
        }
  }
  return false;
}
