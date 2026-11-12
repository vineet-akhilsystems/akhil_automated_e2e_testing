// Registration case-validation hooks (moved verbatim from portal/registry.mjs validateCase).
// Must not import portal/registry.mjs (avoids import cycles); check/textValue arrive through ctx.
// Hook names, call positions and signatures are documented in portal/modules/contract.mjs.
import { isDeepStrictEqual } from 'node:util';
import { registrationWorkflows, workbookAutomation } from './adapter.mjs';

export const registrationValidate = {
  afterOutcome(c, { check }) {
    if (workbookAutomation.cases.some(source => source.id === c.id)) check(c.sourceWorkbook, 'Original workbook IDs require their reviewed source mapping.');
    if (c.sourceWorkbook) {
      const source = workbookAutomation.cases.find(source => source.id === c.id);
      check(source && c.sourceWorkbook === source.sourceWorkbook && isDeepStrictEqual(c.steps, source.steps), 'Workbook procedure changed or has no reviewed automation mapping. Review its mapping before running.');
      for (const key of ['action', 'input', 'expected', 'base', 'target', 'registrationType', 'automationBlocker', 'executionAdaptation']) {
        check(isDeepStrictEqual(c[key], source[key]), 'Workbook automation contract changed. Update and review the source mapping instead of weakening its assertions.');
      }
    }
  },
  blockedSource(c) {
    return workbookAutomation.cases.find(source => source.id === c.id);
  },
  checkInput(key, value, { check }) {
    if (key === 'id_proof_file') check(value === 'qa/modules/registration/data/agent-test-id-proof.pdf', 'Use the provided synthetic ID-proof fixture.');
  },
  workflow(c, { check, textValue }) {
    if (c.action !== 'workflow') return false;
    check(Object.hasOwn(registrationWorkflows, c.input.workflow), 'Choose a supported registration workflow key.');
    const workflow = registrationWorkflows[c.input.workflow];
    check(workflow, 'Choose a supported registration workflow key.');
    check(c.expected.outcome === 'verified', 'Registration workflows require the verified outcome.');
    check(!c.base && !c.registrationType, 'Registration workflows manage their own data and variant; remove starting template and registration type.');
    check(Object.keys(c.input).every(k => ['workflow', 'email', 'peer'].includes(k)), 'Registration workflows accept only workflow and supported optional inputs.');
    if (c.input.workflow === 'partial-name-suggestions') textValue(c.input.peer, 'Second synthetic patient prerequisite', 200, true);
    else check(!Object.hasOwn(c.input, 'peer'), 'Peer patient is only supported by the partial-name suggestions workflow.');
    if (Object.hasOwn(c.input, 'email')) check(['update-remarks', 'update-persist'].includes(c.input.workflow), 'Email input is only supported by update workflows.');
    check(!['values', 'fieldErrors', 'persisted', 'hints'].some(k => Object.keys(c.expected[k] ?? {}).length) && !c.expected.toastContains && c.expected.saveDisabled === undefined, 'Workflow checks are defined by the selected workflow; separate field/toast checks are unsupported.');
    check(!c.expected.assumed, 'Workflow assertions cannot be marked assumed.');
    if (workflow.savedRecord) textValue(c.target, 'Synthetic patient ID or dependency token', 200, true);
    else check(!c.target, 'This workflow starts with a blank registration. Remove the patient target.');
    return true;
  },
  afterWorkflow(c, { check }) {
    check(!Object.hasOwn(c.input, 'workflow'), 'Workflow key can only be used with a workflow action.');
    check(!Object.hasOwn(c.input, 'peer'), 'Peer patient can only be used with the partial-name workflow.');
    check(c.expected.outcome !== 'verified', 'Verified outcome requires a workflow action.');
    if (c.enabled && c.input.id_proof_file) check(false, 'ID-proof upload automation is pending. Keep this case disabled or use manual execution.');
  },
};
