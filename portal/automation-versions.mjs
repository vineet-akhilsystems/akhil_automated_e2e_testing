import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';

// Automation versions: the automation (tests, adapter files, plugin code, fixtures, shared helpers) is hashed by CONTENT.
// Cases (the data) are not part of it. The registry keeps file paths and hashes only. Everything here is read-only on the repo.
const EXCLUDED = new Set(['node_modules', 'results', 'discovery', 'cases', 'bugs', 'test-results', '.auth']);
const CODE_EXT = new Set(['.ts', '.mjs', '.cjs', '.js', '.json', '.md']);
const MAX_FILES = 500, MAX_BYTES = 1024 * 1024, RECENT_MS = 2000;
const TEXT_EXT = new Set(['.ts', '.mjs', '.cjs', '.js', '.json', '.md', '.txt', '.yml', '.yaml', '.html', '.css']);
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
  const norm = TEXT_EXT.has(path.extname(file).toLowerCase()) ? lf : b => b;
  if (size > MAX_BYTES) {
    const fd = fs.openSync(file, 'r');
    try { const data = Buffer.alloc(MAX_BYTES); fs.readSync(fd, data, 0, MAX_BYTES, 0); return sha(Buffer.concat([norm(data), Buffer.from(`\n#size:${size}`)])); } finally { fs.closeSync(fd); }
  }
  return sha(norm(fs.readFileSync(file)));
}

// Per-process cache of file hashes by (path, mtime, size). Files modified in the last couple of seconds are never trusted from cache.
const fileCache = new Map();
// A listed file that cannot be read THROWS: skipping it would change the hash and create a spurious version.
// io.hashFile is a test seam.
export function fingerprintAutomation(root, moduleId, io = {}) {
  const hash = io.hashFile ?? hashFile;
  const { files: paths, truncated } = collect(root, moduleId), now = Date.now(), files = [];
  for (const rel of paths) {
    const abs = path.join(root, rel), st = fs.statSync(abs);
    const key = `${abs}|${st.mtimeMs}|${st.size}`, settled = now - st.mtimeMs > RECENT_MS && !io.hashFile;
    let digest = settled ? fileCache.get(key) : undefined;
    if (!digest) {
      digest = hash(abs, st.size);
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
  try { execFile('git', args, { cwd, timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => resolve(error ? null : String(stdout))); } catch { resolve(null); }
});
// Decodes a C-style quoted path from git status --porcelain (octal escapes are UTF-8 bytes).
function unquote(p) {
  if (!(p.length > 1 && p.startsWith('"') && p.endsWith('"'))) return p;
  const bytes = [], s = p.slice(1, -1), map = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') { bytes.push(...Buffer.from(s[i])); continue; }
    const oct = /^[0-7]{3}/.exec(s.slice(i + 1));
    if (oct) { bytes.push(parseInt(oct[0], 8)); i += 3; } else { bytes.push(map[s[i + 1]] ?? s.charCodeAt(i + 1)); i++; }
  }
  return Buffer.from(bytes).toString('utf8');
}
// Paths touched by git status --porcelain: both sides of a rename; untracked directories end with a slash.
export function parseStatus(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (line.length < 4) continue;
    const rest = line.slice(3), code = line.slice(0, 2);
    for (const part of /[RC]/.test(code) ? rest.split(' -> ') : [rest]) out.push(unquote(part.trim()).replace(/\\/g, '/'));
  }
  return out;
}
// Default git helper: ONE repo-wide status filtered in code (a pathspec list can exceed the Windows command-line limit).
// Never throws, never uses a shell; anything unknown returns {} (never claims clean). run is a test seam.
export function defaultGit(root, run = runGit) {
  return async paths => {
    try {
      const head = await run(['rev-parse', 'HEAD'], root), commit = head?.trim();
      if (!commit) return {};
      const status = await run(['status', '--porcelain', '-uall'], root);
      if (status === null || status === undefined) return {};
      const hashed = new Set(paths.map(p => String(p).replace(/\\/g, '/'))), touched = parseStatus(status);
      const dirty = touched.some(p => hashed.has(p) || (p.endsWith('/') && [...hashed].some(h => h.startsWith(p))));
      return { commit, dirty };
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
  const attempt = () => store.transaction(() => {
    const again = existing();
    if (again) return again;
    const previous = store.latestAutomationVersion(moduleId);
    const record = { moduleId, number: (previous?.number ?? 0) + 1, hash: fp.hash, createdAt: new Date().toISOString(), createdBy: by, trigger, note: String(note ?? ''),
      changedFiles: diffFiles(previous?.files ?? [], fp.files), files: fp.files, ...(fp.truncated ? { truncated: true } : {}), pendingGit: true };
    store.insertAutomationVersion(record);
    return record;
  });
  // A unique violation means another writer got there first: same hash -> return theirs; same number, other hash -> renumber once. Never overwrite.
  try { return attempt(); } catch (e) {
    if (!isUnique(e)) throw e;
    const winner = existing(); if (winner) return winner;
    try { return attempt(); } catch (e2) { if (isUnique(e2)) { const w = existing(); if (w) return w; } throw e2; }
  }
}

// Adds gitCommit / uncommitted to a freshly created version, once. Swallows every git failure.
export async function annotateAutomationVersion({ store, root, moduleId, number, git = defaultGit(root) }) {
  const record = store.automationVersionByNumber(moduleId, number);
  if (!record?.pendingGit) return record;
  let info = {};
  try { info = (await git(record.files.map(f => f.path))) ?? {}; } catch { info = {}; }
  const patch = { pendingGit: undefined, ...(typeof info.commit === 'string' && info.commit ? { gitCommit: info.commit } : {}), ...(typeof info.dirty === 'boolean' ? { uncommitted: info.dirty } : {}) };
  return store.updateAutomationVersion(moduleId, number, patch);
}
