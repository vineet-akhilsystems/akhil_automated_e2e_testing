// Syntax check for the portal: `node --check` on every portal/**/*.mjs, and browser ES modules
// (portal/public/**/*.js) checked as modules. Exits non-zero and lists every failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const portal = path.join(root, 'portal');
const SKIP = new Set(['node_modules', 'test-output', '__pycache__']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

const files = walk(portal);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-check-'));
const failures = [];
let checked = 0;
try {
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    let target = null;
    if (file.endsWith('.mjs')) target = file;
    else if (file.endsWith('.js') && rel.startsWith('portal/public/')) {
      target = path.join(tmp, `${checked}.mjs`); // browser modules: check as ES modules
      fs.copyFileSync(file, target);
    }
    if (!target) continue;
    checked++;
    const r = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
    if (r.status !== 0) failures.push(`${rel}\n${(r.stderr || '').trim().split('\n').slice(0, 6).join('\n')}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`Syntax check failed for ${failures.length} of ${checked} files:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`Syntax OK: ${checked} files`);
