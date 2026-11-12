# Registration workbook automation assessment

This is the baseline assessment from before the workflow expansion. See [current implementation and remaining resources](registration-e2e-progress.md) for the new 33-case suite; the counts below describe the earlier adapter capabilities.

Reviewed against the current local implementation on 2026-11-04. This is a code capability assessment, not a live application test or a claim that the cases pass.

Of 80 workbook scenarios: **5 ready to express with the existing adapter**, **20 partially supported**, **55 require new automation**.

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
| TC_REG_001 | Verify registration types are configurable | new | No implemented actions/assertions for registration types are configurable. Requires a new page flow, controls and outcome checks. |
| TC_REG_002 | Verify configurable workflow steps | new | No implemented actions/assertions for configurable workflow steps. Requires a new page flow, controls and outcome checks. |
| TC_REG_003 | Verify combination workflow support | new | No implemented actions/assertions for combination workflow support. Requires a new page flow, controls and outcome checks. |
| TC_REG_004 | Verify registration type can be tagged to specific workflow | new | No implemented actions/assertions for registration type can be tagged to specific workflow. Requires a new page flow, controls and outcome checks. |
| TC_REG_005 | Verify document category configuration | new | No implemented actions/assertions for document category configuration. Requires a new page flow, controls and outcome checks. |
| TC_REG_006 | Verify title lookup list creation | new | No implemented actions/assertions for title lookup list creation. Requires a new page flow, controls and outcome checks. |
| TC_REG_007 | Verify gender lookup list | new | No implemented actions/assertions for gender lookup list. Requires a new page flow, controls and outcome checks. |
| TC_REG_008 | Verify configurable duplicate check fields | new | No implemented actions/assertions for configurable duplicate check fields. Requires a new page flow, controls and outcome checks. |
| TC_REG_009 | Verify registration charge business rules | new | No implemented actions/assertions for registration charge business rules. Requires a new page flow, controls and outcome checks. |
| TC_REG_010 | Verify default settings based on registration type | new | No implemented actions/assertions for default settings based on registration type. Requires a new page flow, controls and outcome checks. |
| TC_REG_011 | Verify language translation in registration | new | No implemented actions/assertions for language translation in registration. Requires a new page flow, controls and outcome checks. |
| TC_REG_012 | Verify facility change by authorized user | new | No implemented actions/assertions for facility change by authorized user. Requires a new page flow, controls and outcome checks. |
| TC_REG_013 | Verify facility change blocked for unauthorized user | new | No implemented actions/assertions for facility change blocked for unauthorized user. Requires a new page flow, controls and outcome checks. |
| TC_REG_014 | Verify tab navigation across mandatory fields | new | No implemented actions/assertions for tab navigation across mandatory fields. Requires a new page flow, controls and outcome checks. |
| TC_REG_015 | Verify keyboard navigation in dropdowns | new | No implemented actions/assertions for keyboard navigation in dropdowns. Requires a new page flow, controls and outcome checks. |
| TC_REG_016 | Verify keyboard shortcut to save registration | new | No implemented actions/assertions for keyboard shortcut to save registration. Requires a new page flow, controls and outcome checks. |
| TC_REG_017 | Verify Help icon availability and functionality | new | No implemented actions/assertions for Help icon availability and functionality. Requires a new page flow, controls and outcome checks. |
| TC_REG_018 | Search patient by UHID | partial | REG-210 searches a prior UHID and asserts found; add explicit patient-detail auto-fill checks after search. |
| TC_REG_019 | Search patient by pre-registration number | new | No implemented actions/assertions for Search patient by pre-registration number. Requires a new page flow, controls and outcome checks. |
| TC_REG_020 | Verify magic search by multiple criteria | partial | Name and phone search exist; Aadhar lookup and correct patient-result matching are not asserted. |
| TC_REG_021 | Magic search with partial name | partial | Search can submit a partial name; suggestion-list behavior before Enter is not implemented. |
| TC_REG_022 | Verify new patient registration with all mandatory fields | ready | REG-001: save synthetic mandatory data, assert created UHID and reopen saved record. |
| TC_REG_023 | Verify UHID not generated without mandatory fields | ready | REG-010: save empty form, assert blocked and required-field toast. |
| TC_REG_024 | Verify UHID format is alphanumeric as configured | new | No implemented actions/assertions for UHID format is alphanumeric as configured. Requires a new page flow, controls and outcome checks. |
| TC_REG_025 | Verify auto-gender selection on title change | partial | REG-223 checks Mrs. -> Female (assumed rule); one case cannot perform and assert both ordered title changes. |
| TC_REG_026 | Verify age auto-calculation from DOB | partial | DOB and age fields can be read; add date-derived expected age across multiple dates/day boundaries. |
| TC_REG_027 | Verify age entry when DOB is unknown | ready | REG-004: enter age with DOB initially empty, save and assert creation. Generated DOB is allowed by the source. |
| TC_REG_028 | Verify manual patient photo upload | new | No implemented actions/assertions for manual patient photo upload. Requires a new page flow, controls and outcome checks. |
| TC_REG_029 | Verify newborn registration tagged with mother UHID | partial | REG-227 saves/reopens mother UHID and parent names; does not prove the mother-child relationship outside those fields. |
| TC_REG_030 | Verify staff registration with employee ID | partial | Staff variant exists; employee ID field and HR data-fetch verification are missing. |
| TC_REG_031 | Verify mandatory fields for international patient | partial | International variant/save exists; map configured extra mandatory fields and assert each missing-field block. |
| TC_REG_032 | Verify staff dependent registration | new | No implemented actions/assertions for staff dependent registration. Requires a new page flow, controls and outcome checks. |
| TC_REG_033 | Verify duplicate mobile number alert | partial | Duplicate modal detection exists; does not select Use Existing or verify the selected patient. |
| TC_REG_034 | Verify mobile number length validation by country | ready | REG-020/021/022: select India and assert invalid mobile rejection or input limit using explicit test values. |
| TC_REG_035 | Verify mobile country code auto-selects with country | partial | Country can be selected; mobile dialing-code control is not mapped or asserted. |
| TC_REG_036 | Verify pin code auto-fills address fields | partial | REG-060 checks PIN-derived country/state/district/city; area currently requires explicit selection, so source auto-fill expectation needs configuration confirmation. |
| TC_REG_037 | Verify present address copies to permanent address | partial | mark_permanent checkbox exists; permanent-address tab fields are not mapped for copied-value assertions. |
| TC_REG_038 | Verify multiple emergency contacts can be added | partial | One emergency contact can be filled/saved; Add Person and repeated contact rows are not implemented. |
| TC_REG_039 | Verify WhatsApp availability check on mobile number | new | No implemented actions/assertions for WhatsApp availability check on mobile number. Requires a new page flow, controls and outcome checks. |
| TC_REG_040 | Verify identity type linked to identity number field | partial | ID type/number can be entered; type-specific visibility and validation require explicit mapping and rules. |
| TC_REG_041 | Verify nationality-based identity options | partial | Country and ID type fields exist; nationality field and available-option assertions are missing. |
| TC_REG_042 | Verify self-pay payer type selection | ready | REG-070 plus save: select Self-Paid/Cash, assert creation without corporate or insurance inputs. |
| TC_REG_043 | Verify corporate payer selection | partial | REG-172 covers Corporate save; Plan is unmapped and sponsor auto-selection is not checked before an explicit fill. |
| TC_REG_044 | Verify insurance payer details capture | new | No implemented actions/assertions for insurance payer details capture. Requires a new page flow, controls and outcome checks. |
| TC_REG_045 | Verify system blocks transactions after insurance expiry | new | No implemented actions/assertions for system blocks transactions after insurance expiry. Requires a new page flow, controls and outcome checks. |
| TC_REG_046 | Verify insurance eligibility check | new | No implemented actions/assertions for insurance eligibility check. Requires a new page flow, controls and outcome checks. |
| TC_REG_047 | Verify referral doctor and specialization auto-link | partial | Department/consultant fields exist; ordered bidirectional selection and filtered-option assertions are missing. |
| TC_REG_048 | Verify referred type options and sub-fields | partial | Referred Type can be selected; conditional external-provider links and camp subfields are unmapped. |
| TC_REG_049 | Verify lead source capture and narration | new | No implemented actions/assertions for lead source capture and narration. Requires a new page flow, controls and outcome checks. |
| TC_REG_050 | Verify VIP patient color coding in other modules | new | No implemented actions/assertions for VIP patient color coding in other modules. Requires a new page flow, controls and outcome checks. |
| TC_REG_051 | Verify confidential patient name and address masking | new | No implemented actions/assertions for confidential patient name and address masking. Requires a new page flow, controls and outcome checks. |
| TC_REG_052 | Verify handle with care flag visible across modules | new | No implemented actions/assertions for handle with care flag visible across modules. Requires a new page flow, controls and outcome checks. |
| TC_REG_053 | Verify vulnerable patient alert to concerned department | new | No implemented actions/assertions for vulnerable patient alert to concerned department. Requires a new page flow, controls and outcome checks. |
| TC_REG_054 | Verify promotional consent checkbox saves preference | new | No implemented actions/assertions for promotional consent checkbox saves preference. Requires a new page flow, controls and outcome checks. |
| TC_REG_055 | Verify registration card print | new | No implemented actions/assertions for registration card print. Requires a new page flow, controls and outcome checks. |
| TC_REG_056 | Verify registration form print | new | No implemented actions/assertions for registration form print. Requires a new page flow, controls and outcome checks. |
| TC_REG_057 | Verify outpatient wristband print | new | No implemented actions/assertions for outpatient wristband print. Requires a new page flow, controls and outcome checks. |
| TC_REG_058 | Verify duplicate printout marked accordingly | new | No implemented actions/assertions for duplicate printout marked accordingly. Requires a new page flow, controls and outcome checks. |
| TC_REG_059 | Verify post-save redirect options | new | No implemented actions/assertions for post-save redirect options. Requires a new page flow, controls and outcome checks. |
| TC_REG_060 | Verify QR code generation on save | new | No implemented actions/assertions for QR code generation on save. Requires a new page flow, controls and outcome checks. |
| TC_REG_061 | Verify patient record update with mandatory remarks | partial | REG-111 updates/reopens a field with generated remarks; cannot submit empty remarks and verify mandatory validation or audit trail. |
| TC_REG_062 | Verify document upload against patient UHID | new | No implemented actions/assertions for document upload against patient UHID. Requires a new page flow, controls and outcome checks. |
| TC_REG_063 | Verify invalid document format rejected | new | No implemented actions/assertions for invalid document format rejected. Requires a new page flow, controls and outcome checks. |
| TC_REG_064 | Verify mandatory documents enforced per registration type | new | No implemented actions/assertions for mandatory documents enforced per registration type. Requires a new page flow, controls and outcome checks. |
| TC_REG_065 | Verify duplicate registration detection | partial | REG-090 saves identical inputs twice and detects duplicates; explicit Check Duplicate click and configured-rule workflow are missing. |
| TC_REG_066 | Verify merging duplicate registrations | new | No implemented actions/assertions for merging duplicate registrations. Requires a new page flow, controls and outcome checks. |
| TC_REG_067 | Verify quick registration with minimal fields | new | No implemented actions/assertions for quick registration with minimal fields. Requires a new page flow, controls and outcome checks. |
| TC_REG_068 | Verify family linking and family ID creation | new | No implemented actions/assertions for family linking and family ID creation. Requires a new page flow, controls and outcome checks. |
| TC_REG_069 | Verify ABHA ID creation and linking | new | No implemented actions/assertions for ABHA ID creation and linking. Requires a new page flow, controls and outcome checks. |
| TC_REG_070 | Verify UHID inactivation for deceased patient | new | No implemented actions/assertions for UHID inactivation for deceased patient. Requires a new page flow, controls and outcome checks. |
| TC_REG_071 | Verify bulk registration via Excel upload | new | No implemented actions/assertions for bulk registration via Excel upload. Requires a new page flow, controls and outcome checks. |
| TC_REG_072 | Verify group registration with auto-fill | new | No implemented actions/assertions for group registration with auto-fill. Requires a new page flow, controls and outcome checks. |
| TC_REG_073 | Verify digital consent form creation and e-signature | new | No implemented actions/assertions for digital consent form creation and e-signature. Requires a new page flow, controls and outcome checks. |
| TC_REG_074 | Verify token number generation and queue display | new | No implemented actions/assertions for token number generation and queue display. Requires a new page flow, controls and outcome checks. |
| TC_REG_075 | Verify insurance eligibility integration | new | No implemented actions/assertions for insurance eligibility integration. Requires a new page flow, controls and outcome checks. |
| TC_REG_076 | Verify audit fields auto-populate on registration | new | No implemented actions/assertions for audit fields auto-populate on registration. Requires a new page flow, controls and outcome checks. |
| TC_REG_077 | Verify complete audit trail of field changes | new | No implemented actions/assertions for complete audit trail of field changes. Requires a new page flow, controls and outcome checks. |
| TC_REG_078 | Verify dynamic registration report | new | No implemented actions/assertions for dynamic registration report. Requires a new page flow, controls and outcome checks. |
| TC_REG_079 | Verify ABHA link and delink functionality | new | No implemented actions/assertions for ABHA link and delink functionality. Requires a new page flow, controls and outcome checks. |
| TC_REG_080 | Verify redirect from registration to OPD invoice | new | No implemented actions/assertions for redirect from registration to OPD invoice. Requires a new page flow, controls and outcome checks. |

## Recommended implementation sequence

1. Convert TC_REG_022, 023, 027, 034 and 042 to explicit automated definitions, reusing existing synthetic data and assertions; validate them in a controlled run.
2. Extend ordered interactions/assertions for title/gender, DOB accuracy, search result identity, copied permanent address, mandatory update remarks and explicit duplicate selection.
3. Add separate page flows for master configuration, role/facility permissions, documents/printing, payer integrations, ABHA, audit and downstream billing. Keep their manual cases until the full stated outcome is verified.

Do not mark a whole scenario automated merely because its initial fields can be filled. No cases, results or execution modes were changed during this assessment.
