import { test, expect } from '../../fixtures/auth';
import { attachCaseResult, captureEvidence, readCasesSnapshot } from '../../fixtures/evidence';
import { CaseResult, ModuleCase, runCase } from './case-runner';

const snapshot = readCasesSnapshot<ModuleCase>();
const bases: Record<string, Record<string, string>> = snapshot.bases ?? {};
const cases: ModuleCase[] = snapshot.cases ?? [];

test.describe("EMR automated cases", () => {
  for (const c of cases) {
    test(`${c.id} ${c.title}`, async ({ page }, info) => {
      test.skip(c.enabled === false, 'Disabled in portal');
      let r: CaseResult;
      const started = Date.now();
      try {
        r = await runCase(page, c, bases, info);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        r = {
          id: c.id, title: c.title, category: c.category ?? '', priority: c.priority ?? 'P2',
          status: 'ERROR', verificationPerformed: false,
          expected: c.expected?.outcome ?? '', actual: `runner error: ${msg.split('\n')[0]}`,
          mismatches: [], toasts: [], fieldErrors: {}, values: {}, durationMs: Date.now() - started,
        };
        await captureEvidence(page, info, c.id, 'Execution error');
      }
      await captureEvidence(page, info, c.id, `Final result ${r.status}`);
      await attachCaseResult(info, r);
      expect(r.status === 'ERROR' ? r.actual : '', 'runner error').toBe('');
      expect(r.mismatches, `${c.id}: expected vs actual`).toEqual([]);
    });
  }
});
