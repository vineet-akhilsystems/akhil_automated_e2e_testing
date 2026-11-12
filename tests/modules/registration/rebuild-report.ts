// Rebuild the expected-vs-actual report from the newest run's results (or REG_RUN_ID), e.g. after a
// run was interrupted before Playwright's reporter could finish:  npm run reg:report
import fs from 'fs';
import path from 'path';
import type { CaseResult } from './case-runner.ts';
import { writeReport } from './report.ts';

const RUNS_DIR = 'qa/modules/registration/results/runs';
const runs = fs.existsSync(RUNS_DIR)
  ? fs.readdirSync(RUNS_DIR).filter((d) => fs.existsSync(path.join(RUNS_DIR, d, 'results.jsonl')))
  : [];
const runId = process.env.REG_RUN_ID ?? runs.sort((a, b) => fs.statSync(path.join(RUNS_DIR, b)).mtimeMs - fs.statSync(path.join(RUNS_DIR, a)).mtimeMs)[0];
if (!runId) {
  console.error('No run results yet; run some cases first (npm run reg:cases).');
  process.exit(1);
}
const byId = new Map<string, CaseResult>();
for (const line of fs.readFileSync(path.join(RUNS_DIR, runId, 'results.jsonl'), 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line) as CaseResult;
  byId.set(r.id, r); // a re-run case keeps its latest result
}
writeReport([...byId.values()], process.env.CASES_FILE ?? 'qa/modules/registration/cases/registration-cases.json').then((dir) =>
  console.log(`Rebuilt report from run ${runId} (${byId.size} cases): ${dir}`),
);
