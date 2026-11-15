import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Task 4 of the product-scoped layout plan: the old flat folders (qa/modules/<id>, tests/modules/<id>, portal/modules/<id>) are gone,
// and no code, test, tool, script, skill or persisted data may refer to them or build such a path by hand. Module paths come from the
// layout resolver (tests/shared/module-layout.mjs) or are written in the product-scoped form qa/<product>/<module>.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FORBIDDEN = [
  { name: 'qa/modules', re: /(?<![\w./-])qa\/modules(?![\w-])/ },
  { name: 'tests/modules', re: /(?<![\w./-])tests\/modules(?![\w-])/ },
  { name: 'escaped qa/modules', re: /(?<![\w./-])qa\\\/modules(?![\w-])/ },
  { name: 'escaped tests/modules', re: /(?<![\w./-])tests\\\/modules(?![\w-])/ },
  { name: 'flat portal/modules/registration', re: /portal\/modules\/registration(?![\w-])/ },
  { name: "path join of 'qa'/'tests' with 'modules'", re: /\b(?:qa|tests)['"`]\s*,\s*['"`]modules['"`]/ },
  { name: 'windows-style qa\\modules', re: /(?<![\w.-])(?:qa|tests)\\{1,2}modules(?![\w-])/ },
];

// Files that may mention the old layout, each with the reason. Every entry must still contain a match (checked below), so the list cannot rot.
const ALLOWED = {
  'portal/test/layout-guard.test.mjs': 'this guard (patterns and fixtures)',
  'portal/test/layout-compat.test.mjs': 'tests the one legacy ID-proof compatibility mapping',
  'portal/modules/augastam/registration/validate.mjs': 'the one legacy ID-proof compatibility mapping (LEGACY_ID_PROOF_FIXTURE)',
  'portal/test/product-layout.test.mjs': 'asserts the old flat layout is no longer resolved',
  'portal/test/product-layout-tools.test.mjs': 'asserts the old flat layout is no longer resolved or hashed',
  'portal/test/product-portal.test.mjs': 'asserts the agent brief no longer names the old layout',
  'tests/shared/module-layout.mjs': 'comment explaining that the old flat layout is no longer resolved',
};

const SKIP_DIRS = new Set(['node_modules', '.git', '.portal', 'test-results', 'playwright-report', 'results', 'tmp', 'output']);
const TEXT = /\.(m?js|cjs|ts|mts|json|md)$/;
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (TEXT.test(e.name)) out.push(p);
  }
  return out;
}
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

/** Forbidden-pattern hits in `text`: [{ line, name }]. */
function scanText(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => { for (const f of FORBIDDEN) if (f.re.test(line)) hits.push({ line: i + 1, name: f.name }); });
  return hits;
}

// Runtime code, tests, qa/tools, package.json, the playwright config, persisted portal data, case files, and the skills and agents.
function scannedFiles() {
  const roots = ['portal', 'tests', 'qa/tools', '.claude/skills', '.claude/agents', 'portal-data'].map(d => path.join(ROOT, d));
  const files = roots.flatMap(r => walk(r));
  for (const f of ['package.json', 'playwright.config.ts', 'tsconfig.json', '.gitignore', '.dockerignore']) if (fs.existsSync(path.join(ROOT, f))) files.push(path.join(ROOT, f));
  for (const product of fs.readdirSync(path.join(ROOT, 'qa'), { withFileTypes: true })) {
    if (!product.isDirectory() || ['knowledge', 'tools'].includes(product.name)) continue;
    for (const m of fs.readdirSync(path.join(ROOT, 'qa', product.name), { withFileTypes: true })) if (m.isDirectory()) files.push(...walk(path.join(ROOT, 'qa', product.name, m.name, 'cases')));
  }
  return files;
}

test('the old flat folders do not exist', () => {
  for (const d of ['qa/modules', 'tests/modules', 'portal/modules/registration']) assert.ok(!fs.existsSync(path.join(ROOT, d)), `${d} must not exist; module folders are product-scoped`);
  for (const d of ['qa/augastam/registration', 'tests/augastam/registration', 'portal/modules/augastam/registration']) assert.ok(fs.existsSync(path.join(ROOT, d)), `${d} must exist`);
});

test('no runtime code, test, tool, script, case file, persisted data or skill refers to the old flat layout', () => {
  const bad = [];
  for (const file of scannedFiles()) {
    const r = rel(file);
    if (Object.hasOwn(ALLOWED, r)) continue;
    for (const h of scanText(fs.readFileSync(file, 'utf8'))) bad.push(`${r}:${h.line} (${h.name})`);
  }
  assert.deepEqual(bad, [], `Old module paths found. Use the layout resolver or qa/<product>/<module>:\n${bad.join('\n')}`);
});

test('every allowlist entry still needs its exemption', () => {
  for (const [file, why] of Object.entries(ALLOWED)) {
    const full = path.join(ROOT, file);
    assert.ok(fs.existsSync(full), `${file} (${why}) no longer exists; remove it from the allowlist`);
    assert.ok(scanText(fs.readFileSync(full, 'utf8')).length > 0, `${file} (${why}) no longer mentions the old layout; remove it from the allowlist`);
  }
});

test('the scanner flags each forbidden form and accepts the product-scoped forms', () => {
  const bad = [
    'const a = "qa/modules/registration/cases"', 'x(`tests/modules/${id}/cases.spec.ts`)', "path.join(root, 'qa', 'modules', id)",
    'path.join(root, "tests","modules", id)', 'import "../portal/modules/registration/index.mjs"', 'spec: "tests/modules/billing/cases.spec.ts"',
    String.raw`new RegExp('tests\/modules')`, String.raw`'qa\modules\x'`,
  ];
  for (const line of bad) assert.ok(scanText(line).length > 0, line);
  const good = [
    'qa/augastam/registration/cases', 'tests/miracle/registration/cases.spec.ts', 'portal/modules/augastam/registration/index.mjs', 'portal/modules/contract.mjs',
    'qa/knowledge/modules/registration.md', "path.join(root, 'qa', 'knowledge', 'modules', 'x.md')", '`#/modules/${m.id}/review`', "api('/api/modules/registration/cases')",
    "resolveModuleFolder(ROOT, 'qa', 'augastam', 'registration')",
  ];
  for (const line of good) assert.deepEqual(scanText(line), [], line);
});

test('check-module-isolation reports a product folder that refers to another product (and stays quiet otherwise)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-products-'));
  try {
    const put = (r, text) => { const f = path.join(root, ...r.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
    put('qa/augastam/alpha/adapter.json', '{}'); put('qa/miracle/beta/adapter.json', '{}');
    put('tests/augastam/alpha/a.ts', "export const ok = 'tests/augastam/alpha/cases.spec.ts';\n");
    put('tests/miracle/beta/b.ts', 'export const ok = 1;\n');
    const run = () => spawnSync(process.execPath, [path.join(ROOT, '.claude/skills/checking-module-isolation/check-module-isolation.mjs'), '--root', root], { encoding: 'utf8' });
    const clean = run(); assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    put('tests/miracle/beta/b.ts', "import x from '../../../qa/augastam/alpha/data.json';\n");
    const dirty = run(); assert.equal(dirty.status, 1, dirty.stdout);
    assert.match(dirty.stdout, /product "miracle" refers to the folders of product "augastam"/);
    put('tests/miracle/beta/b.ts', "const f = moduleFolder('qa', 'augastam', 'alpha');\n");
    assert.equal(run().status, 1);
    put('tests/miracle/beta/b.ts', "const f = moduleFolder('qa', 'miracle', 'beta');\n");
    assert.equal(run().status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
