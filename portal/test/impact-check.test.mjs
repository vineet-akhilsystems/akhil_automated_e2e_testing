import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath as fileURLToPathCompat } from 'node:url';
import { checkImpact, validateMap, matchGlob, isIgnoredPath, formatReport, parseArgs, changedFiles, repoFiles, run, verifyProblems, UsageError } from '../../qa/tools/impact-check.mjs';

const map = {
  rules: [
    { id: 'r1', title: 'Routes', when: ['portal/routes/*.mjs'], alsoCheck: [{ path: 'README.md', why: 'docs' }, { glob: 'portal/test/**', why: 'tests' }], verify: ['node --test'] },
    { id: 'r2', title: 'Other', when: ['x/**'], alsoCheck: [{ path: 'y.txt', why: 'y' }], verify: [] }
  ]
};

test('matching: a changed file triggers its rule and unmatched rules stay out', () => {
  const r = checkImpact({ changed: ['portal/routes/runs.mjs'], map });
  assert.deepEqual(r.rules.map(x => x.id), ['r1']);
  assert.deepEqual(r.rules[0].changed, ['portal/routes/runs.mjs']);
  assert.equal(checkImpact({ changed: ['unrelated.js'], map }).rules.length, 0);
});

test('targets are marked changed too or NOT in this change, and missing is counted', () => {
  const r = checkImpact({ changed: ['portal/routes/runs.mjs', 'README.md'], map });
  const by = Object.fromEntries(r.rules[0].targets.map(t => [t.target, t.changedToo]));
  assert.equal(by['README.md'], true);
  assert.equal(by['portal/test/**'], false);
  assert.equal(r.missing, 1);
  const text = formatReport(r);
  assert.match(text, /You changed portal\/routes\/runs\.mjs/);
  assert.match(text, /-> also check README\.md \(docs\) - changed too/);
  assert.match(text, /-> also check portal\/test\/\*\* \(tests\) - NOT in this change/);
});

test('rule where every target changed too has nothing missing (strict would pass)', () => {
  const r = checkImpact({ changed: ['portal/routes/a.mjs', 'README.md', 'portal/test/api.test.mjs'], map });
  assert.equal(r.missing, 0);
  assert.ok(r.rules[0].targets.every(t => t.changedToo));
});

test('backslashes and ./ prefixes are normalised; duplicates collapse', () => {
  const r = checkImpact({ changed: ['.\\portal\\routes\\runs.mjs', 'portal/routes/runs.mjs'], map });
  assert.deepEqual(r.changed, ['portal/routes/runs.mjs']);
});

test('validate: a rule pointing at a missing path or glob is reported as stale', () => {
  const files = ['portal/routes/a.mjs', 'README.md'];
  const exists = p => p.includes('*') ? files.some(f => matchGlob(p, f)) : files.includes(p);
  const problems = validateMap({ map, exists });
  assert.ok(problems.some(p => /rule r1: alsoCheck "portal\/test\/\*\*" matches nothing/.test(p)));
  assert.ok(problems.some(p => /rule r2: when "x\/\*\*" matches nothing/.test(p)));
  assert.ok(problems.some(p => /rule r2: alsoCheck "y\.txt" matches nothing/.test(p)));
  assert.deepEqual(validateMap({ map: { rules: [map.rules[0]] }, exists: () => true }), []);
});

test('validate: structural problems are caught', () => {
  const bad = { rules: [{ id: 'a', title: 't', when: [], alsoCheck: [{ path: 'p' }] }, { id: 'a', title: 't', when: ['p'], alsoCheck: [{ path: 'p', why: 'w' }], verify: [] }] };
  const p = validateMap({ map: bad, exists: () => true });
  assert.ok(p.some(x => /when\[\] is empty/.test(x)));
  assert.ok(p.some(x => /has no why/.test(x)));
  assert.ok(p.some(x => /verify must be a list/.test(x)));
  assert.ok(p.some(x => /duplicate id/.test(x)));
});

test('glob edge cases', () => {
  assert.equal(matchGlob('portal/routes/*.mjs', 'portal/routes/a.mjs'), true);
  assert.equal(matchGlob('portal/routes/*.mjs', 'portal/routes/sub/a.mjs'), false, '* does not cross folders');
  assert.equal(matchGlob('portal/**', 'portal/a/b/c.js'), true);
  assert.equal(matchGlob('portal/**/c.js', 'portal/c.js'), true, '**/ matches zero folders');
  assert.equal(matchGlob('portal/**/c.js', 'portal/a/b/c.js'), true);
  assert.equal(matchGlob('qa/modules/*/**', 'qa/modules/registration/cases/x.json'), true);
  assert.equal(matchGlob('qa/modules/*/**', 'qa/modules/registration'), false);
  assert.equal(matchGlob('a/?.js', 'a/b.js'), true);
  assert.equal(matchGlob('a/?.js', 'a/bc.js'), false);
  assert.equal(matchGlob('src/*.{ts,tsx}', 'src/a.tsx'), true);
  assert.equal(matchGlob('src/*.{ts,tsx}', 'src/a.js'), false);
  assert.equal(matchGlob('a.b', 'aXb'), false, 'dot is literal');
  assert.equal(matchGlob('a+(b)', 'a+(b)'), true, 'regex characters are literal');
  assert.equal(matchGlob('docs/', 'docs/x/y.md'), true, 'trailing slash means the folder');
  assert.equal(matchGlob('README.md', 'README.md'), true);
  assert.equal(matchGlob('README.md', 'docs/README.md'), false);
});

test('credential and session paths are ignored entirely, in input and in output', () => {
  const secret = ['.' + 'env', '.' + 'env.local', ['login', 'txt'].join('.'), ['PORTAL_LOGIN', 'txt'].join('.'), '.' + 'auth/user.json', 'sub/.' + 'auth/state.json', 'config/.' + 'env'];
  for (const p of secret) assert.equal(isIgnoredPath(p), true, p);
  assert.equal(isIgnoredPath('.' + 'env.example'), true);
  assert.equal(isIgnoredPath('portal/auth.mjs'), false);
  assert.equal(isIgnoredPath('tests/auth.setup.ts'), false);
  const catchAll = { rules: [{ id: 'all', title: 'all', when: ['**'], alsoCheck: [{ path: secret[0], why: 'secret' }, { path: 'README.md', why: 'docs' }], verify: [] }] };
  const r = checkImpact({ changed: [...secret, 'a.js'], map: catchAll });
  assert.deepEqual(r.changed, ['a.js']);
  assert.deepEqual(r.rules[0].targets.map(t => t.target), ['README.md']);
  const out = JSON.stringify(r) + formatReport(r);
  for (const p of secret) assert.ok(!out.includes(p), `${p} leaked into output`);
});

const ENVN = '.' + 'env';
const AUTHN = '.' + 'auth';
const SECRET_NAMES = [ENVN, ENVN + '.local', ['login', 'txt'].join('.'), AUTHN + '/state.json', 'dir/' + ENVN + '/x.json'];

test('nested braces and the {module} capture', () => {
  assert.equal(matchGlob('a/{b,{c,d}}/x', 'a/b/x'), true);
  assert.equal(matchGlob('a/{b,{c,d}}/x', 'a/c/x'), true);
  assert.equal(matchGlob('a/{b,{c,d}}/x', 'a/d/x'), true);
  assert.equal(matchGlob('a/{b,{c,d}}/x', 'a/e/x'), false);
  assert.equal(matchGlob('a/{b,{c,d}}/x', 'a/{c/x'), false);
  const m = { rules: [{ id: 'm', title: 'm', when: ['p/{module}/**', 'q/{module}/**'], alsoCheck: [{ path: 'p/{module}/**', why: 'own' }, { path: 'q/{module}/**', why: 'other tree, same module' }], verify: [] }] };
  const r = checkImpact({ changed: ['p/one/a.js', 'q/two/b.js'], map: m });
  const one = r.rules.find(x => x.module === 'one'), two = r.rules.find(x => x.module === 'two');
  assert.deepEqual(one.targets.map(t => [t.target, t.changedToo]), [['q/one/**', false]], 'own tree dropped, same-module partner missing');
  assert.deepEqual(two.targets.map(t => [t.target, t.changedToo]), [['p/two/**', false]], 'a change to module two does not satisfy module one');
  assert.equal(checkImpact({ changed: ['p/one/a.js', 'q/one/b.js'], map: m }).missing, 0);
});

test('a group rule lists only partners still missing', () => {
  const g = { rules: [{ id: 'g', title: 'g', when: ['a.js', 'b.js'], alsoCheck: [{ path: 'a.js', why: 'a' }, { path: 'b.js', why: 'b' }], verify: [] }] };
  assert.deepEqual(checkImpact({ changed: ['a.js'], map: g }).rules[0].targets.map(t => t.target), ['b.js']);
  assert.equal(checkImpact({ changed: ['a.js', 'b.js'], map: g }).missing, 0);
});

test('advisory rules are shown but never counted by strict', () => {
  const a = { rules: [{ id: 'adv', title: 'adv', severity: 'advisory', when: ['a.js'], alsoCheck: [{ path: 'b.js', why: 'b' }], verify: [] }] };
  const r = checkImpact({ changed: ['a.js'], map: a });
  assert.equal(r.missing, 0);
  assert.equal(r.advisoryMissing, 1);
  assert.match(formatReport(r), /advisory/);
  assert.equal(validateMap({ map: { rules: [{ ...a.rules[0], severity: 'bogus' }] }, exists: () => true }).length, 1);
});

test('credential and session paths never reach validate output', () => {
  for (const p of SECRET_NAMES) assert.equal(isIgnoredPath(p), true, p);
  assert.equal(isIgnoredPath('dir/' + ENVN + '/deep/x'), true, 'a folder segment is enough');
  const s = { rules: [{ id: 's', title: 's', when: [ENVN, 'dir/' + ENVN + '/**'], alsoCheck: [{ path: ENVN + '.local', why: 'x' }, { path: AUTHN + '/state.json', why: 'x' }], verify: [] }] };
  const text = validateMap({ map: s, exists: () => false }).join('\n');
  assert.ok(!text.includes(ENVN), text);
  assert.ok(!text.includes(AUTHN), text);
});

function tempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  g('init', '-q'); g('config', 'user.email', 't@example.test'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
  const w = (rel, body = 'x') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
  return { dir, g, w };
}
const capture = () => { const o = [], e = []; return { o, e, io: { out: s => o.push(s), err: s => e.push(s) } }; };

test('changedFiles: rename (both sides), untracked, delete, staged, range; repoFiles hides credential files', t => {
  const { dir, g, w } = tempRepo(t);
  w('keep.txt', 'one'); w('old.txt', 'two longer body to keep similarity'); w('gone.txt', 'three');
  g('add', '.'); g('commit', '-q', '-m', 'base');
  g('mv', 'old.txt', 'new.txt');
  fs.rmSync(path.join(dir, 'gone.txt'));
  w('fresh/untracked.txt');
  w(ENVN, 'k=1');
  const wt = changedFiles({}, dir).filter(f => f !== ENVN).sort();
  assert.deepEqual(wt, ['fresh/untracked.txt', 'gone.txt', 'new.txt', 'old.txt']);
  assert.deepEqual(changedFiles({ staged: true }, dir).sort(), ['new.txt', 'old.txt']);
  g('add', 'fresh'); g('commit', '-q', '-a', '-m', 'second');
  assert.deepEqual(changedFiles({ range: 'HEAD~1..HEAD' }, dir).sort(), ['fresh/untracked.txt', 'gone.txt', 'new.txt', 'old.txt']);
  const files = repoFiles(dir);
  assert.ok(files.includes('new.txt') && files.includes('keep.txt'));
  assert.ok(!files.includes('gone.txt'));
  assert.ok(!files.some(f => isIgnoredPath(f)), 'credential file present on disk must not be listed');
});

test('a tracked file deleted in the working tree does not count as existing', t => {
  const { dir, g, w } = tempRepo(t);
  w('a.txt'); g('add', '.'); g('commit', '-q', '-m', 'c');
  fs.rmSync(path.join(dir, 'a.txt'));
  assert.ok(!repoFiles(dir).includes('a.txt'));
});

test('parseArgs: options, bare --range, dash and space ranges, conflicts, unknown option', () => {
  assert.deepEqual(parseArgs(['--strict', '--json']), { staged: false, strict: true, json: true, validate: false, range: null });
  assert.equal(parseArgs(['--range', 'a..b']).range, 'a..b');
  assert.equal(parseArgs(['--range=a..b']).range, 'a..b');
  for (const bad of [['--range'], ['--range', '--staged'], ['--range', '--strict'], ['--range', '--output=x'], ['--range=-x'], ['--range', 'a b'], ['--range', 'a..b;c'], ['--range', 'a\n..b'], ['--range', ''], ['--staged', '--range', 'a..b'], ['--nope']]) {
    assert.throws(() => parseArgs(bad), UsageError, JSON.stringify(bad));
  }
});

test('run: exit codes 0 / 1 strict / 1 stale validate / 2 usage, and a hostile range creates no file', t => {
  const { dir, g, w } = tempRepo(t);
  w('qa/impact-map.json', JSON.stringify({ rules: [{ id: 'r', title: 'r', when: ['src/*.js'], alsoCheck: [{ path: 'docs.md', why: 'docs' }], verify: ['node --test test/x.test.mjs', 'npm run nothere'] }] }));
  w('package.json', JSON.stringify({ scripts: { ok: 'x' } }));
  w('src/a.js'); w('docs.md'); w('test/x.test.mjs');
  g('add', '.'); g('commit', '-q', '-m', 'base');
  let c = capture();
  assert.equal(run([], { root: dir, ...c.io }), 0);
  assert.match(c.o.join(''), /No mapped coupling/);
  w('src/a.js', 'changed');
  c = capture();
  assert.equal(run(['--strict'], { root: dir, ...c.io }), 1);
  assert.match(c.o.join(''), /You changed src\/a\.js[\s\S]*also check docs\.md \(docs\) - NOT in this change/);
  c = capture();
  assert.equal(run(['--json'], { root: dir, ...c.io }), 0);
  assert.equal(JSON.parse(c.o.join('')).missing, 1);
  c = capture();
  assert.equal(run(['--validate'], { root: dir, ...c.io }), 1);
  assert.match(c.o.join(''), /STALE: rule r: verify "npm run nothere": npm script "nothere" does not exist/);
  assert.doesNotMatch(c.o.join(''), /x\.test\.mjs/, 'an existing test file is fine');
  const victim = path.join(dir, 'victim.txt');
  for (const args of [['--range', '--output=' + victim], ['--range=--output=' + victim], ['--range'], ['--range', 'a b'], ['--bogus']]) {
    c = capture();
    assert.equal(run(args, { root: dir, ...c.io }), 2, JSON.stringify(args));
    assert.ok(c.e.length > 0);
  }
  assert.equal(fs.existsSync(victim), false, 'no file may be created by a hostile range');
  c = capture();
  assert.equal(run(['--range', 'no-such-ref..HEAD'], { root: dir, ...c.io }), 2, 'git failure is a plain exit 2');
});

test('verifyProblems checks node file arguments and npm scripts', () => {
  const exists = p => p === 'a.test.mjs';
  assert.deepEqual(verifyProblems('node --test a.test.mjs', { exists }), []);
  assert.match(verifyProblems('node --test a.test.mjs b.test.mjs', { exists })[0], /b\.test\.mjs/);
  assert.match(verifyProblems('npm run zzz', { exists, scripts: ['impact'] })[0], /zzz/);
  assert.deepEqual(verifyProblems('npm run impact -- --validate', { exists, scripts: ['impact'] }), []);
});

test('the shipped map validates against the real file list', () => {
  const root = path.resolve(fileURLToPathCompat(new URL('../..', import.meta.url)));
  const shipped = JSON.parse(fs.readFileSync(path.join(root, 'qa', 'impact-map.json'), 'utf8'));
  const files = repoFiles(root);
  const exists = p => /[*?{]/.test(p) ? files.some(f => matchGlob(p, f)) : files.includes(p);
  const scripts = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts);
  assert.deepEqual(validateMap({ map: shipped, exists, scripts }), []);
  assert.ok(shipped.rules.length > 0);
});
