import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import type { CaseResult } from './case-runner';
import { writeReport } from './report';

// Runs in the main Playwright process, so it survives the worker restarts that follow every
// failed test (an afterAll hook in the spec would fire once per worker and lose earlier results).
// Collects the `<id>-result.json` attachment of each registration case and writes the
// expected-vs-actual report once, at the end of the run.
export default class RegistrationResultsReporter implements Reporter {
  private results = new Map<string, CaseResult>();

  // Per-run files live in results/runs/<REG_RUN_ID>/ (tests/global-setup.ts); nothing is cleared here,
  // because onBegin also fires for `--list`, which IDE extensions run in the background.

  onTestEnd(test: TestCase, result: TestResult) {
    const att = result.attachments.find((a) => a.name.endsWith('-result.json') && a.body);
    if (att?.body) {
      const r = JSON.parse(att.body.toString()) as CaseResult;
      this.results.set(r.id, r);
    } else if (
      result.status === 'skipped' &&
      test.parent.title === 'Registration cases' &&
      !test.annotations.some((a) => a.description === 'not in CASES filter')
    ) {
      const [id, ...title] = test.title.split(' ');
      this.results.set(id, {
        id, title: title.join(' '), category: '', priority: '', status: 'SKIPPED',
        expected: '', actual: test.annotations.find((a) => a.type === 'skip')?.description ?? 'skipped',
        mismatches: [], toasts: [], fieldErrors: {}, values: {}, durationMs: 0,
      });
    }
  }

  async onEnd(_result: FullResult) {
    const ran = [...this.results.values()].filter((r) => r.status !== 'SKIPPED');
    if (!ran.length) return;
    const dir = await writeReport([...this.results.values()], process.env.CASES_FILE ?? 'qa/modules/registration/cases/registration-cases.json');
    console.log(`\nExpected-vs-actual report: ${dir}\\results.xlsx (and summary.md)`);
  }

  printsToStdio() {
    return false;
  }
}
