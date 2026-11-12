import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { check, HttpError } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';
import { analyseModule } from '../insights.mjs';

export default async function handle(ctx, rc) {
  const { req, res, url, user, acc, route } = rc;
  const { options, store, intake, logger, jobs } = ctx;
  const { trail, inModule } = ctx.membership;
  const { now, getModule } = ctx.helpers;
  if (route.startsWith('/api/')) {
        const intakeMatch = /^\/api\/modules\/([\w-]+)\/(intake|insights|pack)(?:\/(.*))?$/.exec(route);
        if (intakeMatch && intakeMatch[2] === 'intake') {
          const [, mid, area, rest = ''] = intakeMatch, module = getModule(mid);
          const insightsMeta = d => d && ({ id: d.id, version: d.version, createdAt: d.createdAt, createdBy: d.createdBy, mode: d.mode, status: d.status, model: d.model, fallbackReason: d.fallbackReason, summary: d.summary,
            counts: { fields: d.fields.length, rules: d.rules.length, flows: d.flows.length, edgeCases: d.edgeCases.length, openQuestions: d.openQuestions.length, draftCases: d.draftCaseIds.length } });
          if (area === 'intake') {
            if (!rest && req.method === 'GET') return json(res, 200, { files: intake.list(mid), insights: insightsMeta(store.insights(mid)) ?? null, maxMb: intake.maxBytes / 1048576, mode: (options.env ?? process.env).ANTHROPIC_API_KEY ? 'llm' : 'heuristic' });
            if (rest === 'files' && req.method === 'POST') {
              const received = await intake.receive(req, mid, user);
              if (received.duplicate) {
                inModule(user, 'intake.duplicate', mid, { duplicateOf: received.duplicateOf, name: received.name, size: received.size });
                return json(res, 200, received);
              }
              inModule(user, 'intake.upload', mid, { fileId: received.id, name: received.name, size: received.size });
              return json(res, 201, received);
            }
            const fileMatch = /^files\/([\w-]+)(?:\/(download|text))?$/.exec(rest);
            if (fileMatch) {
              const record = store.intakeFile(mid, fileMatch[1]);
              check(record, 'Not found.', 404);
              if (fileMatch[2] === 'text' && req.method === 'GET') {
                const [one] = await intake.ensureExtracted([record]);
                const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 60000, 1000), 400000), offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
                const text = one.content.text ?? '';
                return json(res, 200, { id: record.id, name: record.name, kind: record.kind, extract: one.file.extract, note: one.file.extractNote ?? '', totalChars: text.length, offset, text: text.slice(offset, offset + limit), truncated: offset + limit < text.length });
              }
              if (fileMatch[2] && req.method === 'GET') {
                const disk = intake.filePath(record);
                check(fs.existsSync(disk), 'File is missing from storage.', 404);
                res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(disk).size, 'Cache-Control': 'no-store',
                  'Content-Disposition': `attachment; filename="${record.name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(record.name)}` });
                return void fs.createReadStream(disk).pipe(res);
              }
              if (!fileMatch[2] && req.method === 'DELETE') {
                check(acc.module(module).has('case.delete') || record.uploadedBy === user.username, 'Only an administrator or the uploader can remove this file.', 403);
                intake.remove(record); trail(user, { action: 'intake.delete', scopeType: 'module', scopeId: mid, subject: null, detail: { fileId: record.id, name: record.name } }); return json(res, 200, { deleted: record.id });
              }
            }
            if (rest === 'analyze' && req.method === 'POST') {
              const body = await readJson(req);
              check(![...jobs.values()].some(j => j.moduleId === mid && j.status === 'running'), 'An analysis is already running for this module.', 409);
              let files = store.intakeFiles(mid);
              if (body.fileIds !== undefined) {
                check(Array.isArray(body.fileIds) && body.fileIds.length <= 500, 'fileIds must be a list of file IDs.');
                const wanted = new Set(body.fileIds.map(String)); files = files.filter(f => wanted.has(f.id));
              }
              check(files.length > 0, 'Upload at least one file before analyzing.');
              const job = { id: randomUUID(), moduleId: mid, status: 'running', message: 'Starting', progress: 5, startedAt: now() };
              jobs.set(job.id, job);
              for (const [old, j] of jobs) if (jobs.size > 50 && j.status !== 'running') jobs.delete(old);
              (async () => {
                try {
                  job.message = 'Extracting text'; job.progress = 15;
                  const sources = await intake.ensureExtracted(files);
                  const { doc, cases } = await analyseModule({ module: store.module(mid), sources, existingCases: () => store.cases(mid), user, env: options.env ?? process.env,
                    onProgress: (progress, message) => { job.progress = progress; job.message = message; }, fetchImpl: options.fetchImpl });
                  store.transaction(() => { store.saveInsights(doc); cases.forEach(c => store.saveCase(mid, c)); });
                  Object.assign(job, { status: 'done', progress: 100, insightId: doc.id, mode: doc.mode, draftCases: cases.length, message: `Insights ready (${doc.mode === 'llm' ? 'AI-assisted' : 'rule-based heuristic'}); ${cases.length} draft case(s) awaiting review.` });
                } catch (error) {
                  if (!error.status) logger?.(`Analysis failed: ${error.stack ?? error}`, 'stderr');
                  Object.assign(job, { status: 'error', message: error.status ? error.message : 'Analysis failed. Check the server log.' });
                }
              })();
              inModule(user, 'intake.analyze', mid, { jobId: job.id, files: files.length });
              return json(res, 202, { jobId: job.id });
            }
            const jobMatch = /^analyze\/([\w-]+)$/.exec(rest);
            if (jobMatch && req.method === 'GET') {
              const job = jobs.get(jobMatch[1]);
              check(job && job.moduleId === mid, 'Analysis job not found.', 404);
              return json(res, 200, job);
            }
          }
          throw new HttpError(404, 'API route not found.');
        }
  }
  return false;
}
