import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Task 4 of the product-scoped layout plan: the old flat folders (qa/modules/<id>, tests/modules/<id>, portal/modules/<id>) are gone,
// and no code, test, tool, script, skill, data or case file may refer to them or build a module path by hand. Module paths come from the
// layout resolver (tests/shared/module-layout.mjs) or are written in the product-scoped form qa/<product>/<module>.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 1. The old flat layout, in any spelling. The lookbehind only excludes word characters and hyphens, so "${ROOT}/qa/modules", "../../qa/modules"
//    and "./qa/modules" are all caught.
const FLAT = [
  { name: 'qa/modules', re: /(?<![\w-])qa\/modules(?![\w-])/ },
  { name: 'tests/modules', re: /(?<![\w-])tests\/modules(?![\w-])/ },
  { name: 'escaped qa/modules', re: /(?<![\w-])qa\\\/modules(?![\w-])/ },
  { name: 'escaped tests/modules', re: /(?<![\w-])tests\\\/modules(?![\w-])/ },
  { name: 'flat portal/modules/registration', re: /portal\/modules\/registration(?![\w-])/ },
  { name: "path join of 'qa'/'tests' with 'modules'", re: /\b(?:qa|tests)['"`]\s*,\s*['"`]modules['"`]/ },
  { name: 'windows-style qa\\modules', re: /(?<![\w-])(?:qa|tests)\\{1,2}modules(?![\w-])/ },
  { name: "flat plugin path built from an id: join('portal', 'modules', id)", re: /['"`]portal['"`]\s*,\s*['"`]modules['"`]\s*,\s*(?!['"`](?:augastam|miracle)['"`])[\w'"`]/ },
  { name: 'flat plugin path built from an id: portal/modules/${id}', re: /portal\/modules\/\$\{[^}]*\}(?!\/\$\{)/ },
];
// 2. Hand-built module paths outside the resolver (not applied to portal/test, which builds temp fixture trees on purpose).
const SHARED_NAMES = 'knowledge|tools|shared|fixtures|discovery|smoke|impact-map\\.json';
const RESOLVER_CALL = /\b(?:resolveModuleFolder|moduleDir|moduleFolder|productFolder)\([^()]*(?:\([^()]*\)[^()]*)*\)/g;
const HANDBUILT = [
  { name: 'template path qa|tests|portal/modules/${...}', re: /`[^`]*(?<![\w-])(?:qa|tests|portal\/modules)\/\$\{/ },
  { name: "path.join/resolve of 'qa'|'tests' with a non-shared next part", re: new RegExp('(?:join|resolve)\\([^)]*[\'"`](?:qa|tests)[\'"`]\\s*,\\s*(?![\'"`](?:' + SHARED_NAMES + ')[\'"`])[\\w\'"`]') },
  { name: "string concatenation 'qa/' + ...", re: /['"`](?:qa|tests|portal\/modules)\/['"`]\s*\+/ },
];

// Files and lines that may mention the old layout or build a path, each with the reason. Every entry must still match something (checked
// below), so the list cannot rot. `contains` narrows an exemption to the lines that hold that text; without it the whole file is exempt.
const ALLOWED = [
  { file: 'portal/test/layout-guard.test.mjs', reason: 'this guard (patterns and fixtures)' },
  { file: 'portal/test/layout-compat.test.mjs', reason: 'tests the one legacy ID-proof compatibility mapping' },
  { file: 'portal/test/layout-snapshot-compat.test.mjs', reason: 'imports a snapshot with the old ID-proof path' },
  { file: 'portal/modules/augastam/registration/validate.mjs', contains: "LEGACY_ID_PROOF_FIXTURE = 'qa/modules/registration/data/agent-test-id-proof.pdf'", reason: 'the one legacy ID-proof compatibility mapping' },
  { file: 'portal/test/product-layout.test.mjs', reason: 'asserts the old flat layout is no longer resolved' },
  { file: 'portal/test/product-layout-tools.test.mjs', reason: 'asserts the old flat layout is no longer resolved or hashed' },
  { file: 'portal/test/product-portal.test.mjs', contains: "tests/modules/", reason: 'asserts the agent brief no longer names the old layout' },
  { file: 'tests/shared/module-layout.mjs', contains: 'qa/modules/<id>', reason: 'comment explaining that the old flat layout is no longer resolved' },
  { file: '.claude/skills/checking-module-isolation/check-module-isolation.mjs', reason: 'the isolation checker builds the product folder patterns and prints them' },
  { file: 'portal/registry.mjs', contains: 'readdirSync(path.join(root, \'qa\', productDir)', reason: 'the adapter scan enumerates every product folder under qa/; each adapter is then checked against the resolver' },
  { file: 'portal/registry.mjs', contains: 'const folder = `qa/${productDir}/${entry.name}`', reason: 'the adapter scan names the folder it found, then validates it against the resolver' },
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.portal', 'test-results', 'playwright-report', 'results', 'tmp', 'output']);
const TEXT = /\.(m?js|cjs|ts|mts|json|md|ya?ml)$/;
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (TEXT.test(e.name)) out.push(p);
  }
  return out;
}

/** Pattern hits in `text`: [{ line, name, text }]. `handBuilt` also applies the hand-built-path patterns. */
function scanText(text, { handBuilt = false } = {}) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const f of FLAT) if (f.re.test(line)) hits.push({ line: i + 1, name: f.name, text: line });
    if (!handBuilt) return;
    // arguments of a resolver call are the sanctioned way to name a module folder, so they are not hand-built paths
    const outside = line.replace(RESOLVER_CALL, 'RESOLVED');
    for (const f of HANDBUILT) if (f.re.test(outside)) hits.push({ line: i + 1, name: f.name, text: line });
  });
  return hits;
}

// Runtime code, tests, tools, scripts, persisted data, ignore files, every file under qa/<product>/<module>/ except results/, and the skills and agents.
function scannedFiles(root) {
  const dirs = ['portal', 'tests', 'qa/tools', '.claude/skills', '.claude/agents', 'portal-data'].map(d => path.join(root, d));
  const files = dirs.flatMap(d => walk(d));
  for (const f of ['package.json', 'playwright.config.ts', 'tsconfig.json', '.gitignore', '.dockerignore']) if (fs.existsSync(path.join(root, f))) files.push(path.join(root, f));
  const qa = path.join(root, 'qa');
  if (fs.existsSync(qa)) {
    for (const product of fs.readdirSync(qa, { withFileTypes: true })) {
      if (product.isDirectory() && !['knowledge', 'tools'].includes(product.name)) files.push(...walk(path.join(qa, product.name)));
    }
  }
  return files;
}

/** Offending lines ("file:line (pattern)") in the tree at `root`, minus the entries of `allowed`. */
function offences(root, allowed = []) {
  const bad = [];
  for (const file of scannedFiles(root)) {
    const r = path.relative(root, file).split(path.sep).join('/');
    for (const h of scanText(fs.readFileSync(file, 'utf8'), { handBuilt: !r.startsWith('portal/test/') })) {
      if (allowed.some(a => a.file === r && (!a.contains || h.text.includes(a.contains)))) continue;
      bad.push(`${r}:${h.line} (${h.name})`);
    }
  }
  return bad;
}

test('the old flat folders do not exist', () => {
  for (const d of ['qa/modules', 'tests/modules', 'portal/modules/registration']) {
    assert.ok(!fs.existsSync(path.join(ROOT, d)), `${d} is a leftover of the old flat layout (it stays behind after pulling the move because git keeps ignored and untracked files such as results). Delete or move it: the module now lives in the product-scoped folder (qa/augastam/..., tests/augastam/..., portal/modules/augastam/...).`);
  }
  for (const d of ['qa/augastam/registration', 'tests/augastam/registration', 'portal/modules/augastam/registration']) assert.ok(fs.existsSync(path.join(ROOT, d)), `${d} must exist`);
});

test('no runtime code, test, tool, script, case/data file or skill refers to the old flat layout or builds a module path by hand', () => {
  const bad = offences(ROOT, ALLOWED);
  assert.deepEqual(bad, [], `Old or hand-built module paths found. Use the layout resolver (tests/shared/module-layout.mjs) or the qa/<product>/<module> form:\n${bad.join('\n')}`);
});

test('every allowlist entry still needs its exemption', () => {
  for (const a of ALLOWED) {
    const full = path.join(ROOT, a.file);
    assert.ok(fs.existsSync(full), `${a.file} (${a.reason}) no longer exists; remove it from the allowlist`);
    const hits = scanText(fs.readFileSync(full, 'utf8'), { handBuilt: !a.file.startsWith('portal/test/') });
    assert.ok(hits.some(h => !a.contains || h.text.includes(a.contains)), `${a.file}${a.contains ? ` ("${a.contains}")` : ''} (${a.reason}) no longer needs its exemption; remove it from the allowlist`);
  }
});

test('the scanner flags each forbidden form and accepts the product-scoped forms', () => {
  const bad = [
    'const a = "qa/modules/registration/cases"', 'x(`tests/modules/${id}/cases.spec.ts`)', "path.join(root, 'qa', 'modules', id)",
    'path.join(root, "tests","modules", id)', 'import "../portal/modules/registration/index.mjs"', 'spec: "tests/modules/billing/cases.spec.ts"',
    String.raw`new RegExp('tests\/modules')`, String.raw`'qa\modules\x'`,
    '`${ROOT}/qa/modules/registration`', "'../../qa/modules/registration/cases.json'", "'./tests/modules/x'", 'dir = `/abs/${ROOT}/tests/modules/${id}`',
    "path.join(ROOT, 'portal', 'modules', id)", "path.join(ROOT, 'portal', 'modules', moduleId, 'index.mjs')", 'import(`../portal/modules/${id}/index.mjs`)',
  ];
  for (const line of bad) assert.ok(scanText(line).length > 0, line);
  const handBuilt = [
    'const d = `qa/${product}/${id}/cases`', 'const d = `tests/${p}/${m}`', "const d = path.join(root, 'qa', productDir, name)", "const d = path.resolve(root, 'tests', product, id)",
    "const d = path.join(root, 'qa', 'augastam', 'x')", "const d = 'qa/' + product", 'const d = `portal/modules/${product}/${id}`',
  ];
  for (const line of handBuilt) { assert.deepEqual(scanText(line), [], 'not an old-layout hit: ' + line); assert.ok(scanText(line, { handBuilt: true }).length > 0, line); }
  const good = [
    'qa/augastam/registration/cases', 'tests/miracle/registration/cases.spec.ts', 'portal/modules/augastam/registration/index.mjs', 'portal/modules/contract.mjs',
    'qa/knowledge/modules/registration.md', "path.join(root, 'qa', 'knowledge', 'modules', 'x.md')", '`#/modules/${m.id}/review`', "api('/api/modules/registration/cases')",
    "resolveModuleFolder(ROOT, 'qa', 'augastam', 'registration')", "path.join(root, 'qa', 'impact-map.json')", "path.join(root, 'qa', 'knowledge')", "join(root, 'tests', 'shared', 'x.mjs')",
    "path.join(root, 'portal', 'modules', 'augastam', 'registration')", "const kind = 'tests', productId = 1;",
  ];
  for (const line of good) assert.deepEqual(scanText(line, { handBuilt: true }), [], line);
});

// Temp-tree tests: the scanner walks the whole product folders (data and yaml included) and catches the path spellings the first version missed.
function tree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-guard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  return root;
}

test('injected old paths are caught in absolute-style and relative-style spellings', t => {
  const root = tree(t, {
    'portal/a.mjs': 'const p = `${ROOT}/qa/modules/registration/cases.json`;\n',
    'tests/augastam/registration/b.ts': "import x from '../../../qa/modules/registration/x.json';\n",
    'qa/tools/c.mjs': "const p = './tests/modules/billing';\n",
  });
  assert.deepEqual(offences(root).sort(), ['portal/a.mjs:1 (qa/modules)', 'qa/tools/c.mjs:1 (tests/modules)', 'tests/augastam/registration/b.ts:1 (qa/modules)']);
});

test('the scan covers every file under qa/<product>/<module>/ (workflows.json, manifest.yaml, rules.md) but not results/', t => {
  const root = tree(t, {
    'qa/augastam/registration/workflows.json': '{"upload":{"file":"qa/modules/registration/data/p.pdf"}}\n',
    'qa/augastam/registration/manifest.yaml': 'cases: qa/modules/registration/cases/x.json\n',
    'qa/augastam/registration/rules.md': 'See tests/modules/registration/x.ts\n',
    'qa/augastam/registration/bugs/b.yml': 'path: ../../../tests/modules/registration\n',
    'qa/augastam/registration/results/old/results.json': '{"x":"qa/modules/registration/data/p.pdf"}\n',
    'qa/knowledge/modules/registration.md': 'qa/knowledge/modules/x lives here\n',
  });
  assert.deepEqual(offences(root).sort(), [
    'qa/augastam/registration/bugs/b.yml:1 (tests/modules)', 'qa/augastam/registration/manifest.yaml:1 (qa/modules)',
    'qa/augastam/registration/rules.md:1 (tests/modules)', 'qa/augastam/registration/workflows.json:1 (qa/modules)',
  ]);
});

test('hand-built flat plugin paths and hand-built new-layout paths are caught outside the resolver and portal/test', t => {
  const root = tree(t, {
    'portal/a.mjs': "const d = path.join(ROOT, 'portal', 'modules', id);\n",
    'portal/b.mjs': 'const d = `portal/modules/${id}/index.mjs`;\n',
    'portal/c.mjs': 'const d = `qa/${product}/${id}`;\n',
    'qa/tools/d.mjs': "const d = path.join(ROOT, 'tests', product, id);\n",
    'tests/e.ts': "const d = 'qa/' + product + '/' + id;\n",
    'portal/test/fixture.test.mjs': "const d = path.join(root, 'qa', 'augastam', 'billing');\n",
    'portal/ok.mjs': "const d = resolveModuleFolder(ROOT, 'qa', 'augastam', 'registration'); const k = path.join(root, 'qa', 'knowledge');\n",
  });
  assert.deepEqual(offences(root).sort(), [
    'portal/a.mjs:1 (flat plugin path built from an id: join(\'portal\', \'modules\', id))',
    'portal/b.mjs:1 (flat plugin path built from an id: portal/modules/${id})',
    'portal/b.mjs:1 (template path qa|tests|portal/modules/${...})',
    'portal/c.mjs:1 (template path qa|tests|portal/modules/${...})',
    "qa/tools/d.mjs:1 (path.join/resolve of 'qa'|'tests' with a non-shared next part)",
    "tests/e.ts:1 (string concatenation 'qa/' + ...)",
  ].sort());
});

test('the allowlist can exempt a single line rather than a whole file', t => {
  const root = tree(t, { 'portal/x.mjs': "const A = 'qa/modules/registration/data/p.pdf';\nconst B = 'qa/modules/registration/other';\n" });
  assert.deepEqual(offences(root, [{ file: 'portal/x.mjs', contains: "const A = " }]), ['portal/x.mjs:2 (qa/modules)']);
  assert.deepEqual(offences(root, [{ file: 'portal/x.mjs' }]), []);
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
