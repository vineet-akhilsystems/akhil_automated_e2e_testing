import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from '../registry.mjs';

export function acquireLock(dataDir) {
  // Exactly one worker supervisor may own a data directory, even on different ports.
  const lockFile = path.join(dataDir, 'worker.lock');
  if (fs.existsSync(lockFile)) {
    let lockInfo;
    try { lockInfo = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch { /* invalid stale lock */ }
    const owner = lockInfo?.pid;
    let alive = false;
    if (Number.isInteger(owner) && owner > 0) { try { process.kill(owner, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; } }
    if (alive) {
      const error = new HttpError(409, 'This portal data directory already has a running server. Stop it before starting another instance.');
      error.code = 'PORTAL_ALREADY_RUNNING';
      error.portalUrl = lockInfo.url;
      error.pid = owner;
      throw error;
    }
    fs.unlinkSync(lockFile);
  }
  const lockHandle = fs.openSync(lockFile, 'wx');
  fs.writeFileSync(lockHandle, JSON.stringify({ pid: process.pid })); fs.closeSync(lockHandle);
  return {
    release() { fs.rmSync(lockFile, { force: true }); },
    write(info) { fs.writeFileSync(lockFile, JSON.stringify(info)); },
  };
}
