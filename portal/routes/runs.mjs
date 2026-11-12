import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { check, textValue } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json, file } from '../http/respond.mjs';
import { classification, TERMINAL } from '../quality.mjs';
import { generatePdf } from '../pdf-report.mjs';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

export default async function handle(ctx, rc) {
  const { req, res, url, route } = rc;
  const { store, queue } = ctx;
  const { now, audit, getRun, visibleRun, summaryRun, createRun, runEvent } = ctx.helpers;
  if (route.startsWith('/api/')) {
        const { user, acc } = rc;
        if (route === '/api/runs' && req.method === 'GET') {
          const only = url.searchParams.get('product');
          return json(res, 200, store.runs().filter(r => (!only || (r.productId ?? 'augastam') === only) && visibleRun(acc, r)).map(summaryRun));
        }
        if (route === '/api/runs' && req.method === 'POST') return json(res, 201, createRun(await readJson(req), user));
        const runMatch = /^\/api\/runs\/([\w-]+)(?:\/(cancel|results|complete|files|export|triage|report|evidence|rerun-failures)(?:\/(.*))?)?$/.exec(route);
        if (runMatch) {
          const [, id, resource, relative] = runMatch, run = getRun(id);
          if (!resource && req.method === 'GET') return json(res, 200, { ...run, total: run.cases.length });
          if (resource === 'report' && req.method === 'PUT') {
            const body = await readJson(req), latest = getRun(id);
            check(latest.kind !== 'authentication' && TERMINAL.includes(latest.status), 'Finish this test run before preparing its final report.', 409);
            latest.reportDetails = Object.fromEntries(['title', 'preparedBy', 'release', 'build', 'notes'].map(key => [key, textValue(body[key] ?? '', `Report ${key}`, key === 'notes' ? 10000 : 500)]));
            store.saveRun(latest); runEvent(user, 'run.report', latest, { fields: Object.keys(latest.reportDetails) });
            return json(res, 200, latest);
          }
          if (resource === 'triage' && req.method === 'PUT') {
            const body = await readJson(req), latest = getRun(id), result = latest.results.find(r => r.id === relative);
            check(TERMINAL.includes(latest.status), 'Finish this run before recording final triage.', 409);
            check(result && classification(result), 'This case has no recorded finding to triage.', 404);
            check(['Not assessed', 'Critical', 'High', 'Medium', 'Low'].includes(body.severity ?? 'Not assessed'), 'Choose a valid reported severity.');
            check(classification(result) === 'failure' || !body.severity || body.severity === 'Not assessed', 'Application-defect severity applies to failed assertions. Execution issues and business-rule reviews remain separately classified.');
            const triage = { severity: body.severity ?? 'Not assessed', by: audit(user), ...Object.fromEntries(['owner', 'reference', 'impact', 'notes'].map(key => [key, textValue(body[key] ?? '', `Triage ${key}`, ['impact', 'notes'].includes(key) ? 10000 : 500)])) };
            latest.triage = { ...latest.triage, [relative]: triage }; store.saveRun(latest); runEvent(user, 'run.triage', latest, { caseId: relative, severity: triage.severity });
            return json(res, 200, latest);
          }
          if (resource === 'evidence' && req.method === 'POST') {
            const body = await readJson(req), latest = getRun(id);
            check(latest.mode === 'manual' && latest.status === 'manual', 'Evidence can only be added to an open manual run.', 409);
            const result = latest.results.find(r => r.id === body.caseId);
            check(result, 'Record a result for this case before attaching evidence.', 404);
            const name = textValue(body.name, 'Screenshot name', 180, true);
            check(typeof body.data === 'string' && body.data.length <= 5600000 && /^[A-Za-z0-9+/]*={0,2}$/.test(body.data), 'Upload a PNG screenshot up to 4 MB.');
            const data = Buffer.from(body.data, 'base64');
            check(data.length >= 33 && data.length <= 4 * 1024 * 1024 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.toString('ascii', 12, 16) === 'IHDR', 'Evidence must be a PNG screenshot.');
            const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
            check(width > 0 && height > 0 && width * height <= 60000000 && width <= 20000 && height <= 20000, 'Screenshot dimensions exceed the allowed size.');
            check((result.attachments?.length ?? 0) < 12, 'Attach up to 12 screenshots per case.');
            const filename = `${randomUUID()}.png`, directory = path.join(queue.dirFor(id), 'artifacts', 'manual');
            fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, filename), data);
            result.attachments = [...(result.attachments ?? []), { name, path: `artifacts/manual/${filename}`, contentType: 'image/png' }];
            store.saveRun(latest); return json(res, 200, latest);
          }
          if (resource === 'rerun-failures' && req.method === 'POST') {
            check(run.kind !== 'authentication' && TERMINAL.includes(run.status), 'Finish this run before re-running its failures.', 409);
            const failed = new Set(run.results.filter(r => ['FAIL', 'FAIL (assumed requirement)', 'ERROR'].includes(r.status)).map(r => r.id));
            const live = new Map(store.cases(run.module.id).map(c => [c.id, c]));
            const ids = run.cases.filter(c => failed.has(c.id) && live.get(c.id)?.enabled !== false && live.has(c.id)).map(c => c.id);
            check(ids.length > 0, 'This run has no failed cases that can be re-run.', 409);
            const name = `${run.name} (re-run failures)`.slice(0, 200);
            return json(res, 201, createRun({ moduleId: run.module.id, environmentId: run.environmentId, mode: run.mode, caseIds: ids, name }, user, { rerunOf: run.id }));
          }
          if (resource === 'cancel' && req.method === 'POST') { check(queue.cancel(id), 'Only queued or running automated runs can be cancelled.', 409); runEvent(user, 'run.cancel', run, {}); return json(res, 200, summaryRun(getRun(id))); }
          if (resource === 'results' && req.method === 'POST') {
            const body = await readJson(req), latest = getRun(id), c = latest.cases.find(c => c.id === body.id);
            check(latest.mode === 'manual' && latest.status === 'manual', 'This run does not accept manual results.', 409);
            check(c, 'Case not included in this run.', 404);
            check(['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'].includes(body.status), 'Choose a result status.');
            const existing = latest.results.find(r => r.id === c.id);
            const result = { id: c.id, title: c.title, status: body.status, actual: textValue(body.actual, 'Actual result', 10000, true), expected: c.steps.map((s, i) => `${i + 1}. ${s.expected}`).join('\n'), recordedAt: now(), mismatches: [], durationMs: 0, attachments: existing?.attachments ?? [], evidenceWarnings: existing?.evidenceWarnings ?? [] };
            latest.results = [...latest.results.filter(r => r.id !== c.id), result]; store.saveRun(latest); return json(res, 200, latest);
          }
          if (resource === 'complete' && req.method === 'POST') {
            check(run.mode === 'manual' && run.status === 'manual', 'This manual run is already closed.', 409);
            check(run.results.length === run.cases.length, 'Record a result for every case before closing.', 409);
            run.status = run.results.every(r => ['PASS', 'SKIPPED'].includes(r.status)) ? 'passed' : 'failed'; run.finishedAt = now(); store.saveRun(run); runEvent(user, 'run.complete', run, { status: run.status });
            return json(res, 200, run);
          }
          if (resource === 'export' && req.method === 'GET') {
            const format = url.searchParams.get('format') ?? 'json';
            check(['pdf', 'xlsx', 'json'].includes(format), 'Choose PDF, Excel or JSON export.');
            if (format === 'pdf') {
              const target = await generatePdf(run, queue.dirFor(id));
              return await file(res, target, true, `${run.module.id}-bug-report-${id.slice(0, 8)}.pdf`);
            }
            if (url.searchParams.get('format') === 'xlsx') {
              const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Results');
              ws.columns = ['id', 'title', 'status', 'expected', 'actual', 'category', 'priority', 'requirement', 'durationMs', 'screenshots', 'evidenceWarnings', 'severity', 'owner', 'reference'].map(k => ({ header: k, key: k, width: k === 'id' ? 16 : ['title', 'expected', 'actual'].includes(k) ? 55 : 22 }));
              for (const c of run.cases) {
                const r = run.results.find(x => x.id === c.id), t = run.triage?.[c.id] ?? {};
                const imgs = (r?.attachments ?? []).filter(a => String(a?.contentType ?? '').startsWith('image/')).length;
                ws.addRow({
                  id: c.id, title: c.title, status: r?.status ?? 'NOT EXECUTED', expected: r?.expected ?? '', actual: r?.actual ?? '',
                  category: c.category ?? '', priority: c.priority ?? '', requirement: c.requirement ?? '', durationMs: r?.durationMs ?? 0,
                  screenshots: imgs, evidenceWarnings: (r?.evidenceWarnings ?? []).join('; '),
                  severity: t.severity ?? '', owner: t.owner ?? '', reference: t.reference ?? '',
                });
              }
              ws.getRow(1).font = { bold: true };
              res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${id}-results.xlsx"` });
              res.end(Buffer.from(await wb.xlsx.writeBuffer())); return;
            }
            res.setHeader('Content-Disposition', `attachment; filename="${id}-results.json"`); return json(res, 200, run);
          }
          if (resource === 'files' && req.method === 'GET') {
            const runDir = queue.dirFor(id), target = path.resolve(runDir, decodeURIComponent(relative ?? ''));
            check(target.startsWith(runDir + path.sep), 'Invalid artifact path.', 403);
            check(/\.(png|zip|xlsx|json|md|log|pdf)$/.test(target), 'Unsupported artifact type.', 403);
            check(fs.existsSync(target), 'Artifact not found.', 404);
            check(fs.realpathSync(target).startsWith(fs.realpathSync(runDir) + path.sep), 'Invalid artifact path.', 403);
            return await file(res, target, url.searchParams.has('download'));
          }
        }
  }
  return false;
}
