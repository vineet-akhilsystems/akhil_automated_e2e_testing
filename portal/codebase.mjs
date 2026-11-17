import fs from 'node:fs';
import path from 'node:path';
import { check } from './registry.mjs';

// Lets a tester point the coding agent at the application's source code so it can write cases from what the code really does.
// The agent never reads the server's disk directly: we copy a bounded, filtered, text-only snapshot into its sandbox
// (input/codebase/), exactly like the discovery output. Secrets, dependencies, build output and binaries are never copied.

export const CODE_CAPS = { paths: 5, pathLength: 500, files: 150, bytesPerFile: 60_000, totalBytes: 1_200_000, depth: 10 };

const SKIP_DIRS = new Set(['node_modules', '.git', '.auth', '.portal', '.ssh', '.aws', '.gnupg', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache', '.venv', 'venv', '__pycache__', 'bin', 'obj', 'target', 'test-results', 'playwright-report', '.idea', '.vscode']);
const TEXT_EXT = /\.(tsx?|jsx?|mjs|cjs|json|md|txt|css|scss|html?|vue|svelte|py|java|kt|cs|cshtml|razor|go|rb|php|sql|ya?ml|xml|graphql|gql|prisma)$/i;
// Names that usually hold credentials, plus lock files (large and useless for understanding behaviour).
const SKIP_FILE = /^\.env|^login\.txt$|^portal_login\.txt$|\.(pem|key|pfx|p12|crt|cer|keystore|jks)$|(^|[._-])(secrets?|credentials?|id_rsa|htpasswd)([._-]|$)|(^|[._-])(package-lock|yarn|pnpm-lock|composer)\.(json|lock|ya?ml)$|\.min\.(js|css)$|\.map$/i;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

const allowedRoots = (env = process.env) => String(env.AGENT_CODE_ROOTS ?? '').split(path.delimiter).map(s => s.trim()).filter(Boolean).map(r => { try { return fs.realpathSync(path.resolve(r)); } catch { return null; } }).filter(Boolean);
const inside = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

// Turns what the tester typed into safe, existing, real paths. Throws a 400 with a plain message for anything else.
export function resolveCodePaths(input, env = process.env) {
  const list = input == null ? [] : input;
  check(Array.isArray(list), 'Code paths must be a list.');
  const cleaned = list.map(p => { check(typeof p === 'string' && p.length <= CODE_CAPS.pathLength, `Each code path must be text of at most ${CODE_CAPS.pathLength} characters.`); return p.trim(); }).filter(Boolean);
  check(cleaned.length <= CODE_CAPS.paths, `Give at most ${CODE_CAPS.paths} code paths.`);
  const roots = allowedRoots(env);
  const seen = new Set(), out = [];
  for (const raw of cleaned) {
    check(path.isAbsolute(raw), `"${raw}" is not a full path. Use a full path such as C:\\projects\\app\\src or /home/me/app/src.`);
    let real;
    try { real = fs.realpathSync(path.resolve(raw)); } catch { check(false, `"${raw}" was not found on the portal server.`); }
    check(path.parse(real).root !== real, 'Point at a project folder, not a whole drive.');
    check(!real.split(path.sep).some(seg => ['.auth', '.portal', '.ssh', '.aws', '.gnupg'].includes(seg)), `"${raw}" is a private folder and cannot be read by the agent.`);
    check(!SKIP_FILE.test(path.basename(real)), `"${raw}" looks like a secrets file and cannot be read by the agent.`);
    if (roots.length) check(roots.some(r => inside(real, r)), `"${raw}" is outside the folders the administrator allowed for code reading.`, 403);
    if (seen.has(real)) continue;
    seen.add(real); out.push(real);
  }
  return out;
}

// Copies a bounded text snapshot of each path into dest and writes dest/INDEX.txt. Returns { files, bytes, skipped, truncated }.
export function copyCodebase(paths, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let files = 0, bytes = 0, skipped = 0, truncated = false;
  const index = [];
  const copyOne = (from, rel) => {
    if (files >= CODE_CAPS.files || bytes >= CODE_CAPS.totalBytes) { truncated = true; return; }
    let size; try { size = fs.statSync(from).size; } catch { skipped++; return; }
    if (size > CODE_CAPS.bytesPerFile || bytes + size > CODE_CAPS.totalBytes) { skipped++; return; }
    const text = fs.readFileSync(from, 'utf8');
    if (text.includes('\u0000') || PRIVATE_KEY.test(text)) { skipped++; return; }
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, text);
    files++; bytes += size; index.push(`${rel.split(path.sep).join('/')} (${size} bytes)`);
  };
  const walk = (dir, rel, depth) => {
    if (depth > CODE_CAPS.depth) { truncated = true; return; }
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isSymbolicLink()) { skipped++; continue; }
      const from = path.join(dir, e.name), to = path.join(rel, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(from, to, depth + 1); continue; }
      if (!e.isFile()) continue;
      if (SKIP_FILE.test(e.name) || !TEXT_EXT.test(e.name)) { skipped++; continue; }
      copyOne(from, to);
    }
  };
  paths.forEach((p, i) => {
    const label = `${String(i + 1).padStart(2, '0')}-${path.basename(p).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '') || 'code'}`;
    if (fs.statSync(p).isDirectory()) walk(p, label, 0);
    else if (!SKIP_FILE.test(path.basename(p)) && TEXT_EXT.test(path.basename(p))) copyOne(p, label);
    else skipped++;
  });
  const head = `Read-only snapshot of the application code (${files} files, ${bytes} bytes${truncated ? ', trimmed to the size limit' : ''}${skipped ? `, ${skipped} skipped: secrets, binaries, dependencies, oversized or non-text files` : ''}).\n`;
  fs.writeFileSync(path.join(dest, 'INDEX.txt'), head + index.join('\n') + '\n');
  return { files, bytes, skipped, truncated };
}
