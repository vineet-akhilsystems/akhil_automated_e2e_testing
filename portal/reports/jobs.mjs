// Report pack jobs: builds run in the background, one record per job at <runDir>/packs/<jobId>.json.
// Only a job whose status is 'done' has a download; partial files (.tmp-*) are never listed or served.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { check, HttpError } from '../registry.mjs';
import { previousRun } from '../compare.mjs';
import { normalizeRequest, packFingerprint, estimatePack, buildPack } from './pack.mjs';

const ID = /^[\w-]+$/;
const RESTARTED = 'The portal restarted while this was building.';

export function createReportJobs({ store, dirFor, logger = null, now = () => new Date() }) {
  const live = new Map(); // `${runId}/${jobId}` -> job still being built by this process
  const building = new Map(); // `${runId}/${fingerprint}` -> running job
  const pending = new Set(); // promises of builds in flight
  const packsDir = runId => path.join(dirFor(runId), 'packs');
  const recordFile = (runId, id) => path.join(packsDir(runId), `${id}.json`);

  function save(job) {
    try {
      fs.mkdirSync(packsDir(job.runId), { recursive: true });
      const target = recordFile(job.runId, job.id), temporary = `${target}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(job, null, 2));
      fs.renameSync(temporary, target);
    } catch (error) { logger?.(`Could not save report pack job ${job.id}: ${error.message}`, 'stderr'); }
  }
  function readRecord(runId, id) {
    if (!ID.test(String(id))) return null;
    try {
      const job = JSON.parse(fs.readFileSync(recordFile(runId, id), 'utf8'));
      return job && job.id === id && job.runId === runId ? job : null; // a record can only be addressed through its own run
    } catch { return null; }
  }
  function recordsOf(runId) {
    let names = [];
    try { names = fs.readdirSync(packsDir(runId)); } catch { return []; }
    return names.filter(n => /^[\w-]+\.json$/.test(n)).map(n => readRecord(runId, n.slice(0, -5))).filter(Boolean);
  }

  // Startup: a job left 'running' by a previous process can never finish.
  for (const run of store.runs()) {
    for (const job of recordsOf(run.id)) {
      if (job.status !== 'running') continue;
      save({ ...job, status: 'error', error: RESTARTED, finishedAt: now().toISOString() });
    }
  }

  const get = (runId, jobId) => live.get(`${runId}/${jobId}`) ?? readRecord(runId, jobId);
  const list = runId => {
    const byId = new Map(recordsOf(runId).map(j => [j.id, j]));
    for (const j of live.values()) if (j.runId === runId) byId.set(j.id, j);
    return [...byId.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  };
  const optionsFor = run => ({ runDir: dirFor(run.id), previous: previousRun(store.runs(), run) });

  /** Counts and size for a request. Throws 400 (bad request), 409 (run not reportable) or 413 (too large for one ZIP). */
  const estimate = (run, rawReq) => estimatePack(run, rawReq, optionsFor(run));

  /** Starts a build and returns at once. An identical request returns the running job, or the finished pack when its ZIP still exists. */
  function start(run, rawReq, who) {
    const options = optionsFor(run);
    estimatePack(run, rawReq, options); // surfaces 400, 409 and 413 before any job exists
    const req = normalizeRequest(rawReq), fingerprint = packFingerprint(run, req), key = `${run.id}/${fingerprint}`;
    const running = building.get(key);
    if (running) return running;
    const reusable = list(run.id).find(j => j.status === 'done' && j.fingerprint === fingerprint && j.result?.file && fs.existsSync(j.result.file));
    if (reusable) return reusable;

    const job = { id: randomUUID(), runId: run.id, status: 'running', startedAt: now().toISOString(), finishedAt: null, progress: [], request: req, fingerprint };
    live.set(`${run.id}/${job.id}`, job); building.set(key, job);
    save(job);
    const finish = patch => { Object.assign(job, patch, { finishedAt: now().toISOString() }); live.delete(`${run.id}/${job.id}`); building.delete(key); save(job); };
    const work = buildPack({ run, runDir: options.runDir, req, who, previous: options.previous, onProgress: text => { job.progress.push(String(text)); save(job); } })
      .then(result => finish({ status: 'done', result }),
        error => {
          if (!(error instanceof HttpError)) logger?.(`Report pack ${job.id} failed: ${error.stack ?? error}`, 'stderr');
          finish({ status: 'error', error: error instanceof HttpError ? error.message : 'The report pack could not be built. Check the server log.' });
        })
      .finally(() => pending.delete(work));
    pending.add(work);
    return job;
  }

  /** The ZIP of a finished job. 404 for an unknown job or a missing file, 409 while the job is not done. */
  function filePath(runId, jobId) {
    const job = get(runId, jobId);
    check(job, 'Report pack not found.', 404);
    check(job.status === 'done' && job.result?.file, 'This report pack is not ready.', 409);
    const file = path.resolve(job.result.file), dir = path.resolve(packsDir(runId));
    check(path.dirname(file) === dir && file.endsWith('.zip') && !path.basename(file).startsWith('.') && fs.existsSync(file), 'The report pack file is no longer available. Build it again.', 404);
    return file;
  }

  /** Waits for builds in flight; nothing else is left running. */
  async function stop() { await Promise.allSettled([...pending]); }

  return { estimate, start, list, get, filePath, stop };
}
