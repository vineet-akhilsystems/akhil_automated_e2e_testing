#!/usr/bin/env node
// Installs a REVIEWED automation proposal (from the Test Studio coding agent) into the repo:
//   output/automation/{fields.ts,<id>.page.ts,case-runner.ts,cases.spec.ts,NOTES.md} -> tests/modules/<id>/
//   output/automation/adapter.json                                                    -> qa/modules/<id>/adapter.json
// then runs `npx tsc --noEmit` and `npm run portal:check`.
//
// Usage:
//   node qa/tools/install-module-adapter.mjs --module <id> --job <jobId> [--data-dir .portal] [--dry-run] [--yes] [--force] [--show]
//   node qa/tools/install-module-adapter.mjs --module <id> --from <dir>  [--dry-run] [--yes] [--force] [--show]
// Never installs "registration" (not even with --force). File hashes and a preview are always printed; --show prints full files.
//
// It never edits .portal/portal.sqlite, .env or .auth. Connecting the module to the adapter is a separate,
// deliberate step (printed at the end).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { adapters, validateAdapterDefinition, loadModuleAdapters } from '../../portal/registry.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ID_RE = /^[a-z][a-z0-9-]*$/; // identical to the registry's adapter id rule
const MAX_ID = 60;
const JOB_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_FILE_BYTES = 400_000;
const ADAPTER_KEYS = new Set(['id', 'name', 'spec', 'prefix', 'actions', 'outcomes', 'variants', 'fields', 'bases', 'variantLabel', 'targetLabel', 'targetPlaceholder']);
const SAFE_KEY = /^[A-Za-z_][\w-]{0,63}$/;

export class InstallError extends Error {}
const fail = msg => { throw new InstallError(msg); };

export function expectedFiles(id) {
  return { required: ['fields.ts', `${id}.page.ts`, 'case-runner.ts', 'cases.spec.ts', 'adapter.json'], optional: ['NOTES.md'] };
}

// The proposal is AI-written from untrusted uploads, so treat it as hostile. This is an allow-list plus a tripwire
// for a human-reviewed proposal; it is not a sandbox and does not replace reading the files.
const ENV_ALLOWED = name => ['BASE_URL', 'CASES_FILE', 'CASES'].includes(name) || /^PORTAL_[A-Z0-9_]+$/.test(name);
const NAME_RE = /^[a-z][a-z0-9-]*$/;

// Secrets only (also run on NOTES.md and adapter.json).
const SECRET_NAME = String.raw`[\w$-]*(?:pass(?:word|wd|phrase|code)|pwd|pw|secret|token|api[_-]?key|credential|authorization|bearer)[\w$-]*`;
const SECRET_PATTERNS = [
  [new RegExp(String.raw`(?<![\w$])['"\`]?${SECRET_NAME}['"\`]?\s*(?::\s*[\w<>\[\]| .]+)?\s*[:=]\s*(['"\`])(?!\1)(?![^'"\`\n]*(?:process\.env|\$\{))[^\n]*?\1`, 'i'), 'contains a hard-coded credential (password/secret/token assigned a string literal)'],
  [/Bearer\s+[A-Za-z0-9._~+/-]{12,}/, 'contains a hard-coded bearer token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b/, 'contains what looks like a private key or API key'],
];

// Returns the text between the parentheses opened at `open` (index of "("), or null when unbalanced.
function callArgs(text, open) {
  let depth = 0, quote = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

function importAllowed(spec, id) {
  const s = spec.replace(/\.ts$/, '');
  if (['@playwright/test', 'node:path', 'path', './fields', `./${id}.page`, './case-runner'].includes(s)) return true;
  return /^\.\.\/\.\.\/fixtures\/[\w-]+(?:\/[\w-]+)*$/.test(s);
}

export function scanSecrets(name, text) {
  return SECRET_PATTERNS.filter(([re]) => re.test(text)).map(([, why]) => `${name} ${why}`);
}

export function scanCode(name, text, id = '') {
  const out = [], add = why => { if (!out.includes(`${name} ${why}`)) out.push(`${name} ${why}`); };
  if (/\.ts$/.test(name)) {
    // imports: static, export-from, side-effect, require and dynamic
    for (const m of text.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'"`;()]*?\sfrom\s*)?(['"`])([^'"`\n]*)\1/g)) if (!importAllowed(m[2], id)) add(`imports "${m[2]}", which is not on the allow-list (@playwright/test, ../../fixtures/*, ./fields, ./${id || '<id>'}.page, ./case-runner, node:path)`);
    for (const m of text.matchAll(/\brequire\s*\(/g)) {
      const arg = callArgs(text, m.index + m[0].length - 1).trim(), lit = /^(['"])([^'"`\n]*)\1$/.exec(arg);
      if (!lit) add('calls require() with a non-literal argument');
      else if (!importAllowed(lit[2], id)) add(`requires "${lit[2]}", which is not on the allow-list`);
    }
    if (/\bimport\s*\(/.test(text)) add('uses a dynamic import()');
    if (/\bimport\s+\w+\s*=\s*require\b/.test(text) && !/\brequire\s*\(\s*['"]/.test(text)) add('uses import = require');
    if (/child_process/.test(text)) add('uses child_process');
    if (/\beval\s*\(/.test(text)) add('uses eval');
    if (/\bFunction\s*\(|\bconstructor\s*\[|\.\s*constructor\s*\(\s*['"`]/.test(text)) add('uses the Function constructor');
    if (/\bglobalThis\b|\b(?:window|self|global|process|require|module)\s*\[/.test(text)) add('uses globalThis or string-built global/window/process access');
    if (/\bprocess\s*\.\s*(?:exit|abort|kill|binding|mainModule|dlopen|chdir|_linkedBinding)\b/.test(text)) add('uses process.exit/kill/binding or similar');
    // file system writes (fs itself is not importable, but a handle could arrive via another route)
    if (/\b(?:writeFile|appendFile|createWriteStream|mkdir|rmdir|unlink|copyFile|truncate|symlink|chmod|chown|utimes)\w*\s*\(|\b(?:rmSync|cpSync|renameSync|openSync)\s*\(|\bfs\w*\s*\.\s*(?:promises\s*\.\s*)?(?:rm|cp|rename|open)\s*\(/.test(text)) add('uses a file-system write API');
    // string building inside call arguments that decide where code or traffic goes
    for (const m of text.matchAll(/\b(?:require|import|goto|fetch|request|waitForURL|route|WebSocket)\s*\(/g)) {
      const arg = callArgs(text, m.index + m[0].length - 1);
      if (/['"`]\s*\+|\+\s*['"`]|\bconcat\s*\(/.test(arg)) add(`builds a string by concatenation inside ${m[0].replace(/\s*\($/, '')}() arguments`);
    }
    // hard-coded hosts (comments are ignored for this one rule)
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');
    if (/https?:\/\//i.test(code) || /\bh\s*t\s*t\s*p\s*s?\s*['"`]\s*\+/i.test(code)) add('contains a hard-coded http(s) URL (use BASE_URL from the environment)');
    if (/\bnew\s+XMLHttpRequest\b|\bhttps?\.request\s*\(|\b(?:axios|got)\b/.test(code)) add('makes raw network requests (use Playwright)');
    // protected paths
    if (/(?<![\w$)\]])\.(?:auth|env|claude|portal)\b|portal\.sqlite|\blogin\.txt\b/.test(text)) add('references a protected path (.auth, .env, .claude, .portal)');
    // environment: allow-list only
    for (const m of text.matchAll(/\bprocess\s*\.\s*env\s*\.\s*(\w+)/g)) if (!ENV_ALLOWED(m[1])) add(`reads process.env.${m[1]} (allowed: BASE_URL, CASES_FILE, CASES, PORTAL_*)`);
    for (const m of text.matchAll(/\bprocess\s*\.\s*env\s*\[\s*(['"`])([^'"`]*)\1\s*\]/g)) if (!ENV_ALLOWED(m[2])) add(`reads process.env["${m[2]}"] (allowed: BASE_URL, CASES_FILE, CASES, PORTAL_*)`);
    if (/\bprocess\s*\.\s*env\b(?!\s*\.\s*\w|\s*\[\s*(['"`])[^'"`]*\1\s*\])/.test(text)) add('uses process.env as a whole or with a computed key');
  }
  out.push(...scanSecrets(name, text));
  return out;
}

export function validateAdapter(id, raw) {
  let a; try { a = JSON.parse(raw); } catch { fail('adapter.json is not valid JSON.'); }
  if (!a || typeof a !== 'object' || Array.isArray(a)) fail('adapter.json must be a JSON object.');
  for (const k of Object.keys(a)) if (!ADAPTER_KEYS.has(k)) fail(`adapter.json has an unsupported key "${k}" (commands and scripts cannot be declared here).`);
  if (a.id !== id) fail(`adapter.json id must be "${id}".`);
  if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 120) fail('adapter.json needs a name.');
  if (a.spec !== `tests/modules/${id}/cases.spec.ts`) fail(`adapter.json spec must be exactly "tests/modules/${id}/cases.spec.ts".`);
  if (a.prefix !== undefined && !(typeof a.prefix === 'string' && /^[A-Za-z][A-Za-z0-9]{0,11}$/.test(a.prefix))) fail('adapter.json prefix must be 1-12 letters/digits.');
  const obj = (v, n) => { if (!v || typeof v !== 'object' || Array.isArray(v) || !Object.keys(v).length) fail(`adapter.json ${n} must be a non-empty object.`); return v; };
  const actions = obj(a.actions, 'actions'), fields = obj(a.fields, 'fields');
  for (const [k, v] of Object.entries(actions)) if (!SAFE_KEY.test(k) || typeof v !== 'string') fail(`adapter.json action "${k}" must map a simple key to a text label.`);
  for (const [k, v] of Object.entries(fields)) if (!SAFE_KEY.test(k) || !v || typeof v !== 'object' || typeof v.label !== 'string') fail(`adapter.json field "${k}" needs a label.`);
  if (!Array.isArray(a.outcomes) || !a.outcomes.length || !a.outcomes.every(o => typeof o === 'string' && SAFE_KEY.test(o))) fail('adapter.json outcomes must be a list of simple names.');
  if (!Array.isArray(a.variants) || !a.variants.every(o => typeof o === 'string' && o.length <= 120)) fail('adapter.json variants must be a list of text.');
  if (a.bases !== undefined) {
    obj(a.bases, 'bases');
    for (const [name, base] of Object.entries(a.bases)) {
      if (!SAFE_KEY.test(name) || !base || typeof base !== 'object') fail(`adapter.json base "${name}" must be an object.`);
      for (const k of Object.keys(base)) if (!Object.hasOwn(fields, k)) fail(`adapter.json base "${name}" uses unknown field "${k}".`);
    }
  }
  return a;
}

// Runs the registry's own validator against a temp root that holds the staged spec, so nothing is written to the repo
// before the registry is known to accept the adapter.
export function registryValidate(id, adapter, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-adapter-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tests', 'modules', id), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'tests', 'modules', id, 'cases.spec.ts'), files['cases.spec.ts'] ?? '');
    try { return validateAdapterDefinition(adapter, { root: tmp, dirId: id }); } catch (e) { fail(`The registry would reject adapter.json: ${e.message}`); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export function contentHash(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

// Reads the proposal folder defensively. Returns { name -> text }.
export function readProposal(dir, id) {
  const { required, optional } = expectedFiles(id), allowed = new Set([...required, ...optional]);
  let st; try { st = fs.lstatSync(dir); } catch { fail(`Proposal folder not found: ${dir}`); }
  if (st.isSymbolicLink() || !st.isDirectory()) fail('The proposal folder must be a real directory (not a symlink).');
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!allowed.has(e.name)) fail(`Unexpected entry "${e.name}" in the proposal. Allowed files: ${[...allowed].join(', ')}.`);
    const full = path.join(dir, e.name), s = fs.lstatSync(full);
    if (s.isSymbolicLink() || !s.isFile()) fail(`"${e.name}" must be a regular file (symlinks and folders are rejected).`);
    if (s.size > MAX_FILE_BYTES) fail(`"${e.name}" is too large.`);
    out[e.name] = fs.readFileSync(full, 'utf8');
  }
  for (const n of required) if (!(n in out)) fail(`Missing required file: ${n}.`);
  return out;
}

export function planInstall({ root, id, files, force }) {
  const testsDir = path.join(root, 'tests', 'modules', id), adapterTarget = path.join(root, 'qa', 'modules', id, 'adapter.json');
  const plan = Object.keys(files).map(n => ({ name: n, to: n === 'adapter.json' ? adapterTarget : path.join(testsDir, n) }));
  for (const p of plan) {
    const rel = path.relative(root, p.to);
    if (rel.startsWith('..') || path.isAbsolute(rel)) fail(`Refusing to write outside the repository: ${p.to}`);
    p.exists = fs.existsSync(p.to);
  }
  const clash = plan.filter(p => p.exists);
  if (clash.length && !force) fail(`Refusing to overwrite existing files (use --force after reviewing): ${clash.map(p => path.relative(root, p.to).split(path.sep).join('/')).join(', ')}`);
  return plan;
}

function defaultRun(command, args, cwd) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, timeout: 10 * 60_000 });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

export function parseArgs(argv) {
  const o = { dataDir: '.portal', dryRun: false, yes: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i] ?? fail(`${a} needs a value.`);
    if (a === '--module') o.module = next(); else if (a === '--job') o.job = next(); else if (a === '--data-dir') o.dataDir = next(); else if (a === '--from') o.from = next();
    else if (a === '--dry-run') o.dryRun = true; else if (a === '--yes') o.yes = true; else if (a === '--force') o.force = true; else if (a === '--show') o.show = true;
    else fail(`Unknown argument: ${a}`);
  }
  return o;
}

export async function install(argv, { root = ROOT, run = defaultRun, log = console.log, confirm } = {}) {
  const o = parseArgs(argv);
  if (!o.module || !ID_RE.test(o.module) || o.module.length > MAX_ID) fail('--module is required and must match /^[a-z][a-z0-9-]*$/ (max 60 characters).');
  if (!!o.job === !!o.from) fail('Provide exactly one of --job <jobId> or --from <dir>.');
  const id = o.module;
  if (id === 'registration') fail('The Registration module is built in and cannot be installed or overwritten by this tool (not even with --force).');
  if (!o.force && (Object.hasOwn(adapters, id) || fs.existsSync(path.join(root, 'tests', 'modules', id)))) fail(`Module "${id}" already has an automation adapter or a tests/modules/${id} folder. Refusing to overwrite it (use --force only after reviewing, never for registration).`);
  let source;
  if (o.job) {
    if (!JOB_RE.test(o.job)) fail('--job has an invalid format.');
    source = path.join(path.resolve(root, o.dataDir), 'agent', o.job, 'output', 'automation');
  } else source = path.resolve(root, o.from);

  const files = readProposal(source, id);
  const problems = [];
  const adapter = validateAdapter(id, files['adapter.json']);
  registryValidate(id, JSON.parse(files['adapter.json']), files);
  for (const [n, text] of Object.entries(files)) problems.push(...scanCode(n, text, id));
  if (problems.length) fail(`The proposal was rejected:\n  - ${problems.join('\n  - ')}`);
  const plan = planInstall({ root, id, files, force: o.force });

  log(`Module "${id}" (${adapter.name}) proposal from ${source}`);
  // Always show what is about to be installed (also with --yes): hash plus a preview, or the full text with --show.
  for (const p of plan) {
    const text = files[p.name], lines = text.split(/\r?\n/), full = o.show || lines.length <= 40;
    log(`--- ${p.name}  sha256:${contentHash(text)}  (${lines.length} lines)`);
    log((full ? lines : lines.slice(0, 40)).map(l => `+ ${l}`).join('\n'));
    if (!full) log(`+ ... ${lines.length - 40} more line(s); re-run with --show to print everything`);
  }
  log(`Actions: ${Object.keys(adapter.actions).join(', ')} | outcomes: ${adapter.outcomes.length} | variants: ${adapter.variants.length} | fields: ${Object.keys(adapter.fields).length}`);
  for (const p of plan) log(`  ${p.exists ? 'OVERWRITE' : 'create   '} ${path.relative(root, p.to).split(path.sep).join('/')}`);
  const summary = { module: id, source, files: plan.map(p => path.relative(root, p.to).split(path.sep).join('/')), installed: false, checks: [] };
  if (o.dryRun) { log('Dry run: nothing was written and no checks were run.'); return summary; }

  if (!o.yes) {
    const ok = confirm ? await confirm('Install these files?') : await (async () => {
      if (!process.stdin.isTTY) fail('Not an interactive terminal. Re-run with --yes to confirm, or --dry-run to preview.');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try { return /^y(es)?$/i.test((await rl.question('Install these files? [y/N] ')).trim()); } finally { rl.close(); }
    })();
    if (!ok) { log('Cancelled. Nothing was written.'); return summary; }
  }

  for (const p of plan) { fs.mkdirSync(path.dirname(p.to), { recursive: true }); fs.writeFileSync(p.to, files[p.name]); }
  summary.installed = true;
  log(`Installed ${plan.length} file(s).`);

  // The registry must actually load the installed adapter; it skips (with a warning) anything it rejects.
  const warnings = [];
  const loaded = loadModuleAdapters({ root, warn: m => warnings.push(m) });
  const registryOk = Object.hasOwn(loaded, id);
  if (!registryOk) log(`FAILED: the portal registry skipped the installed adapter for "${id}".\n${warnings.join('\n') || '(no warning was reported)'}`);
  else log(`ok: the registry loads adapter "${id}"`);
  summary.registryLoaded = registryOk;
  if (registryOk) for (const [label, command, args] of [['npx tsc --noEmit', 'npx', ['tsc', '--noEmit']], ['npm run portal:check', 'npm', ['run', 'portal:check']]]) {
    log(`Running ${label} ...`);
    const r = run(command, args, root);
    summary.checks.push({ label, ok: r.code === 0 });
    if (r.code !== 0) { log(`FAILED: ${label} (exit ${r.code})\n${r.output.slice(-2000)}`); break; }
    log(`ok: ${label}`);
  }
  const ok = registryOk && summary.checks.length === 2 && summary.checks.every(c => c.ok);
  summary.ok = ok;
  log(ok ? 'Checks passed.' : 'Checks FAILED. The files were installed and left in place so you can fix them; review the errors above.');
  log([
    '', 'Next steps (not done automatically):',
    `  1. Review tests/modules/${id}/ and NOTES.md, and fill in any TODO locators.`,
    `  2. Restart the portal FIRST: adapters (qa/modules/${id}/adapter.json) are loaded only at startup.`,
    '  3. Then connect the module to the adapter in the portal (module settings / registry).',
    '     This tool does not edit .portal/portal.sqlite, the env file or the saved login session.',
    '  4. Run one controlled smoke case before enabling the full suite.',
  ].join('\n'));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  install(process.argv.slice(2)).then(s => { if (s.installed && s.ok === false) process.exitCode = 1; }, e => {
    console.error(e instanceof InstallError ? `Error: ${e.message}` : e); process.exitCode = 1;
  });
}
