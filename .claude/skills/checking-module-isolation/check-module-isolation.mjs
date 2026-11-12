#!/usr/bin/env node
// Checks that each Test Studio module's code stays in its own folders and that shared code does not
// quietly depend on one module.
//
//   node .claude/skills/checking-module-isolation/check-module-isolation.mjs [--all]
//
// Module ids = folder names under tests/modules, qa/modules and portal/modules (folders starting with "_" are shared).
// A file is OWNED by module <id> when it is under tests/modules/<id>/, qa/modules/<id>/, portal/modules/<id>/,
// or is a qa/tools/ script whose file name contains <id>. Everything else scanned is SHARED:
// portal/** (except portal/modules/<id>/ and portal/test/), tests/** (except tests/modules/<id>/),
// playwright.config.ts and the other qa/tools/ scripts.
//
// ERROR  a module's file refers to ANOTHER module (path "modules/<other>" or string literal '<other>' / '/<other>').
// NEW    shared code refers to a module and is not in BASELINE below. Fix it, or add it to BASELINE with a reason.
// KNOWN  shared code refers to a module, recorded in BASELINE with the reason it is allowed (printed with --all).
// Exit code 1 when there is any ERROR or NEW finding. Comment lines are ignored.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const SKIP_DIRS = new Set(['node_modules', '.git', '.portal', 'test-results', 'playwright-report', 'tmp', 'output']);
const CODE = /\.(m?js|cjs|ts)$/;

// Allowed references from shared code to a module. Each entry: file, module id, a substring of the line, and why.
// Keep reasons factual and point at the file that documents the decision.
// "by design" = intended (do not copy for new modules unless the same reason applies); "issue" = should be fixed.
const BASELINE = [
  { file: 'portal/registry.mjs', id: 'registration', contains: "import './modules/registration/index.mjs'", reason: 'by design: built-in plugin import line (README.md "Adding a module" (b)); a new plugin adds one line like it' },
  { file: 'portal/store.mjs', id: 'registration', contains: "import './modules/registration/index.mjs'", reason: 'by design: registers the plugin seed hook before openStore runs (comment on the line)' },
  { file: 'portal/ai-generator.mjs', id: 'registration', contains: "import './modules/registration/index.mjs'", reason: 'by design: plugin import so AI generation sees the plugin when loaded on its own' },
  { file: 'portal/registry.mjs', id: 'registration', contains: "from './modules/registration/adapter.mjs'", reason: 'issue (low): shared registry re-exports Registration data (registrationData, registrationWorkflows, workbookAutomation); new modules must not add exports like this' },
  { file: 'portal/app/context.mjs', id: 'registration', contains: "'tests/modules/registration'", reason: 'by design: coding-agent reference folder fallback when no plugin sets agent.referenceDir (portal/agent.mjs:59)' },
  { file: 'portal/public/pages/pipeline.js', id: 'registration', contains: 'placeholder="/registration"', reason: 'by design: example text in the Module URL input' },
  { file: 'playwright.config.ts', id: 'registration', contains: "PORTAL_MODULE_ID === 'registration'", reason: 'by design: Registration-only reporter, skipped when the portal runs another module (comment on line 23)' },
  { file: 'qa/tools/install-module-adapter.mjs', id: 'registration', contains: "id === 'registration'", reason: 'by design: guard that refuses to overwrite the built-in module' },
  { file: 'tests/seed.spec.ts', id: 'registration', contains: "'/registration'", reason: 'issue (low): Registration-specific seed test for the Playwright agents sits in shared tests/' },
  { file: 'qa/tools/make-test-pdf.js', id: 'registration', contains: 'qa/modules/registration/data', reason: 'issue (low): generically named tool defaults its output into Registration data' },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (CODE.test(e.name)) out.push(p);
  }
  return out;
}
const subdirs = d => fs.existsSync(d)
  ? fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('_')).map(e => e.name)
  : [];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ids = [...new Set(['tests', 'qa', 'portal'].flatMap(k => subdirs(path.join(ROOT, k, 'modules'))))].sort();
const patterns = Object.fromEntries(ids.map(id => [id, [
  new RegExp(`modules/${esc(id)}(?![\\w-])`),            // path such as tests/modules/<id>/...
  new RegExp(`['"\`]/?${esc(id)}(?:['"\`/])`),           // literal '<id>', "<id>", '/<id>' or '/<id>/...'
  new RegExp(`['"\`](?:\\.\\.?/)+${esc(id)}/`),          // relative import from a sibling module: '../<id>/...'
]]));

function owner(file) {
  const r = rel(file);
  const m = r.match(/^(?:tests|qa|portal)\/modules\/([^/]+)\//);
  if (m && ids.includes(m[1])) return m[1];
  if (r.startsWith('qa/tools/')) return ids.find(id => path.basename(r).includes(id)) ?? null;
  return null;
}
const isScanned = file => {
  const r = rel(file);
  if (r.startsWith('portal/test/')) return false; // portal tests use Registration as their fixture on purpose
  return r === 'playwright.config.ts' || /^(portal|tests|qa\/tools)\//.test(r);
};

const files = [...walk(path.join(ROOT, 'portal')), ...walk(path.join(ROOT, 'tests')), ...walk(path.join(ROOT, 'qa', 'tools')),
  path.join(ROOT, 'playwright.config.ts')].filter(f => fs.existsSync(f) && isScanned(f));

const findings = [];
for (const file of files) {
  const own = owner(file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    for (const id of ids) {
      if (id === own || !patterns[id].some(re => re.test(line))) continue;
      const where = `${rel(file)}:${i + 1}`;
      const text = t.length > 160 ? `${t.slice(0, 157)}...` : t;
      if (own) { findings.push({ level: 'ERROR', where, id, text, why: `owned by module "${own}" but refers to module "${id}"` }); continue; }
      const known = BASELINE.find(b => b.file === rel(file) && b.id === id && line.includes(b.contains));
      findings.push(known ? { level: 'KNOWN', where, id, text, why: known.reason } : { level: 'NEW', where, id, text, why: `shared code refers to module "${id}"` });
    }
  });
}

const all = process.argv.includes('--all');
console.log(`Modules: ${ids.join(', ') || '(none)'}`);
for (const id of ids) {
  const has = p => fs.existsSync(path.join(ROOT, p));
  const parts = [
    has(`tests/modules/${id}`) && `tests/modules/${id}/`,
    has(`qa/modules/${id}`) && `qa/modules/${id}/`,
    has(`qa/modules/${id}/adapter.json`) && 'adapter.json',
    has(`portal/modules/${id}/index.mjs`) && `portal/modules/${id}/ (plugin)`,
  ].filter(Boolean);
  console.log(`  ${id}: ${parts.join(', ')}`);
}
console.log(`Scanned ${files.length} files.\n`);
for (const level of ['ERROR', 'NEW', ...(all ? ['KNOWN'] : [])]) {
  for (const f of findings.filter(x => x.level === level)) console.log(`${f.level.padEnd(5)} ${f.where}  [${f.id}] ${f.why}\n      ${f.text}`);
}
const count = l => findings.filter(f => f.level === l).length;
const stale = BASELINE.filter(b => !findings.some(f => f.level === 'KNOWN' && f.where.startsWith(`${b.file}:`) && f.id === b.id));
for (const b of stale) console.log(`STALE baseline entry (no longer found, remove it): ${b.file} [${b.id}] "${b.contains}"`);
console.log(`\n${count('ERROR')} ERROR, ${count('NEW')} NEW, ${count('KNOWN')} KNOWN${all ? '' : ' (use --all to list KNOWN)'}, ${stale.length} STALE`);
process.exit(count('ERROR') || count('NEW') ? 1 : 0);
