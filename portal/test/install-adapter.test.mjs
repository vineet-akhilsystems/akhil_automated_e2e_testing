import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, InstallError, scanCode } from '../../qa/tools/install-module-adapter.mjs';

// Everything happens in temp dirs: `root` stands in for the repository, so the real tests/ and qa/ are never written.
function sandbox(t, { files, adapter } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo'), from = path.join(dir, 'proposal');
  fs.mkdirSync(root); fs.mkdirSync(from);
  const good = { id: 'billing', name: 'Billing', spec: 'tests/modules/billing/cases.spec.ts', prefix: 'BIL', actions: { fill: 'Fill' }, outcomes: ['created'], variants: [], fields: { amount: { label: 'Amount', kind: 'text' } }, bases: { valid: { amount: '1' } } };
  const all = { 'fields.ts': 'export const FIELDS = {};\n', 'billing.page.ts': 'export class BillingPage {}\n', 'case-runner.ts': 'export {};\n', 'cases.spec.ts': 'export {};\n', 'NOTES.md': 'todo\n', 'adapter.json': JSON.stringify({ ...good, ...adapter }), ...files };
  for (const [n, v] of Object.entries(all)) if (v !== null) fs.writeFileSync(path.join(from, n), v);
  const calls = [], log = [];
  const run = (command, args) => { calls.push([command, ...args].join(' ')); return { code: 0, output: '' }; };
  return { dir, root, from, calls, log, run, opts: { root, run, log: m => log.push(m) } };
}
const rejects = (p, re) => assert.rejects(p, e => e instanceof InstallError && re.test(e.message), String(re));

test('dry run validates and prints a plan but writes nothing and runs nothing', async t => {
  const s = sandbox(t);
  const r = await install(['--module', 'billing', '--from', s.from, '--dry-run'], s.opts);
  assert.equal(r.installed, false); assert.deepEqual(s.calls, []);
  assert.ok(!fs.existsSync(path.join(s.root, 'tests')) && !fs.existsSync(path.join(s.root, 'qa')));
  assert.ok(s.log.some(l => /create\s+qa\/modules\/billing\/adapter\.json/.test(l)));
});

test('install copies files to tests/modules/<id> and adapter.json to qa/modules/<id>, then runs the two checks', async t => {
  const s = sandbox(t);
  const r = await install(['--module', 'billing', '--from', s.from, '--yes'], s.opts);
  assert.equal(r.installed, true); assert.equal(r.ok, true);
  for (const n of ['fields.ts', 'billing.page.ts', 'case-runner.ts', 'cases.spec.ts', 'NOTES.md']) assert.ok(fs.existsSync(path.join(s.root, 'tests', 'modules', 'billing', n)), n);
  assert.ok(fs.existsSync(path.join(s.root, 'qa', 'modules', 'billing', 'adapter.json')));
  assert.ok(!fs.existsSync(path.join(s.root, 'tests', 'modules', 'billing', 'adapter.json')));
  assert.deepEqual(s.calls, ['npx tsc --noEmit', 'npm run portal:check']);
  assert.ok(s.log.some(l => /does not edit \.portal\/portal\.sqlite/.test(l)));
  // second install refuses to overwrite unless forced
  await rejects(install(['--module', 'billing', '--from', s.from, '--yes'], s.opts), /overwrite/);
  assert.equal((await install(['--module', 'billing', '--from', s.from, '--yes', '--force'], s.opts)).installed, true);
});

test('--job resolves <data-dir>/agent/<job>/output/automation; a failed check is reported and exits not-ok', async t => {
  const s = sandbox(t);
  const jobDir = path.join(s.root, '.portal', 'agent', 'job-1', 'output');
  fs.mkdirSync(jobDir, { recursive: true }); fs.renameSync(s.from, path.join(jobDir, 'automation'));
  const failing = (command, args) => { s.calls.push(`${command} ${args.join(' ')}`); return { code: 2, output: 'TS2322 boom' }; };
  const r = await install(['--module', 'billing', '--job', 'job-1', '--yes'], { ...s.opts, run: failing });
  assert.equal(r.installed, true); assert.equal(r.ok, false); assert.deepEqual(s.calls, ['npx tsc --noEmit']);
  assert.ok(s.log.some(l => /FAILED: npx tsc/.test(l) && /boom/.test(l)));
});

test('argument and id validation, confirmation required without --yes', async t => {
  const s = sandbox(t);
  await rejects(install(['--module', '../evil', '--from', s.from, '--dry-run'], s.opts), /--module/);
  await rejects(install(['--module', 'Billing', '--from', s.from], s.opts), /--module/);
  await rejects(install(['--module', 'billing'], s.opts), /exactly one/);
  await rejects(install(['--module', 'billing', '--from', s.from, '--job', 'x'], s.opts), /exactly one/);
  await rejects(install(['--module', 'billing', '--job', '../x'], s.opts), /--job/);
  await rejects(install(['--module', 'billing', '--from', s.from, '--bogus'], s.opts), /Unknown argument/);
  const declined = await install(['--module', 'billing', '--from', s.from], { ...s.opts, confirm: async () => false });
  assert.equal(declined.installed, false); assert.ok(!fs.existsSync(path.join(s.root, 'tests')));
});

test('rejects unexpected files, missing files, symlinks and bad adapter.json', async t => {
  await rejects(install(['--module', 'billing', '--from', sandbox(t, { files: { 'evil.sh': 'x' } }).from, '--dry-run'], sandbox(t).opts), /Unexpected entry/);
  await rejects(install(['--module', 'billing', '--from', sandbox(t, { files: { 'case-runner.ts': null } }).from, '--dry-run'], sandbox(t).opts), /Missing required file: case-runner\.ts/);
  const link = sandbox(t, { files: { 'NOTES.md': null } });
  try { fs.symlinkSync(path.join(link.dir, 'repo'), path.join(link.from, 'NOTES.md')); await rejects(install(['--module', 'billing', '--from', link.from, '--dry-run'], link.opts), /symlinks/); } catch (e) { if (e.code !== 'EPERM') throw e; }
  const base = sandbox(t).opts;
  await rejects(install(['--module', 'billing', '--from', sandbox(t, { adapter: { id: 'other' } }).from, '--dry-run'], base), /id must be "billing"/);
  await rejects(install(['--module', 'billing', '--from', sandbox(t, { adapter: { spec: 'tests/modules/x/cases.spec.ts' } }).from, '--dry-run'], base), /spec must be exactly/);
  await rejects(install(['--module', 'billing', '--from', sandbox(t, { adapter: { command: 'rm -rf /' } }).from, '--dry-run'], base), /unsupported key "command"/);
  await rejects(install(['--module', 'billing', '--from', sandbox(t, { adapter: { bases: { valid: { ghost: '1' } } } }).from, '--dry-run'], base), /unknown field "ghost"/);
});

test('code scan rejects child_process, eval, process.exit, hard-coded hosts and credentials but allows env-driven code', async t => {
  for (const bad of ["import { exec } from 'node:child_process';", 'eval("1")', 'process.exit(1)', "await fetch('https://evil.example/x')", "const password = 'hunter2hunter2';", "headers: { authorization: 'Bearer abcdefghijklmnop1234' }"]) {
    const s = sandbox(t, { files: { 'case-runner.ts': `${bad}\n` } });
    await rejects(install(['--module', 'billing', '--from', s.from, '--yes'], s.opts), /rejected/);
    assert.ok(!fs.existsSync(path.join(s.root, 'tests')), bad);
  }
  assert.deepEqual(scanCode('ok.ts', "const base = process.env.BASE_URL; await fetch(`${base}/x`); const password = process.env.BASE_URL ?? '';", 'billing'), []);
});

test('code scan blocks known bypasses (concat, Function(), globalThis[], goto concat, fs writes, protected paths, credentials)', () => {
  const bypasses = {
    'child_process string concat': "const cp = require('child_' + 'process'); cp.execSync('x');",
    'Function()() without new': "Function('return process')()();",
    'new Function': "new Function('return 1')();",
    "globalThis['ev'+'al']": "globalThis['ev' + 'al']('1');",
    "goto('ht'+'tps://..')": "await page.goto('ht' + 'tps://evil.example');",
    'writeFileSync to .claude/hooks': "import { writeFileSync } from 'fs'; writeFileSync('.claude/hooks/x.sh', 'x');",
    'fs write via promises': "await fsx.promises.rm('x');",
    "readFileSync('.auth/session.json')": "const s = readFileSync('.auth/session.json', 'utf8');",
    'dynamic import': "const m = await import(name);",
    'non-literal require': 'const m = require(name);',
    'process.env other than allowlist': 'const k = process.env.ANTHROPIC_API_KEY;',
    'process.env whole object': 'const e = { ...process.env };',
    'hard-coded url': "const u = 'http://evil.example/x';",
    'const pw': "const pw = 'abc';",
    'password with spaces': "password = 'a b c';",
    'password double quote': 'const password = "s3cret!";',
    'token backtick': 'const token = `abcdef`;',
    'disallowed import': "import fs from 'node:fs';",
    'relative escape import': "import x from '../../../portal/server.mjs';",
  };
  for (const [name, code] of Object.entries(bypasses)) assert.ok(scanCode('case-runner.ts', `${code}\n`, 'billing').length > 0, `not flagged: ${name}`);
  // allow-listed imports and env reads pass
  const ok = "import { Page, expect } from '@playwright/test';\nimport { test } from '../../fixtures/auth';\nimport { FIELDS } from './fields';\nimport { BillingPage } from './billing.page';\nimport { runCase } from './case-runner';\nimport path from 'node:path';\nconst f = process.env.CASES_FILE, r = process.env.PORTAL_RUN_DIR, b = process.env.BASE_URL;\n";
  assert.deepEqual(scanCode('cases.spec.ts', ok, 'billing'), []);
});

test('NOTES.md and adapter.json are scanned for secrets, and a rejected proposal is never written', async t => {
  assert.ok(scanCode('NOTES.md', 'Use password = "hunter2" to log in').length);
  const s = sandbox(t, { files: { 'NOTES.md': "login with password: 'hunter2hunter2'\n" } });
  await rejects(install(['--module', 'billing', '--from', s.from, '--yes'], s.opts), /NOTES\.md.*credential/s);
  assert.ok(!fs.existsSync(path.join(s.root, 'tests')));
});

test('prints file hashes and a preview even with --yes, and the full text with --show', async t => {
  const long = Array.from({ length: 60 }, (_, i) => `// line ${i}`).join('\n');
  const s = sandbox(t, { files: { 'fields.ts': `${long}\nexport const FIELDS = {};\n` } });
  await install(['--module', 'billing', '--from', s.from, '--yes'], s.opts);
  const out = s.log.join('\n');
  assert.match(out, /--- fields\.ts\s+sha256:[0-9a-f]{64}/); assert.match(out, /more line\(s\); re-run with --show/); assert.ok(!out.includes('// line 59'));
  const s2 = sandbox(t, { files: { 'fields.ts': `${long}\nexport const FIELDS = {};\n` } });
  await install(['--module', 'billing', '--from', s2.from, '--yes', '--show'], s2.opts);
  assert.ok(s2.log.join('\n').includes('// line 59'));
});

test('never installs registration or an id that already has an adapter/tests folder (force does not unlock registration)', async t => {
  const s = sandbox(t);
  await rejects(install(['--module', 'registration', '--from', s.from, '--dry-run'], s.opts), /built in/);
  await rejects(install(['--module', 'registration', '--from', s.from, '--yes', '--force'], s.opts), /built in/);
  const s2 = sandbox(t);
  fs.mkdirSync(path.join(s2.root, 'tests', 'modules', 'billing'), { recursive: true });
  await rejects(install(['--module', 'billing', '--from', s2.from, '--dry-run'], s2.opts), /already has/);
  assert.equal((await install(['--module', 'billing', '--from', s2.from, '--dry-run', '--force'], s2.opts)).installed, false);
});

test('uses the registry id rule and validator: underscore ids and registry-invalid adapters are rejected before any write', async t => {
  const s = sandbox(t);
  await rejects(install(['--module', 'bill_ing', '--from', s.from, '--dry-run'], s.opts), /--module/);
  const bad = sandbox(t, { adapter: { bases: undefined, fields: { Amount: { label: 'Amount', kind: 'text' } } } });
  await rejects(install(['--module', 'billing', '--from', bad.from, '--yes'], bad.opts), /registry would reject/);
  assert.ok(!fs.existsSync(path.join(bad.root, 'tests')) && !fs.existsSync(path.join(bad.root, 'qa')));
  const kind = sandbox(t, { adapter: { bases: undefined, fields: { amount: { label: 'Amount', kind: 'weird' } } } });
  await rejects(install(['--module', 'billing', '--from', kind.from, '--yes'], kind.opts), /registry would reject.*kind/);
});

test('a successful install reports the registry load before "Checks passed"', async t => {
  const s = sandbox(t);
  const r = await install(['--module', 'billing', '--from', s.from, '--yes'], s.opts);
  assert.equal(r.registryLoaded, true);
  const out = s.log.join('\n');
  assert.ok(out.indexOf('the registry loads adapter "billing"') < out.indexOf('Checks passed.'));
});
