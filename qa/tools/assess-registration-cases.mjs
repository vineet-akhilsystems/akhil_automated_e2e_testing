import fs from 'node:fs';
import { ROOT } from '../../portal/registry.mjs';
import path from 'node:path';

const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'qa/modules/registration/cases/registration-business-cases.json'), 'utf8'));
const ready = {
  22: 'REG-001: save synthetic mandatory data, assert created UHID and reopen saved record.',
  23: 'REG-010: save empty form, assert blocked and required-field toast.',
  27: 'REG-004: enter age with DOB initially empty, save and assert creation. Generated DOB is allowed by the source.',
  34: 'REG-020/021/022: select India and assert invalid mobile rejection or input limit using explicit test values.',
  42: 'REG-070 plus save: select Self-Paid/Cash, assert creation without corporate or insurance inputs.',
};
const partial = {
  18: 'REG-210 searches a prior UHID and asserts found; add explicit patient-detail auto-fill checks after search.',
  20: 'Name and phone search exist; Aadhar lookup and correct patient-result matching are not asserted.',
  21: 'Search can submit a partial name; suggestion-list behavior before Enter is not implemented.',
  25: 'REG-223 checks Mrs. -> Female (assumed rule); one case cannot perform and assert both ordered title changes.',
  26: 'DOB and age fields can be read; add date-derived expected age across multiple dates/day boundaries.',
  29: 'REG-227 saves/reopens mother UHID and parent names; does not prove the mother-child relationship outside those fields.',
  30: 'Staff variant exists; employee ID field and HR data-fetch verification are missing.',
  31: 'International variant/save exists; map configured extra mandatory fields and assert each missing-field block.',
  33: 'Duplicate modal detection exists; does not select Use Existing or verify the selected patient.',
  35: 'Country can be selected; mobile dialing-code control is not mapped or asserted.',
  36: 'REG-060 checks PIN-derived country/state/district/city; area currently requires explicit selection, so source auto-fill expectation needs configuration confirmation.',
  37: 'mark_permanent checkbox exists; permanent-address tab fields are not mapped for copied-value assertions.',
  38: 'One emergency contact can be filled/saved; Add Person and repeated contact rows are not implemented.',
  40: 'ID type/number can be entered; type-specific visibility and validation require explicit mapping and rules.',
  41: 'Country and ID type fields exist; nationality field and available-option assertions are missing.',
  43: 'REG-172 covers Corporate save; Plan is unmapped and sponsor auto-selection is not checked before an explicit fill.',
  47: 'Department/consultant fields exist; ordered bidirectional selection and filtered-option assertions are missing.',
  48: 'Referred Type can be selected; conditional external-provider links and camp subfields are unmapped.',
  61: 'REG-111 updates/reopens a field with generated remarks; cannot submit empty remarks and verify mandatory validation or audit trail.',
  65: 'REG-090 saves identical inputs twice and detects duplicates; explicit Check Duplicate click and configured-rule workflow are missing.',
};
const count = { ready: 0, partial: 0, new: 0 };
const rows = source.cases.map(c => {
  const n = Number(c.id.slice(-3));
  const status = ready[n] ? 'ready' : partial[n] ? 'partial' : 'new';
  count[status]++;
  const reason = ready[n] || partial[n] || `No implemented actions/assertions for ${c.title.replace(/^Verify /, '')}. Requires a new page flow, controls and outcome checks.`;
  return `| ${c.id} | ${c.title} | ${status} | ${reason} |`;
});
if (source.cases.length !== 80) throw new Error('Expected all 80 source cases.');
const report = `# Registration workbook automation assessment

This is the baseline assessment from before the workflow expansion. See [current implementation and remaining resources](registration-e2e-progress.md) for the new 33-case suite; the counts below describe the earlier adapter capabilities.

Reviewed against the current local implementation on 2026-11-04. This is a code capability assessment, not a live application test or a claim that the cases pass.

Of 80 workbook scenarios: **${count.ready} ready to express with the existing adapter**, **${count.partial} partially supported**, **${count.new} require new automation**.

All 80 imported TC_REG cases are currently manual. The executor does not interpret their natural-language steps. Ready cases still need structured automated definitions (action, input, expected assertions), test data and a controlled application run. Existing REG IDs below identify reusable logic; they do not establish exact workbook coverage. Existing assumed expectations remain business-rule assumptions.

## Implementation evidence

- tests/modules/registration/fields.ts maps supported controls; permanent-address fields, employee ID, policy details, photo, promotional consent and audit controls are absent.
- tests/modules/registration/case-runner.ts supports fill/save/saveTwice/saveDoubleClick/search/update; it compares values, field errors, hints, toasts and persisted values. It does not execute ordered manual procedures.
- tests/modules/registration/registration.page.ts implements registration navigation, one-pass field filling, save, update with generated nonempty remarks, duplicate-dialog detection and search. Search checks found/not-found rather than patient identity or suggestion correctness.
- portal/registry.mjs validates supported actions, registration variants and checks. Staff Dependent is not a supported variant. Upload automation is explicitly pending.
- qa/modules/registration/cases/registration-cases.json contains the reusable REG definitions referenced below.

## Case matrix

Ready means no executor feature change is needed after choosing concrete inputs and configured option values. Partial means some actions exist but the complete source expectation cannot be verified. New means the defining workflow has no implementation in this adapter.

| Source ID | Scenario | Capability | Reuse / missing work |
|---|---|---|---|
${rows.join('\n')}

## Recommended implementation sequence

1. Convert TC_REG_022, 023, 027, 034 and 042 to explicit automated definitions, reusing existing synthetic data and assertions; validate them in a controlled run.
2. Extend ordered interactions/assertions for title/gender, DOB accuracy, search result identity, copied permanent address, mandatory update remarks and explicit duplicate selection.
3. Add separate page flows for master configuration, role/facility permissions, documents/printing, payer integrations, ABHA, audit and downstream billing. Keep their manual cases until the full stated outcome is verified.

Do not mark a whole scenario automated merely because its initial fields can be filled. No cases, results or execution modes were changed during this assessment.
`;
fs.writeFileSync(path.join(ROOT, 'docs/registration-workbook-automation-assessment.md'), report);
console.log(JSON.stringify({ total: source.cases.length, ...count }));
