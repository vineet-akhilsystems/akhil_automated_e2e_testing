import fs from 'fs';
import { execFileSync } from 'child_process';
import { test, expect } from '../../fixtures/auth';
import { CaseResult, RegCase, recordResult, runCase, blockedCaseResult } from './case-runner';
import { captureEvidence } from '../../fixtures/evidence';
import { moduleDir } from '../../shared/module-paths';

// The expected-vs-actual report is written by tests/modules/registration/results-reporter.ts
// from each case's `<id>-result.json` attachment.

// CASES_FILE=path/to/cases.xlsx npm test -- registration   (defaults to the JSON dataset)
// CASES=REG-001,REG-060                                    (run a subset)
const MASTER = `${moduleDir('qa', 'registration')}/cases/registration-cases.json`;
const CASES_FILE = process.env.CASES_FILE ?? MASTER;
const ONLY = (process.env.CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const master = JSON.parse(fs.readFileSync(/\.xlsx$/i.test(CASES_FILE) ? MASTER : CASES_FILE, 'utf8'));
const bases: Record<string, Record<string, string>> = master.bases ?? {};

// Test discovery is synchronous, so an Excel file is converted by the CLI in a child process.
const cases: RegCase[] = /\.xlsx$/i.test(CASES_FILE)
  ? JSON.parse(execFileSync(process.execPath, ['qa/tools/cases-io.js', 'print-xlsx', CASES_FILE]).toString())
  : master.cases;

test.describe('Registration cases', () => {
  for (const c of cases) {
    const selected = ONLY.length ? ONLY.includes(c.id) : c.enabled !== false;
    if (c.action === 'unavailable') {
      // No page/context fixture: missing automation does not log in, navigate,
      // create patients, capture a blank screenshot or ask for manual results.
      test(`${c.id} ${c.title}`, async ({}, info) => {
        test.skip(!selected, ONLY.length ? 'not in CASES filter' : c.notes ?? 'disabled in case file');
        const r = blockedCaseResult(c);
        recordResult(r);
        await info.attach(`${c.id}-result.json`, { body: JSON.stringify(r, null, 2), contentType: 'application/json' });
        info.annotations.push({ type: 'blocked', description: r.actual });
        test.skip(true, 'Automation is not implemented; the portal records the attached BLOCKED result. No application assertions executed.');
      });
      continue;
    }
    test(`${c.id} ${c.title}`, async ({ page }, info) => {
      test.skip(!selected, ONLY.length ? 'not in CASES filter' : c.notes ?? 'disabled in case file');
      let r: CaseResult;
      const started = Date.now();
      try {
        r = await runCase(page, c, bases, info);
      } catch (e: any) {
        r = {
          id: c.id, title: c.title, category: c.category ?? '', priority: c.priority ?? '', status: 'ERROR',
          expected: c.expected?.outcome ?? '', actual: `runner error: ${String(e?.message ?? e).split('\n')[0]}`,
          mismatches: [], toasts: [], fieldErrors: {}, values: {}, durationMs: Date.now() - started,
        };
        await captureEvidence(page, info, c.id, 'Execution error');
      }
      await captureEvidence(page, info, c.id, `Final result ${r.status}`);
      recordResult(r);
      await info.attach(`${c.id}-result.json`, { body: JSON.stringify(r, null, 2), contentType: 'application/json' });
      info.annotations.push({ type: 'expected', description: r.expected }, { type: 'actual', description: r.actual });
      if (r.status === 'OBSERVED') info.annotations.push({ type: 'observed', description: 'Recorded only; no requirement to compare against.' });
      // PAUSE_ON_FAIL=1 (headed): stop on the failing screen with the Playwright Inspector open,
      // so a tester can look at the live page before the next case starts.
      if (process.env.PAUSE_ON_FAIL && !['PASS', 'OBSERVED'].includes(r.status)) {
        console.log(`\n${c.id} ${r.status}\n  expected: ${r.expected}\n  actual:   ${r.actual}\n  ${r.mismatches.join('\n  ')}\nPaused - press Resume in the Inspector to continue.`);
        await page.pause();
      }

      expect.soft(r.status === 'ERROR' ? r.actual : '', 'runner error').toBe('');
      expect.soft(r.mismatches, `${c.id}: expected vs actual`).toEqual([]);
    });
  }
});
