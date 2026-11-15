import test from 'node:test';
import assert from 'node:assert/strict';
import { checkImpact, validateMap, matchGlob, isIgnoredPath, formatReport } from '../../qa/tools/impact-check.mjs';

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

test('the shipped map has the required shape', async () => {
  const fs = await import('node:fs');
  const shipped = JSON.parse(fs.readFileSync(new URL('../../qa/impact-map.json', import.meta.url), 'utf8'));
  assert.ok(shipped.rules.length > 0);
  assert.deepEqual(validateMap({ map: shipped, exists: () => true }), []);
});
