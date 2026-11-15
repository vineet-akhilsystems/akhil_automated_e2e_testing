import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';

// Automation versions: the automation (tests, adapter files, plugin code, fixtures, shared helpers) is hashed by CONTENT.
// Cases (the data) are not part of it. The registry keeps file paths and hashes only. Everything here is read-only on the repo.
const EXCLUDED = new Set(['node_modules', 'results', 'discovery', 'cases', 'bugs', 'test-results', '.auth']);
const CODE_EXT = new Set(['.ts', '.mjs', '.cjs', '.js', '.json', '.md']);
const MAX_FILES = 500, MAX_BYTES = 1024 * 1024, RECENT_MS = 2000;
const QA_FILES = ['adapter.json', 'workflows.json', 'tree.json', 'rules.md'];
const sha = data => createHash('sha256').update(data).digest('hex');

function walk(root, rel, anyExt, out) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    if (out.files.length >= MAX_FILES) { out.truncated = true; return; }
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) { if (!EXCLUDED.has(e.name)) walk(root, child, anyExt, out); }
    else if (e.isFile() && (anyExt || CODE_EXT.has(path.extname(e.name).toLowerCase()))) out.files.push(child);
  }
}

function collect(root, moduleId) {
  const out = { files: [], truncated: false };
  const id = String(moduleId);
  if (!id || /[\\/]|^\.+$/.test(id)) return out;
  walk(root, `tests/modules/${id}`, false, out);
  for (const f of QA_FILES) { const rel = `qa/modules/${id}/${f}`; try { if (fs.lstatSync(path.join(root, rel)).isFile()) out.files.push(rel); } catch { /* missing is fine */ } }
  walk(root, `qa/modules/${id}/versions`, false, out);
  walk(root, `portal/modules/${id}`, false, out);
  walk(root, 'tests/fixtures', true, out);
  walk(root, 'tests/shared', true, out);
  try { if (fs.lstatSync(path.join(root, 'playwright.config.ts')).isFile()) out.files.push('playwright.config.ts'); } catch { /* missing is fine */ }
  out.files = [...new Set(out.files)].sort();
  if (out.files.length > MAX_FILES) { out.files.length = MAX_FILES; out.truncated = true; }
  return out;
}

export function automationFiles(root, moduleId) { return collect(root, moduleId).files; }

// CRLF -> LF so Windows and Linux checkouts hash the same; nothing else is normalized.
function lf(buffer) {
  if (!buffer.includes(13)) return buffer;
  const out = Buffer.allocUnsafe(buffer.length); let n = 0;
  for (let i = 0; i < buffer.length; i++) { if (buffer[i] === 13 && buffer[i + 1] === 10) continue; out[n++] = buffer[i]; }
  return out.subarray(0, n);
}
function hashFile(file, size) {
  if (size > MAX_BYTES) {
    const fd = fs.openSync(file, 'r');
    try { const data = Buffer.alloc(MAX_BYTES); fs.readSync(fd, data, 0, MAX_BYTES, 0); return sha(Buffer.concat([lf(data), Buffer.from(`\n#size:${size}`)])); } finally { fs.closeSync(fd); }
  }
  return sha(lf(fs.readFileSync(file)));
}

// Per-process cache of file hashes by (path, mtime, size). Files modified in the last couple of seconds are never trusted from cache.
const fileCache = new Map();
export function fingerprintAutomation(root, moduleId) {
  const { files: paths, truncated } = collect(root, moduleId), now = Date.now(), files = [];
  for (const rel of paths) {
    const abs = path.join(root, rel);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    const key = `${abs}|${st.mtimeMs}|${st.size}`, settled = now - st.mtimeMs > RECENT_MS;
    let digest = settled ? fileCache.get(key) : undefined;
    if (!digest) {
      try { digest = hashFile(abs, st.size); } catch { continue; }
      if (settled) { if (fileCache.size > 5000) fileCache.clear(); fileCache.set(key, digest); }
    }
    files.push({ path: rel, sha256: digest });
  }
  return { hash: sha(files.map(f => `${f.path}:${f.sha256}`).join('\n')), files, truncated };
}

export function diffFiles(prev = [], next = []) {
  const before = new Map(prev.map(f => [f.path, f.sha256])), after = new Map(next.map(f => [f.path, f.sha256]));
  return {
    added: [...after.keys()].filter(p => !before.has(p)).sort(),
    changed: [...after.keys()].filter(p => before.has(p) && before.get(p) !== after.get(p)).sort(),
    removed: [...before.keys()].filter(p => !after.has(p)).sort(),
  };
}

const runGit = (args, cwd) => new Promise(resolve => {
  try { execFile('git', args, { cwd, timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout))); } catch { resolve(null); }
});
// Default git helper: never throws, never uses a shell.
export function defaultGit(root) {
  return async paths => {
    try {
      const head = await runGit(['rev-parse', 'HEAD'], root);
      const commit = head?.trim() || undefined;
      const status = commit && paths.length ? await runGit(['status', '--porcelain', '--', ...paths], root) : null;
      return { ...(commit ? { commit } : {}), ...(status !== null ? { dirty: status.trim().length > 0 } : {}) };
    } catch { return {}; }
  };
}

const isUnique = e => /UNIQUE|constraint/i.test(String(e?.message ?? ''));

// Synchronous: hash, number and record. Git details are added afterwards by annotateAutomationVersion.
export function registerAutomationVersion({ store, root, moduleId, by = null, trigger = 'run', note = '', fingerprint = fingerprintAutomation }) {
  const fp = fingerprint(root, moduleId);
  const existing = () => store.automationVersionByHash(moduleId, fp.hash);
  const found = existing();
  if (found) return found;
  try {
    return store.transaction(() => {
      const again = existing();
      if (again) return again;
      const previous = store.automationVersions(moduleId)[0];
      const record = { moduleId, number: (previous?.number ?? 0) + 1, hash: fp.hash, createdAt: new Date().toISOString(), createdBy: by, trigger, note: String(note ?? ''),
        changedFiles: diffFiles(previous?.files ?? [], fp.files), files: fp.files, ...(fp.truncated ? { truncated: true } : {}), pendingGit: true };
      store.saveAutomationVersion(record);
      return record;
    });
  } catch (e) {
    if (isUnique(e)) { const winner = existing(); if (winner) return winner; }
    throw e;
  }
}

// Adds gitCommit / uncommitted to a freshly created version, once. Swallows every git failure.
export async function annotateAutomationVersion({ store, root, moduleId, number, git = defaultGit(root) }) {
  const record = store.automationVersionByNumber(moduleId, number);
  if (!record?.pendingGit) return record;
  let info = {};
  try { info = (await git(record.files.map(f => f.path))) ?? {}; } catch { info = {}; }
  const fresh = store.automationVersionByNumber(moduleId, number);
  if (!fresh?.pendingGit) return fresh;
  const { pendingGit, ...rest } = fresh;
  const next = { ...rest, ...(typeof info.commit === 'string' && info.commit ? { gitCommit: info.commit } : {}), ...(typeof info.dirty === 'boolean' ? { uncommitted: info.dirty } : {}) };
  store.saveAutomationVersion(next);
  return next;
}
