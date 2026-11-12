// Registration agent hooks (reference files and cross-field examples), moved verbatim from portal/agent.mjs.
// Must not import portal/registry.mjs (avoids import cycles).
export const registrationAgent = {
  referenceDir: 'tests/modules/registration',
  referenceLabel: 'Registration',
  referenceFirst: ['fields.ts', 'registration.page.ts', 'case-runner.ts', 'cases.spec.ts', 'workflow-runner.ts'],
  crossFieldExamples: () => 'conflicting title/gender, minor without guardian, payer type without payer/policy'
};
