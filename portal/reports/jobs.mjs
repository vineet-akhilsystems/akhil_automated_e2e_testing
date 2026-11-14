// Report pack jobs: builds run in the background, one record per job at <runDir>/packs/<jobId>.json.
// Only a job whose status is 'done' has a download; partial files (.tmp-*) are never listed or served.
// At most `maxRunning` builds run at once; later jobs wait as 'queued' and start in the order they were asked for.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { check, HttpError } from '../registry.mjs';
import { previousRun } from '../compare.mjs';
import { normalizeRequest, packFingerprint, estimatePack, buildPack } from './pack.mjs';

const ID = /^[\w-]+$/;
const RESTARTED = { running: 'The portal restarted while this was building.', queued: 'The portal restarted before this pack was built.' };
const WAITING = 'Waiting for another report to finish';
const BUSY = 'A report pack is already being built for this run. Wait for it to finish.';

export function createReportJobs({ store, dirFor, logger = null, now = () => new Date(), build = buildPack, maxRunning = 2 }) {
  const live = new Map(); // `${runId}/${jobId}` -> job still queued or being built by this process
  const building = new Map(); // `${runId}/${fingerprint}` -> active (queued or running) job
  const activeBy = new Map(); // `${runId}/${owner}` -> active job of that user for that run (kept out of the record)
  const waiting = []; // starters of queued jobs, oldest first
  const pending = new Set(); // promises of builds in flight
  let running = 0, stopping = false;
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

  // Startup: a job left queued or running by a previous process can never finish, and its partial files
  // (.tmp-<uuid>/ work folders and .tmp-<uuid>.zip) are never used again. Finished .zip and .json files stay.
  for (const run of store.runs()) {
    let names = [];
    try { names = fs.readdirSync(packsDir(run.id)); } catch { continue; }
    for (const name of names.filter(n => n.startsWith('.tmp-'))) {
      try { fs.rmSync(path.join(packsDir(run.id), name), { recursive: true, force: true }); } catch (error) { logger?.(`Could not remove ${name}: ${error.message}`, 'stderr'); }
    }
    for (const job of recordsOf(run.id)) {
      if (!RESTARTED[job.status]) continue;
      save({ ...job, status: 'error', error: RESTARTED[job.status], finishedAt: now().toISOString() });
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

  // Starts queued jobs while a slot is free. Nothing new starts once stop() was called.
  function pump() {
    while (!stopping && running < maxRunning && waiting.length) waiting.shift()();
  }

  /** Starts a build (or queues it) and returns at once. An identical request returns the active job, or the finished pack
   * when its ZIP still exists. `owner` identifies the user: one active job per user and run, a different request is 409. */
  function start(run, rawReq, who, owner) {
    const options = optionsFor(run);
    estimatePack(run, rawReq, options); // surfaces 400, 409 and 413 before any job exists
    const req = normalizeRequest(rawReq), fingerprint = packFingerprint(run, req), key = `${run.id}/${fingerprint}`;
    const active = building.get(key);
    if (active) return active;
    const reusable = list(run.id).find(j => j.status === 'done' && j.fingerprint === fingerprint && j.result?.file && fs.existsSync(j.result.file));
    if (reusable) return reusable;
    const ownerKey = owner == null ? null : `${run.id}/${owner}`;
    check(!ownerKey || !activeBy.has(ownerKey), BUSY, 409);

    const job = { id: randomUUID(), runId: run.id, status: 'queued', startedAt: now().toISOString(), finishedAt: null, progress: [WAITING], request: req, fingerprint };
    live.set(`${run.id}/${job.id}`, job); building.set(key, job);
    if (ownerKey) activeBy.set(ownerKey, job);
    const finish = patch => {
      Object.assign(job, patch, { finishedAt: now().toISOString() });
      live.delete(`${run.id}/${job.id}`); building.delete(key); if (ownerKey) activeBy.delete(ownerKey);
      save(job);
    };
    const launch = () => {
      running++;
      Object.assign(job, { status: 'running', progress: [] });
      save(job);
      // Promise.resolve().then: a synchronous throw from build ends the job as an error instead of leaking its slot.
      const work = Promise.resolve()
        .then(() => build({ run, runDir: options.runDir, req, who, previous: options.previous, onProgress: text => { job.progress.push(String(text)); save(job); } }))
        .then(result => finish({ status: 'done', result }),
          error => {
            if (!(error instanceof HttpError)) logger?.(`Report pack ${job.id} failed: ${error?.stack ?? error}`, 'stderr');
            finish({ status: 'error', error: error instanceof HttpError ? error.message : 'The report pack could not be built. Check the server log.' });
          })
        .finally(() => { pending.delete(work); running--; pump(); });
      pending.add(work);
    };
    waiting.push(launch);
    pump();
    if (job.status === 'queued') save(job);
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

  /** Starts nothing new and waits at most `waitMs` for builds in flight. A build still going after that is abandoned:
   * its record stays 'running' (queued ones stay 'queued') and the next start turns it into an error. */
  async function stop({ waitMs = 10000 } = {}) {
    stopping = true;
    let timer;
    const bound = new Promise(resolve => { timer = setTimeout(resolve, waitMs); });
    try { await Promise.race([Promise.allSettled([...pending]), bound]); } finally { clearTimeout(timer); }
  }

  return { estimate, start, list, get, filePath, stop };
}
