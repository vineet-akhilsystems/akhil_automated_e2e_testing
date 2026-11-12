import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RegistrationPage } from '../../tests/modules/registration/registration.page';

let runner: typeof import('../../tests/modules/registration/case-runner');
let scratch: string;
let values: Record<string, string>;
let errors: Record<string, string>;
let saved: any;
const originalPageMethods = Object.getOwnPropertyDescriptors(RegistrationPage.prototype);

test('registered automation gaps return BLOCKED before accessing any page or application data', async ({}, info) => {
  const doc = JSON.parse(fs.readFileSync('qa/modules/registration/cases/registration-workbook-automation.json', 'utf8'));
  const c = doc.cases.find((c: any) => c.id === 'TC_REG_066');
  const result = await runner.runCase({} as Page, c, {}, info);
  expect(result.status).toBe('BLOCKED');
  expect(result.verificationPerformed).toBe(false);
  expect(result.registrationId).toBeUndefined();
  expect(result.actual).toContain('NOT AUTOMATED');
  await expect(runner.runCase({} as Page, { ...c, automationBlocker: 'Forged reason' }, {}, info)).rejects.toThrow(/No reviewed automation blocker/);
});
test.beforeAll(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-runner-check-'));
  process.env.PORTAL_RUN_DIR = scratch;
  process.env.REG_RUN_ID = 'assertion-checks';
  runner = await import('../../tests/modules/registration/case-runner');
  Object.assign(RegistrationPage.prototype, {
    open: async () => {}, openExisting: async () => {}, selectRegistrationType: async () => {},
    set: async (key: string, value: string) => { values[key] = value; },
    value: async (key: string) => values[key] ?? '', hint: async () => 'The hint text',
    fieldErrors: async () => errors, saveButton: () => ({ isDisabled: async () => false }),
    update: async () => ({ blocked: true, status: null, body: {}, toasts: [] }),
    save: async () => saved, duplicateModal: () => ({ isVisible: async () => false }),
    assertAgentRecord: async () => {},
  });
});
test.beforeEach(() => { values = {}; errors = {}; saved = { status: null, body: null, registrationId: null, toasts: [] }; });
test.afterAll(() => {
  Object.defineProperties(RegistrationPage.prototype, originalPageMethods);
  const resolved = fs.realpathSync(scratch);
  expect(path.dirname(resolved).toLowerCase()).toBe(fs.realpathSync(os.tmpdir()).toLowerCase());
  expect(path.basename(resolved)).toMatch(/^augastam-runner-check-/);
  fs.rmSync(resolved, { recursive: true, force: true });
});
const base = () => ({ id: 'REG-CHECK', title: 'Enforce the stated check', action: 'fill' as const, input: { mobile: '123' }, expected: { outcome: 'field-state' } });
test('fill actions enforce field-error checks and retain resolved execution inputs', async () => {
  errors = { 'Mobile No': 'Invalid number' };
  const r = await runner.runCase({} as Page, { ...base(), expected: { outcome: 'field-state', fieldErrors: { mobile: 'required' } } }, {}, {} as any);
  expect(r.status).toBe('FAIL'); expect(r.mismatches.join()).toContain('fieldError.mobile'); expect(r.resolvedInput?.mobile).toBe('123');
});
test('update actions enforce field-value and hint checks', async () => {
  const r = await runner.runCase({} as Page, { ...base(), action: 'update', target: 'synthetic-id', expected: { outcome: 'blocked', values: { mobile: 'different' }, hints: { mobile: 'missing hint' } } }, {}, {} as any);
  expect(r.status).toBe('FAIL'); expect(r.mismatches.join()).toContain('value.mobile'); expect(r.mismatches.join()).toContain('hint.mobile');
});
test('a requested persistence check fails when no record was saved', async () => {
  const r = await runner.runCase({} as Page, { ...base(), action: 'save', expected: { outcome: 'blocked', persisted: { mobile: '123' } } }, {}, {} as any);
  expect(r.status).toBe('FAIL'); expect(r.mismatches.join()).toContain('no successfully saved record');
});
test('upload placeholders cannot be ignored by the executor', async () => {
  await expect(runner.runCase({} as Page, { ...base(), input: { id_proof_file: 'fixture.pdf' } }, {}, {} as any)).rejects.toThrow('not connected');
});
test('stage evidence is attached for passing cases and screenshot errors become evidence warnings', async () => {
  const attached: Array<{ name: string; options: any }> = [];
  const annotations: Array<{ type: string; description?: string }> = [];
  let shouldFail = false;
  const fakePage = {
    screenshot: async ({ path: out }: { path: string }) => {
      if (shouldFail) throw new Error('Browser target closed');
      fs.writeFileSync(out, 'png');
    },
  } as unknown as Page;
  const fakeInfo = {
    outputPath: (name: string) => path.join(scratch, name),
    attach: async (name: string, options: any) => { attached.push({ name, options }); },
    annotations,
  } as any;
  const r1 = await runner.runCase(fakePage, base(), {}, fakeInfo);
  expect(r1.status).toBe('PASS');
  expect(attached.map(a => a.name)).toEqual(['REG-CHECK - Module opened', 'REG-CHECK - Inputs applied']);
  shouldFail = true;
  const r2 = await runner.runCase(fakePage, base(), {}, fakeInfo);
  expect(r2.status).toBe('PASS');
  expect(annotations.filter(a => a.type === 'evidence-warning')).toHaveLength(2);
  expect(annotations[0].description).toContain('screenshot unavailable');
});
