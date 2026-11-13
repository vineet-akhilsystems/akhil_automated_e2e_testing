import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// The in-app guide must stay consistent with itself and with the screens it describes.
const root = path.resolve(import.meta.dirname, '..', 'public');
const source = fs.readFileSync(path.join(root, 'pages', 'help.js'), 'utf8');

test('every guide link points at a real section, and every section has a title, a lead and content', async () => {
  const ids = [...source.matchAll(/\{ id: '([\w-]+)', title: '([^']+)', lead: '([^']+)'/g)].map(m => m[1]);
  assert.ok(ids.length >= 12, `expected the full guide, found ${ids.length} sections`);
  assert.equal(new Set(ids).size, ids.length, 'section ids are unique');
  for (const link of source.matchAll(/data-docs-go="([\w-]+)"/g)) assert.ok(ids.includes(link[1]), `link to missing section "${link[1]}"`);
});

test('the guide is reachable from the menu, the router and the breadcrumb', () => {
  assert.match(fs.readFileSync(path.join(root, 'router.js'), 'utf8'), /help: helpPage/);
  const shell = fs.readFileSync(path.join(root, 'pages', 'workspace.js'), 'utf8');
  assert.match(shell, /href="#\/help"/); assert.match(shell, /help: 'Help & guide'/);
  assert.match(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), /handlers\/help\.js/);
});

test('button names used in the guide exist in the app (so the guide does not drift from the screens)', () => {
  const app = ['pages', 'components', 'handlers'].flatMap(d => fs.readdirSync(path.join(root, d)).map(f => path.join(root, d, f))).filter(f => f.endsWith('.js') && !f.endsWith('help.js')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  for (const label of ['Analyse files', 'Run anyway', 'New test run', 'Close run', 'Download bug report (PDF)', 'Export Excel', 'Re-run failures', 'Rerun all cases', 'Approve selected', 'Reject selected', 'Add login profile', 'Refresh application login', 'Download module pack', 'Add test case', 'Add module', 'Delete module', 'Module settings'])
    assert.ok(app.includes(label), `the guide mentions "${label}" but no screen has it`);
});
