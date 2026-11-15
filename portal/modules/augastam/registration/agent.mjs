// Registration agent hooks (reference files and cross-field examples), moved verbatim from portal/agent.mjs.
// Must not import portal/registry.mjs (avoids import cycles).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveModuleFolder } from '../../../module-layout.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const registrationAgent = {
  referenceDir: resolveModuleFolder(ROOT, 'tests', 'augastam', 'registration'), // repo-relative
  referenceLabel: 'Registration',
  referenceFirst: ['fields.ts', 'registration.page.ts', 'case-runner.ts', 'cases.spec.ts', 'workflow-runner.ts'],
  crossFieldExamples: () => 'conflicting title/gender, minor without guardian, payer type without payer/policy'
};
