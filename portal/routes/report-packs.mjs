import path from 'node:path';
import { check } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json, file } from '../http/respond.mjs';
import { reportModel } from '../quality.mjs';
import { normalizeRequest } from '../reports/pack.mjs';
import { applyFilter } from '../reports/filter.mjs';

// What a client sees of a job: never a server path (the ZIP is addressed by its job id).
const publicJob = job => {
  const { fingerprint, result, ...rest } = job;
  return { ...rest, ...(result ? { result: { file: path.basename(result.file), size: result.size, manifest: result.manifest } } : {}) };
};

// Report packs: estimate, build in the background, list, status and download. Access is the run's report.view (checked before this runs).
export default async function handle(ctx, rc) {
  const { req, res, route } = rc;
  const m = /^\/api\/runs\/([\w-]+)\/(report-pack\/estimate|report-pack|report-packs(?:\/([\w-]+)(\/download)?)?)$/.exec(route);
  if (!m) return false;
  const { store, reportJobs } = ctx;
  const run = store.run(m[1]);
  check(run && run.kind === 'tests', 'Run not found.', 404);

  if (m[2] === 'report-pack/estimate' && req.method === 'POST') return json(res, 200, reportJobs.estimate(run, await readJson(req)));
  if (m[2] === 'report-pack' && req.method === 'POST') {
    const body = await readJson(req);
    const request = normalizeRequest(body);
    const job = reportJobs.start(run, request, rc.user.displayName || rc.user.username);
    ctx.helpers.runEvent(rc.user, 'run.report-pack', run, { reports: request.reports, filter: applyFilter(reportModel(run), request.filter).description });
    return json(res, 202, { id: job.id });
  }
  if (m[2] === 'report-packs' && req.method === 'GET') return json(res, 200, reportJobs.list(run.id).map(publicJob));
  if (m[3] && !m[4] && req.method === 'GET') {
    const job = reportJobs.get(run.id, m[3]);
    check(job, 'Report pack not found.', 404);
    return json(res, 200, publicJob(job));
  }
  if (m[3] && m[4] && req.method === 'GET') return file(res, reportJobs.filePath(run.id, m[3]), true);
  return false;
}
