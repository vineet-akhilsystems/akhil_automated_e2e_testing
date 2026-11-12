import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, resolveCases } from '../../portal/registry.mjs';
import { loadPortalCases, defaultPortalDirectory } from './registration-pipeline-source.mjs';

const selected = (process.env.CASES || '').split(',').map(s => s.trim()).filter(Boolean);
const portal = process.argv.includes('--portal');
const doc = portal ? loadPortalCases(defaultPortalDirectory(), selected)
  : JSON.parse(fs.readFileSync(path.join(ROOT, 'qa/modules/registration/cases/registration-automation.json'), 'utf8'));
const cases = resolveCases(doc.cases, selected.length ? selected : doc.cases.filter(c => c.enabled !== false).map(c => c.id));
const args = process.argv.slice(2).filter(arg => arg !== '--portal');
const listing = args.includes('--list');
const directory = path.join(ROOT, 'qa/modules/registration/results/automation-inputs');
fs.mkdirSync(directory, { recursive: true });
const snapshot = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.json`);
fs.writeFileSync(snapshot, JSON.stringify({ ...doc, cases }, null, 2));
const env = { ...process.env, CASES: '', CASES_FILE: snapshot };
const statusPath = snapshot.replace(/\.json$/, '-pipeline-status.json');
const status = { source: portal ? 'portal' : 'workflow-suite', snapshot, selected: cases.map(c => c.id),
  excludedManualCases: doc.excludedManualCases ?? [], state: listing ? 'listing' : 'preflight', startedAt: new Date().toISOString() };
const saveStatus = () => fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
if (!listing) saveStatus();
console.log(`Selected ${cases.length} automated cases (${status.source}); ${status.excludedManualCases.length} manual cases excluded. Snapshot: ${snapshot}`);
const cli = path.join(ROOT, 'node_modules/@playwright/test/cli.js');
const run = extra => {
  const result = spawnSync(process.execPath, [cli, 'test', '--project=chromium', ...extra], { cwd: ROOT, env, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) {
    if (!listing) {
      status.state = status.state === 'preflight' ? 'blocked-before-execution' : 'failed';
      status.reason = result.error?.message ?? (status.state === 'blocked-before-execution'
        ? 'Session/environment preflight failed. No registration cases executed. Inspect the Playwright error; for an expired session run npm run auth.'
        : 'Registration execution failed. Inspect per-case results and Playwright evidence.');
      status.finishedAt = new Date().toISOString();
      saveStatus();
      console.error(`Pipeline status: ${statusPath}`);
    }
    process.exit(result.status || 1);
  }
};
// Expired sessions stop here instead of generating misleading failures for the
// entire workbook. Session refresh remains a human-owned step.
if (!listing) {
  run(['tests/modules/registration/session.spec.ts']);
  status.state = 'executing';
  saveStatus();
}
run(['tests/modules/registration/cases.spec.ts', ...args]);
if (!listing) {
  status.state = 'completed';
  status.finishedAt = new Date().toISOString();
  saveStatus();
  console.log(`Pipeline status: ${statusPath}`);
}
