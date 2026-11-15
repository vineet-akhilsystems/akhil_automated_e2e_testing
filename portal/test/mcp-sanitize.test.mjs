import test from 'node:test';
import assert from 'node:assert/strict';
import { stripSecrets, capField } from '../mcp-sanitize.mjs';

test('stripSecrets removes profile.keys and any query at every depth, and keeps other keys fields', () => {
  const out = stripSecrets({ id: 'r', profile: { hash: 'h', keys: { a: 'SECRETVAL' } }, runs: [{ profile: { keys: ['SECRETVAL'], parts: {} }, nested: { query: 'select *', ok: 1 } }], match: { keys: ['kept'] }, query: 'q' });
  assert.equal(JSON.stringify(out).includes('SECRETVAL'), false);
  assert.equal(JSON.stringify(out).includes('select'), false);
  assert.equal(out.profile.hash, 'h');
  assert.deepEqual(out.match.keys, ['kept']);
  assert.equal(out.runs[0].nested.ok, 1);
  assert.equal(stripSecrets(null), null);
  assert.deepEqual(stripSecrets([1, 'a']), [1, 'a']);
});

test('capField cuts a long list and says so; short lists are untouched', () => {
  const big = capField({ rows: [1, 2, 3, 4], x: 1 }, 'rows', 2);
  assert.deepEqual(big, { rows: [1, 2], x: 1, truncated: true, rowsTotal: 4 });
  const same = { rows: [1] };
  assert.equal(capField(same, 'rows', 2), same);
  assert.equal(capField(undefined, 'rows', 2), undefined);
});
