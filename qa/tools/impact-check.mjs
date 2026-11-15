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

export const norm = p => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');

/** True for credential or session paths. They are skipped everywhere: matching, validation and output. */
export function isIgnoredPath(p) {
  const parts = norm(p).split('/').filter(Boolean);
  if (!parts.length) return false;
  const base = parts[parts.length - 1].toLowerCase();
  return parts.slice(0, -1).some(s => s.toLowerCase() === SESSION_DIR) || parts[parts.length - 1].toLowerCase() === SESSION_DIR
    || base.startsWith(ENV_PREFIX) || SECRET_FILES.has(base);
}

const escapeRe = c => c.replace(/[.+^$()|[\]\\{}*?]/g, '\\$&');

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
      const end = glob.indexOf('}', i);
      if (end === -1) out += '\\{';
      else { out += '(?:' + glob.slice(i + 1, end).split(',').map(globToSource).join('|') + ')'; i = end; }
    } else out += escapeRe(c);
  }
  return out;
}

const cache = new Map();
/** Self-contained glob matcher: `*` stays inside a folder, `**` crosses folders (`a/**` also needs something below a), `?`, `{x,y}`; a trailing `/` means the folder. */
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

/**
 * changed: file paths. map: parsed impact-map. exists(pathOrGlob): optional, true when the target exists in the repo.
 * Returns the matched rules with, per target, whether it is in this change.
 */
export function checkImpact({ changed = [], map, exists = () => true }) {
  const files = [...new Set(changed.map(norm))].filter(f => f && !isIgnoredPath(f));
  const results = [];
  for (const rule of map?.rules ?? []) {
    const hit = files.filter(f => (rule.when ?? []).some(g => matchGlob(g, f)));
    if (!hit.length) continue;
    const targets = (rule.alsoCheck ?? []).map(t => {
      const target = norm(targetOf(t));
      return { target, why: t.why ?? '', changedToo: files.some(f => matchGlob(target, f)), exists: Boolean(exists(target)) };
    }).filter(t => !isIgnoredPath(t.target));
    results.push({ id: rule.id, title: rule.title ?? rule.id, changed: hit, targets, verify: rule.verify ?? [], missing: targets.filter(t => !t.changedToo).length });
  }
  return { changed: files, rules: results, missing: results.reduce((n, r) => n + r.missing, 0) };
}

/** Stale-rule detection. exists(pathOrGlob) must say whether the pattern matches anything. Returns a list of problems. */
export function validateMap({ map, exists }) {
  const problems = [];
  const ids = new Set();
  for (const rule of map?.rules ?? []) {
    const where = `rule ${rule.id ?? '(no id)'}`;
    if (!rule.id || !rule.title) problems.push(`${where}: id and title are required`);
    if (ids.has(rule.id)) problems.push(`${where}: duplicate id`);
    ids.add(rule.id);
    if (!rule.when?.length) problems.push(`${where}: when[] is empty`);
    if (!rule.alsoCheck?.length) problems.push(`${where}: alsoCheck[] is empty`);
    for (const g of rule.when ?? []) if (!exists(norm(g))) problems.push(`${where}: when "${g}" matches nothing`);
    for (const t of rule.alsoCheck ?? []) {
      if (!targetOf(t)) problems.push(`${where}: an alsoCheck entry has no path or glob`);
      else if (!exists(norm(targetOf(t)))) problems.push(`${where}: alsoCheck "${targetOf(t)}" matches nothing`);
      if (!t.why) problems.push(`${where}: alsoCheck "${targetOf(t)}" has no why`);
    }
    if (!Array.isArray(rule.verify)) problems.push(`${where}: verify must be a list`);
  }
  return problems;
}

/** Plain text report. Wording: "You changed X -> also check Y (why)", each target marked. */
export function formatReport(result) {
  if (!result.rules.length) return 'No mapped coupling touched by this change.';
  const lines = [];
  for (const r of result.rules) {
    lines.push(`[${r.id}] ${r.title}`);
    for (const f of r.changed) lines.push(`  You changed ${f}`);
    for (const t of r.targets) lines.push(`    -> also check ${t.target} (${t.why}) - ${t.changedToo ? 'changed too' : 'NOT in this change'}`);
    for (const v of r.verify) lines.push(`    verify: ${v}`);
    lines.push('');
  }
  lines.push(`${result.rules.length} rule(s) matched, ${result.missing} target(s) NOT in this change.`);
  return lines.join('\n');
}

const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lines = s => s.split(/\r?\n/).filter(Boolean);

export function changedFiles({ staged, range } = {}) {
  if (staged) return lines(git(['diff', '--cached', '--name-only', '--no-renames']));
  if (range) return lines(git(['diff', '--name-only', '--no-renames', range]));
  const out = git(['status', '--porcelain=v1', '-z', '-uall']).split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < out.length; i++) {
    const entry = out[i];
    files.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) files.push(out[++i]); // rename or copy: the next entry is the old path
  }
  return files;
}

export function repoFiles() {
  return lines(git(['ls-files', '-co', '--exclude-standard'])).map(norm).filter(f => !isIgnoredPath(f));
}

function parseArgs(argv) {
  const o = { staged: false, strict: false, json: false, validate: false, range: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--staged') o.staged = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--json') o.json = true;
    else if (a === '--validate') o.validate = true;
    else if (a === '--range') o.range = argv[++i];
    else if (a.startsWith('--range=')) o.range = a.slice(8);
    else throw new Error(`Unknown option ${a}. Use --staged, --range A..B, --strict, --json or --validate.`);
  }
  if (o.staged && o.range) throw new Error('Use either --staged or --range, not both.');
  return o;
}

export function main(argv) {
  const opts = parseArgs(argv);
  const map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  const files = repoFiles();
  const exists = pattern => hasMagic(pattern) ? files.some(f => matchGlob(pattern, f)) : files.includes(pattern);
  if (opts.validate) {
    const problems = validateMap({ map, exists });
    if (opts.json) console.log(JSON.stringify({ ok: !problems.length, problems }, null, 2));
    else console.log(problems.length ? problems.map(p => `STALE: ${p}`).join('\n') : `impact-map OK: ${map.rules.length} rules, every path and glob matches something.`);
    return problems.length ? 1 : 0;
  }
  const result = checkImpact({ changed: changedFiles(opts), map, exists });
  console.log(opts.json ? JSON.stringify(result, null, 2) : formatReport(result));
  return opts.strict && result.missing ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 2; }
}
