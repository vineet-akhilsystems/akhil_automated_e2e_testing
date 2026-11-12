import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = JSON.parse(fs.readFileSync(path.join(root, 'qa/modules/registration/cases/registration-business-cases.json'), 'utf8'));
const automation = JSON.parse(fs.readFileSync(path.join(root, 'qa/modules/registration/cases/registration-automation.json'), 'utf8'));
const plans = {
  14: 'mandatory-tab-traversal', 15: 'dropdown-keyboard', 18: 'search-identity', 21: 'partial-name-suggestions', 22: 'REG-WB-022', 23: 'REG-WB-023',
  25: 'title-gender', 26: 'dob-age', 27: 'REG-WB-027', 28: 'photo-upload', 33: 'duplicate-mobile-alert', 34: 'REG-WB-034', 35: 'country-mobile-code',
  36: 'pin-autofill', 37: 'address-copy', 42: 'REG-WB-042', 55: 'print-card', 56: 'print-form-complete',
  62: 'document-upload', 63: 'document-format', 65: 'duplicate-use-existing',
};
const blockers = {};
const set = (ids, reason) => ids.forEach(id => { blockers[id] = reason; });
set([1,2,3,4,5,6,7,8,9,10,24], 'Master-configuration automation is not implemented. Requires a resettable test tenant, expected configuration fixtures and create/verify/restore master workflows; registration field checks cannot verify this procedure.');
set([12,13,51], 'Requires separately configured authorized/restricted role profiles and cross-role assertions. Only the current login profile is available to this registration adapter.');
set([29], 'Requires a synthetic mother fixture and newborn-to-mother relationship verification. Entering a mother UHID alone does not establish the link.');
set([30,32], 'Requires synthetic employee/dependant HR fixtures and an HR lookup/link verification workflow. Staff control visibility alone does not verify HR integration.');
set([44,45,46,75], 'Requires insurer/TPA sandbox profiles, policy/plan fixtures and eligibility or billing assertions. This insurance integration workflow is not implemented.');
set([69,79], 'Requires an ABHA sandbox, approved OTP/identity fixtures and link/delink/history-access assertions. Opening the ABHA dialog does not verify this procedure.');
set([39,54,60], 'Requires synthetic WhatsApp/message recipients and delivery/availability evidence. Message integration assertions are not implemented; local controls or a QR download do not prove delivery.');
set([50,52,53], 'Requires department/downstream profiles and cross-module flag or alert assertions. Saving a flag alone does not verify downstream visibility or delivery.');
set([11], 'Language/transliteration workflow and an agreed input/expected translation fixture are not implemented.');
set([14], 'Full configured mandatory-field Tab traversal is not implemented. Existing keyboard checks cover only a subset and cannot satisfy this complete procedure.');
set([16], 'Requires the configured registration save shortcut and its save assertion. A mouse Save cannot satisfy a keyboard-only procedure.');
set([17], 'Help content navigation and manual/video/FAQ assertions are not implemented.');
set([19], 'Requires a synthetic pre-registration fixture and verification that registration consumes/inactivates its number.');
set([20], 'Requires an identity-number search fixture and patient identity checks for every search criterion; name/mobile outcome checks alone are insufficient.');
set([21], 'Pre-submit partial-name suggestion assertions are not implemented; submitting a search is a different workflow.');
set([28], 'Patient-photo upload and persisted-photo verification are not implemented. Document attachment automation does not verify a patient photo.');
set([31], 'Requires the agreed international-specific mandatory-field configuration and per-field blocking assertions.');
set([33], 'Mobile-entry duplicate triggering is not implemented in the adapter. The separate Save-triggered duplicate workflow cannot establish an alert on mobile entry alone.');
set([35], 'Country-to-mobile-dial-code transition assertions are not implemented.');
set([38], 'Repeated emergency-contact row creation and save/reopen assertions are not implemented.');
set([40,41], 'Requires configured Aadhaar/Emirates identity options and nationality-specific number validation. Current configured options differ from the source procedure.');
set([43], 'Requires corporate payer/plan fixtures and sponsor auto-selection assertions before any explicit sponsor fill.');
set([47], 'Requires a known doctor/specialization pairing and ordered bidirectional filtering assertions.');
set([48], 'External-provider link and camp conditional-field workflows are not implemented.');
set([49], 'Lead-source/narration control mapping and saved-value assertions are not implemented.');
set([56], 'Registration form printing checks currently verify patient identity, not all captured fields and layout required by this procedure. Full print-form content/layout assertions are not implemented.');
set([57,58], 'Wristband or original/duplicate print authorization workflows are not implemented; card/form identity checks cannot verify them.');
set([59], 'The source requires six post-save popup destinations. Current automation covers three Quick Actions routes only; the complete popup/destination workflow is not implemented.');
set([61,76,77], 'Requires audit-history access and actor/timestamp/old/new-value assertions. Current update workflows do not verify a complete audit trail.');
set([64], 'Requires a registration type with an agreed mandatory-document policy and save-blocking assertions.');
set([65], 'The source requires an explicit Check Duplicate action; the current screen exposes a Save-triggered prompt. That related workflow passes separately but does not execute the specified button sequence.');
set([66], 'Merge workflow is not implemented in the registration adapter; the local product source has a placeholder add-on. Requires two disposable UHIDs, primary/secondary merge assertions and secondary inactivation verification.');
set([67], 'Dedicated Quick Registration navigation, configured minimal fields and save assertions are not implemented.');
set([68], 'Family-head/member linking and Family ID assertions are not implemented.');
set([70], 'Requires inactive/deceased synthetic fixtures, transaction blocking and authorized reactivation checks. Canceling the status dialog is not equivalent.');
set([71,72,73], 'Bulk/group/digital-consent business workflows are not implemented in the adapter; the local product source exposes placeholder add-ons. Requires completed target functionality and full save/reopen assertions.');
set([74], 'Requires token/barcode and OPD display-board integration fixtures and assertions.');
set([78], 'Registration report navigation, filter fixtures and output reconciliation are not implemented.');
set([80], 'Requires OP Bill popup navigation and verification of prefilled billing patient details. The existing redirect URL check alone does not satisfy the source procedure.');

const cases = source.cases.map(original => {
  const n = Number(original.id.slice(-3));
  let plan;
  if (plans[n]?.startsWith('REG-')) plan = automation.cases.find(c => c.id === plans[n]);
  else if (plans[n]) {
    const flow = JSON.parse(fs.readFileSync(path.join(root, 'qa/modules/registration/workflows.json'), 'utf8'))[plans[n]];
    if (!flow) throw new Error(`Missing workflow ${plans[n]}`);
    plan = { action: 'workflow', input: { workflow: plans[n], ...(n === 21 ? { peer: '{{regId@REG-WB-022}}' } : {}) }, expected: { outcome: 'verified' }, ...(flow.savedRecord ? { target: '{{regId@REG-E2E-BASE}}' } : {}) };
  }
  if (plans[n] && !plan) throw new Error(`Missing executable plan for ${original.id}`);
  if (!plan && !blockers[n]) throw new Error(`Missing explicit decision for ${original.id}`);
  const result = { ...structuredClone(original), mode: 'automated',
    ...(plan ? Object.fromEntries(['action','input','expected','base','target','registrationType'].filter(k => plan[k] !== undefined).map(k => [k, structuredClone(plan[k])]))
      : { action: 'unavailable', input: {}, expected: { outcome: 'automation-blocked' }, automationBlocker: blockers[n] }),
    sourceWorkbook: source.source, automationReadiness: plan ? 'ready' : 'blocked',
    notes: `${original.notes.replace('Manual execution required; this procedure is not connected to browser automation.', '')}\nOriginal procedure and expected outcome are preserved below. ${plan ? 'Connected to executable browser assertions; a definition is not a passing result.' : 'NOT AUTOMATED: automatic runs report BLOCKED without application assertions; no manual result entry is requested.'}`.trim(),
  };
  result.expected.note = original.steps.map(s => s.expected).join('\n');
  if (n === 65) result.executionAdaptation = 'This build checks duplicates during Save. Execute Save, verify the matching-patient prompt before any extra create request, and select the existing UHID. This replaces the obsolete Check Duplicate button step without dropping duplicate detection or patient-identity assertions.';
  return result;
});
const output = path.join(root, 'qa/modules/registration/cases/registration-workbook-automation.json');
fs.writeFileSync(output, JSON.stringify({ module: 'registration', source: source.source, cases }, null, 2) + '\n');
const readyCount = cases.filter(c => c.action !== 'unavailable').length;
const report = `# Current registration workbook automation coverage

Of the 80 supplied workbook scenarios, **${readyCount} have executable browser mappings** and **${80 - readyCount} are not automated**. All original procedures and expected outcomes are preserved. The UI no longer requests manual results for these source IDs: runnable cases execute, while missing workflows return BLOCKED with a reason and execute no application assertions. Blocked cases are excluded from executable counts and never counted as passes. This is incomplete automation coverage, not an 80-case automated suite.

In Registration, search TC_REG_, select cases, and choose Run selected. The execution type is automatic, prerequisites are included and results/evidence appear under Test runs. An unavailable case displays Not automated before execution. Completed runs distinguish application assertion failures, execution errors and coverage blockers. Old manual run snapshots are preserved as history.

The source procedures and executable contracts are locked together to prevent accidental reduction of their assertions. Metadata remains editable; a changed procedure needs a reviewed mapping update. The original workbook and source JSON are preserved. Conversion backups are under .portal/migrations.

## Case decisions

| Original ID | Scenario | Readiness | Executable mapping or missing work |
|---|---|---|---|
${cases.map(c => `| ${c.id} | ${c.title.replace(/\|/g, '/')} | ${c.action === 'unavailable' ? 'NOT AUTOMATED / BLOCKED' : 'Executable; live result must be checked'} | ${(c.automationBlocker || (c.action === 'workflow' ? c.input.workflow : `${c.action}: ${c.expected.outcome}`)).replace(/\|/g, '/')} |`).join('\n')}

## Resources and implementation still needed

- Resettable UAT master configuration and expected fixture values, with create/verify/restore automation.
- Separate authorized/restricted profiles, synthetic HR/dependant/mother/pre-registration fixtures and their complete workflows.
- Insurance/TPA and ABHA sandbox fixtures, approved identity/OTP handling and integration assertions.
- Department, message delivery, audit/report and downstream billing verification access.
- Completed target functionality and automation for merge, bulk/group/family registration, digital consent, wristband and other currently missing features.

Adding profile credentials or setting a case's execution type does not implement a missing workflow. Ready means that code exists; it does not mean the test passed, and the live run may identify a product or requirements mismatch.
`;
fs.writeFileSync(path.join(root, 'docs/registration-workbook-current-coverage.md'), report);
const { validateCase } = await import('../../portal/registry.mjs');
const module = { adapter: 'registration', config: { bases: automation.bases } };
for (const c of cases) validateCase(c, module);
if (process.argv.includes('--import')) {
  const { openStore } = await import('../../portal/store.mjs');
  const directory = path.resolve(process.env.PORTAL_DATA_DIR || path.join(root, '.portal'));
  const store = openStore(directory);
  try {
    if (store.runs().some(r => ['running','queued'].includes(r.status))) throw new Error('Finish queued/running jobs before connecting workbook cases.');
    const previous = cases.map(c => store.case('registration', c.id)).filter(Boolean);
    const backupDir = path.join(directory, 'migrations'); fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, `registration-workbook-${Date.now()}.json`), JSON.stringify({ cases: previous }, null, 2));
    store.transaction(() => {
      for (const c of cases) {
        const old = store.case('registration', c.id);
        if (old && JSON.stringify(old.steps) !== JSON.stringify(c.steps)) throw new Error(`${c.id} has edited procedures; review its automation mapping before conversion. No cases changed.`);
        if (old && old.mode !== 'manual' && !old.sourceWorkbook) throw new Error(`${c.id} has an unreviewed automated definition; no cases changed.`);
        const contractKeys = ['action','input','expected','base','target','registrationType','automationBlocker','executionAdaptation'];
        if (old?.sourceWorkbook && contractKeys.every(key => JSON.stringify(old[key]) === JSON.stringify(c[key]))) continue;
        store.saveCase('registration', { ...c, ...(old ? { title: old.title, priority: old.priority, category: old.category, requirement: old.requirement, preconditions: old.preconditions, enabled: old.enabled } : {}) }, old?.version);
      }
    });
  } finally { store.close(); }
}
console.log(JSON.stringify({ total: cases.length, executable: readyCount, notAutomatedBlocked: 80 - readyCount, output }));
