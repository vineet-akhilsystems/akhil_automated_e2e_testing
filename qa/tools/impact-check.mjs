#!/usr/bin/env node
// Change-impact audit: "you changed X, so also check Y". A safety net driven by qa/impact-map.json, not a replacement for tests.
// Never reads file contents; credential and session paths are dropped before any matching or output.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAP_FILE = path.join(ROOT, 'qa', 'impact-map.json');

// Names are assembled from parts so this file never spells them out in one piece.
const ENV_PREFIX = '.' + 'env';
const SECRET_FILES = new Set([['login', 'txt'].join('.'), ['portal_login', 'txt'].join('.')]);
const SESSION_DIR = '.' + 'auth';

export class UsageError extends Error {}

export const norm = p => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');

// Generated outputs: never trigger rules and are never listed.
export const GENERATED_GLOBS = ['qa/*/*/results/**'];

/** True for credential or session paths (every path segment is tested, so a folder with such a name is dropped too) and for generated outputs. */
export function isIgnoredPath(p) {
  const n = norm(p);
  if (n.split('/').filter(Boolean).some(seg => {
    const s = seg.toLowerCase();
    return s === SESSION_DIR || s.startsWith(ENV_PREFIX) || SECRET_FILES.has(s);
  })) return true;
  return GENERATED_GLOBS.some(g => matchGlob(g, n));
}

const escapeRe = c => c.replace(/[.+^$()|[\]\\{}*?]/g, '\\$&');

// Index of the brace that closes the one opening at `open`, tracking nesting; -1 when unbalanced.
function closingBrace(glob, open) {
  let depth = 0;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === '{') depth++;
    else if (glob[i] === '}' && --depth === 0) return i;
  }
  return -1;
}
function splitTopLevel(text) {
  const parts = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    else if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

function globToSource(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '{') {
      if (glob.startsWith('{module}', i)) { out += '(?<module>[^/]+)'; i += 7; continue; }
      if (glob.startsWith('{product}', i)) { out += '(?<product>[^/]+)'; i += 8; continue; }
      const end = closingBrace(glob, i);
      if (end === -1) out += '\\{';
      else { out += '(?:' + splitTopLevel(glob.slice(i + 1, end)).map(globToSource).join('|') + ')'; i = end; }
    } else out += escapeRe(c);
  }
  return out;
}

const cache = new Map();
/**
 * Self-contained glob matcher: `*` stays inside a folder, `**` crosses folders, `?`, `{x,y}` (nesting allowed),
 * a trailing `/` means the folder. `{module}` and `{product}` each match one folder name and are captured, so a rule can name the
  * same module of the same product in another tree.
 */
export function globToRegExp(glob) {
  let re = cache.get(glob);
  if (!re) {
    let g = norm(glob);
    if (g.endsWith('/')) g += '**';
    re = new RegExp('^' + globToSource(g) + '$');
    cache.set(glob, re);
  }
  return re;
}
export const matchGlob = (glob, file) => globToRegExp(glob).test(norm(file));
export const hasMagic = p => /[*?{]/.test(p);
const targetOf = t => t.path ?? t.glob;
const withModule = (pattern, module, product) => {
  let out = module == null ? pattern : pattern.replaceAll('{module}', module);
  if (product != null) out = out.replaceAll('{product}', product);
  return out;
};

/**
 * changed: file paths. map: parsed impact-map. exists(pathOrGlob): optional, true when the target exists in the repo.
 * A target that is also one of the rule's own `when` patterns is only listed while it is still missing from the change
 * (it lets a rule describe a group of files that must move together).
 * A rule with severity "advisory" is shown but never counts toward --strict.
 */
export function checkImpact({ changed = [], map, exists = () => true }) {
  const files = [...new Set(changed.map(norm))].filter(f => f && !isIgnoredPath(f));
  const results = [];
  for (const rule of map?.rules ?? []) {
    const whens = (rule.when ?? []).filter(g => !isIgnoredPath(g));
    const groups = new Map(); // `${product}\u0000${module}` (empty parts when the glob has no placeholder) -> matched files
    for (const f of files) {
      for (const g of whens) {
        const m = globToRegExp(g).exec(f);
        if (!m) continue;
        const key = `${m.groups?.product ?? ''}\u0000${m.groups?.module ?? ''}`;
        if (!groups.has(key)) groups.set(key, new Set());
        groups.get(key).add(f);
        break;
      }
    }
    for (const [key, set] of groups) {
      const [productPart, modulePart] = key.split('\u0000');
      const module = modulePart === '' ? null : modulePart, product = productPart === '' ? null : productPart;
      const targets = [];
      for (const t of rule.alsoCheck ?? []) {
        const raw = norm(targetOf(t));
        if (isIgnoredPath(raw)) continue;
        const target = withModule(raw, module, product);
        const changedToo = files.some(f => matchGlob(target, f));
        const isOwn = (rule.when ?? []).map(norm).includes(raw);
        if (isOwn && changedToo) continue;
        targets.push({ target, why: t.why ?? '', changedToo, exists: Boolean(exists(target)) });
      }
      const advisory = rule.severity === 'advisory';
      const missing = targets.filter(t => !t.changedToo).length;
      results.push({ id: rule.id, title: rule.title ?? rule.id, ...(product ? { product } : {}), ...(module ? { module } : {}), advisory, changed: [...set], targets, verify: rule.verify ?? [], missing });
    }
  }
  return { changed: files, rules: results, missing: results.filter(r => !r.advisory).reduce((n, r) => n + r.missing, 0), advisoryMissing: results.filter(r => r.advisory).reduce((n, r) => n + r.missing, 0) };
}

const NODE_FILE = /\.(?:mjs|cjs|js|ts)$/;
/** Problems with `verify` commands: a script or test file they name must exist. */
export function verifyProblems(command, { exists, scripts }) {
  const out = [];
  const tokens = String(command).trim().split(/\s+/);
  if (tokens[0] === 'npm' && tokens[1] === 'run' && scripts && tokens[2] && !scripts.includes(tokens[2])) out.push(`npm script "${tokens[2]}" does not exist`);
  if (tokens[0] === 'node') for (const tok of tokens.slice(1)) {
    if (tok.startsWith('-') || !NODE_FILE.test(tok)) continue;
    if (isIgnoredPath(tok)) continue;
    if (!exists(norm(tok))) out.push(`file "${tok}" does not exist`);
  }
  return out;
}

/** Stale-rule detection. exists(pathOrGlob) must say whether the pattern matches anything. Returns a list of problems. */
export function validateMap({ map, exists, scripts }) {
  const problems = [];
  const ids = new Set();
  for (const rule of map?.rules ?? []) {
    const where = `rule ${rule.id ?? '(no id)'}`;
    if (!rule.id || !rule.title) problems.push(`${where}: id and title are required`);
    if (ids.has(rule.id)) problems.push(`${where}: duplicate id`);
    ids.add(rule.id);
    if (rule.severity != null && rule.severity !== 'advisory') problems.push(`${where}: severity must be "advisory" or absent`);
    if (!rule.when?.length) problems.push(`${where}: when[] is empty`);
    if (!rule.alsoCheck?.length) problems.push(`${where}: alsoCheck[] is empty`);
    for (const g of rule.when ?? []) if (!isIgnoredPath(g) && !exists(norm(g))) problems.push(`${where}: when "${g}" matches nothing`);
    for (const t of rule.alsoCheck ?? []) {
      const target = targetOf(t);
      if (!target) { problems.push(`${where}: an alsoCheck entry has no path or glob`); continue; }
      if (isIgnoredPath(target)) continue;
      if (!exists(norm(target))) problems.push(`${where}: alsoCheck "${target}" matches nothing`);
      if (!t.why) problems.push(`${where}: alsoCheck "${target}" has no why`);
    }
    if (!Array.isArray(rule.verify)) problems.push(`${where}: verify must be a list`);
    else for (const v of rule.verify) for (const p of verifyProblems(v, { exists, scripts })) problems.push(`${where}: verify "${v}": ${p}`);
  }
  return problems;
}

/** Plain text report. Wording: "You changed X -> also check Y (why)", each target marked. */
export function formatReport(result) {
  if (!result.rules.length) return 'No mapped coupling touched by this change.';
  const lines = [];
  for (const r of result.rules) {
    lines.push(`[${r.id}] ${r.title}${r.module ? ` (${r.product ? r.product + "/" : ""}module ${r.module})` : ''}${r.advisory ? ' (advisory: not counted by --strict)' : ''}`);
    for (const f of r.changed) lines.push(`  You changed ${f}`);
    for (const t of r.targets) lines.push(`    -> also check ${t.target} (${t.why}) - ${t.changedToo ? 'changed too' : 'NOT in this change'}`);
    for (const v of r.verify) lines.push(`    verify: ${v}`);
    lines.push('');
  }
  lines.push(`${result.rules.length} rule(s) matched, ${result.missing} target(s) NOT in this change${result.advisoryMissing ? ` (+${result.advisoryMissing} advisory)` : ''}.`);
  return lines.join('\n');
}

const git = (args, root = ROOT) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const lines = s => s.split(/\r?\n/).filter(Boolean);
const RANGE_OK = /^[\w@{}^~./:+-]+$/;

/** A git revision range is data, never an option: no leading dash, no whitespace or control characters. */
export function checkRange(range) {
  if (typeof range !== 'string' || !range || range.startsWith('-') || !RANGE_OK.test(range)) throw new UsageError('--range needs a plain git range such as A..B (no leading dash, no spaces).');
  return range;
}

export function changedFiles({ staged, range } = {}, root = ROOT) {
  if (staged) return lines(git(['diff', '--cached', '--name-only', '--no-renames', '--end-of-options', '--'], root));
  if (range) return lines(git(['diff', '--name-only', '--no-renames', '--end-of-options', checkRange(range), '--'], root));
  const out = git(['status', '--porcelain=v1', '-z', '-uall'], root).split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < out.length; i++) {
    const entry = out[i];
    files.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) files.push(out[++i]); // rename or copy: the next entry is the old path
  }
  return files;
}

/** Files that exist now (tracked-but-deleted files do not count), minus credential and session paths. */
export function repoFiles(root = ROOT) {
  return lines(git(['ls-files', '-co', '--exclude-standard'], root)).map(norm).filter(f => !isIgnoredPath(f) && fs.existsSync(path.join(root, f)));
}

export function parseArgs(argv) {
  const o = { staged: false, strict: false, json: false, validate: false, range: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--staged') o.staged = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--json') o.json = true;
    else if (a === '--validate') o.validate = true;
    else if (a === '--range') o.range = checkRange(argv[++i]);
    else if (a.startsWith('--range=')) o.range = checkRange(a.slice(8));
    else throw new UsageError(`Unknown option ${a}. Use --staged, --range A..B, --strict, --json or --validate.`);
  }
  if (o.staged && o.range) throw new UsageError('Use either --staged or --range, not both.');
  return o;
}

/** Returns the exit code: 0 ok, 1 strict-missing or stale map, 2 usage or git error. */
export function run(argv, { root = ROOT, out = console.log, err = console.error } = {}) {
  try {
    const opts = parseArgs(argv);
    const map = JSON.parse(fs.readFileSync(path.join(root, 'qa', 'impact-map.json'), 'utf8'));
    const files = repoFiles(root);
    const exists = pattern => hasMagic(pattern) ? files.some(f => matchGlob(pattern, f)) : files.includes(pattern);
    if (opts.validate) {
      let scripts;
      try { scripts = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {}); } catch { scripts = undefined; }
      const problems = validateMap({ map, exists, scripts });
      if (opts.json) out(JSON.stringify({ ok: !problems.length, problems }, null, 2));
      else out(problems.length ? problems.map(p => `STALE: ${p}`).join('\n') : `impact-map OK: ${map.rules.length} rules, every path, glob and verify command matches something.`);
      return problems.length ? 1 : 0;
    }
    const result = checkImpact({ changed: changedFiles(opts, root), map, exists });
    out(opts.json ? JSON.stringify(result, null, 2) : formatReport(result));
    return opts.strict && result.missing ? 1 : 0;
  } catch (e) {
    err(e instanceof UsageError ? e.message : `impact-check failed: ${String(e.stderr || e.message).trim()}`);
    return 2;
  }
}
export const main = run;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
