# Current registration workbook automation coverage

Of the 80 supplied workbook scenarios, **21 have executable browser mappings** and **59 are not automated**. All original procedures and expected outcomes are preserved. The UI no longer requests manual results for these source IDs: runnable cases execute, while missing workflows return BLOCKED with a reason and execute no application assertions. Blocked cases are excluded from executable counts and never counted as passes. This is incomplete automation coverage, not an 80-case automated suite.

In Registration, search TC_REG_, select cases, and choose Run selected. The execution type is automatic, prerequisites are included and results/evidence appear under Test runs. An unavailable case displays Not automated before execution. Completed runs distinguish application assertion failures, execution errors and coverage blockers. Old manual run snapshots are preserved as history.

The source procedures and executable contracts are locked together to prevent accidental reduction of their assertions. Metadata remains editable; a changed procedure needs a reviewed mapping update. The original workbook and source JSON are preserved. Conversion backups are under .portal/migrations.

## Case decisions

| Original ID | Scenario | Readiness | Executable mapping or missing work |
|---|---|---|---|
| TC_REG_001 | Verify registration types are configurable | NOT AUTOMATED / BLOCKED | Master-configuration automation is not implemented. Requires a resettable test tenant, expected configuration fixtures and create/verify/restore master workflows; registration field checks cannot verify this procedure. |
| TC_REG_002 | Verify configurable workflow steps | NOT AUTOMATED / BLOCKED | Master-configuration automation is not implemented. Requires a resettable test tenant, expected configuration fixtures and create/verify/restore master workflows; registration field checks cannot verify this procedure. |
| TC_REG_003 | Verify combination workflow support | NOT AUTOMATED / BLOCKED | Master-configuration automation is not implemented. Requires a resettable test tenant, expected configuration fixtures and create/verify/restore master workflows; registration field checks cannot verify this procedure. |
| TC_REG_004 | Verify registration type can be tagged to specific workflow | NOT AUTOMATED / BLOCKED | Master-configuration automation is not implemented. Requires a resettable test tenant, expected configuration fixtures and create/verify/restore master workflows; registration field checks cannot verify this procedure. |
| TC_REG_005 | Verify document category configuration | NOT AUTOMATED / BLOCKED | Master-configuration automation is not implemented. Requires a resettable test tenant, expected configuration fixtures and create/verify/restore master workflows; registration field checks cannot verify this procedure. |
| TC_REG_006 | Verify title lookup list creation | NOT AUTOMATED / BLOCKED | Master-configuration automation is not implemented. Requires a resettable test tenant, expected configuration fixtures and create/verify/restore master workflows; registration field checks cannot verify this procedure. |
| TC_REG_007 | Verify gender lookup list | NOT AUTOMATED / BLOCKED | Master-configuration automation is not implemented. Requires a resettable test tenant, expected configuration fixtures and create/verify/restore master workflows; registration field checks cannot verify this procedure. |
| TC_REG_008 | Verify configurable duplicate check fields | NOT AUTOMATED / BLOCKED | Master-configuration automation is not implemented. Requires a resettable test tenant, expected configuration fixtures and create/verify/restore master workflows; registration field checks cannot verify this procedure. |
| TC_REG_009 | Verify registration charge business rules | NOT AUTOMATED / BLOCKED | Master-configuration automation is not implemented. Requires a resettable test tenant, expected configuration fixtures and create/verify/restore master workflows; registration field checks cannot verify this procedure. |
| TC_REG_010 | Verify default settings based on registration type | NOT AUTOMATED / BLOCKED | Master-configuration automation is not implemented. Requires a resettable test tenant, expected configuration fixtures and create/verify/restore master workflows; registration field checks cannot verify this procedure. |
| TC_REG_011 | Verify language translation in registration | NOT AUTOMATED / BLOCKED | Language/transliteration workflow and an agreed input/expected translation fixture are not implemented. |
| TC_REG_012 | Verify facility change by authorized user | NOT AUTOMATED / BLOCKED | Requires separately configured authorized/restricted role profiles and cross-role assertions. Only the current login profile is available to this registration adapter. |
| TC_REG_013 | Verify facility change blocked for unauthorized user | NOT AUTOMATED / BLOCKED | Requires separately configured authorized/restricted role profiles and cross-role assertions. Only the current login profile is available to this registration adapter. |
| TC_REG_014 | Verify tab navigation across mandatory fields | Executable; live result must be checked | mandatory-tab-traversal |
| TC_REG_015 | Verify keyboard navigation in dropdowns | Executable; live result must be checked | dropdown-keyboard |
| TC_REG_016 | Verify keyboard shortcut to save registration | NOT AUTOMATED / BLOCKED | Requires the configured registration save shortcut and its save assertion. A mouse Save cannot satisfy a keyboard-only procedure. |
| TC_REG_017 | Verify Help icon availability and functionality | NOT AUTOMATED / BLOCKED | Help content navigation and manual/video/FAQ assertions are not implemented. |
| TC_REG_018 | Search patient by UHID | Executable; live result must be checked | search-identity |
| TC_REG_019 | Search patient by pre-registration number | NOT AUTOMATED / BLOCKED | Requires a synthetic pre-registration fixture and verification that registration consumes/inactivates its number. |
| TC_REG_020 | Verify magic search by multiple criteria | NOT AUTOMATED / BLOCKED | Requires an identity-number search fixture and patient identity checks for every search criterion; name/mobile outcome checks alone are insufficient. |
| TC_REG_021 | Magic search with partial name | Executable; live result must be checked | partial-name-suggestions |
| TC_REG_022 | Verify new patient registration with all mandatory fields | Executable; live result must be checked | save: created |
| TC_REG_023 | Verify UHID not generated without mandatory fields | Executable; live result must be checked | save: blocked |
| TC_REG_024 | Verify UHID format is alphanumeric as configured | NOT AUTOMATED / BLOCKED | Master-configuration automation is not implemented. Requires a resettable test tenant, expected configuration fixtures and create/verify/restore master workflows; registration field checks cannot verify this procedure. |
| TC_REG_025 | Verify auto-gender selection on title change | Executable; live result must be checked | title-gender |
| TC_REG_026 | Verify age auto-calculation from DOB | Executable; live result must be checked | dob-age |
| TC_REG_027 | Verify age entry when DOB is unknown | Executable; live result must be checked | save: created |
| TC_REG_028 | Verify manual patient photo upload | Executable; live result must be checked | photo-upload |
| TC_REG_029 | Verify newborn registration tagged with mother UHID | NOT AUTOMATED / BLOCKED | Requires a synthetic mother fixture and newborn-to-mother relationship verification. Entering a mother UHID alone does not establish the link. |
| TC_REG_030 | Verify staff registration with employee ID | NOT AUTOMATED / BLOCKED | Requires synthetic employee/dependant HR fixtures and an HR lookup/link verification workflow. Staff control visibility alone does not verify HR integration. |
| TC_REG_031 | Verify mandatory fields for international patient | NOT AUTOMATED / BLOCKED | Requires the agreed international-specific mandatory-field configuration and per-field blocking assertions. |
| TC_REG_032 | Verify staff dependent registration | NOT AUTOMATED / BLOCKED | Requires synthetic employee/dependant HR fixtures and an HR lookup/link verification workflow. Staff control visibility alone does not verify HR integration. |
| TC_REG_033 | Verify duplicate mobile number alert | Executable; live result must be checked | duplicate-mobile-alert |
| TC_REG_034 | Verify mobile number length validation by country | Executable; live result must be checked | save: blocked |
| TC_REG_035 | Verify mobile country code auto-selects with country | Executable; live result must be checked | country-mobile-code |
| TC_REG_036 | Verify pin code auto-fills address fields | Executable; live result must be checked | pin-autofill |
| TC_REG_037 | Verify present address copies to permanent address | Executable; live result must be checked | address-copy |
| TC_REG_038 | Verify multiple emergency contacts can be added | NOT AUTOMATED / BLOCKED | Repeated emergency-contact row creation and save/reopen assertions are not implemented. |
| TC_REG_039 | Verify WhatsApp availability check on mobile number | NOT AUTOMATED / BLOCKED | Requires synthetic WhatsApp/message recipients and delivery/availability evidence. Message integration assertions are not implemented; local controls or a QR download do not prove delivery. |
| TC_REG_040 | Verify identity type linked to identity number field | NOT AUTOMATED / BLOCKED | Requires configured Aadhaar/Emirates identity options and nationality-specific number validation. Current configured options differ from the source procedure. |
| TC_REG_041 | Verify nationality-based identity options | NOT AUTOMATED / BLOCKED | Requires configured Aadhaar/Emirates identity options and nationality-specific number validation. Current configured options differ from the source procedure. |
| TC_REG_042 | Verify self-pay payer type selection | Executable; live result must be checked | save: created |
| TC_REG_043 | Verify corporate payer selection | NOT AUTOMATED / BLOCKED | Requires corporate payer/plan fixtures and sponsor auto-selection assertions before any explicit sponsor fill. |
| TC_REG_044 | Verify insurance payer details capture | NOT AUTOMATED / BLOCKED | Requires insurer/TPA sandbox profiles, policy/plan fixtures and eligibility or billing assertions. This insurance integration workflow is not implemented. |
| TC_REG_045 | Verify system blocks transactions after insurance expiry | NOT AUTOMATED / BLOCKED | Requires insurer/TPA sandbox profiles, policy/plan fixtures and eligibility or billing assertions. This insurance integration workflow is not implemented. |
| TC_REG_046 | Verify insurance eligibility check | NOT AUTOMATED / BLOCKED | Requires insurer/TPA sandbox profiles, policy/plan fixtures and eligibility or billing assertions. This insurance integration workflow is not implemented. |
| TC_REG_047 | Verify referral doctor and specialization auto-link | NOT AUTOMATED / BLOCKED | Requires a known doctor/specialization pairing and ordered bidirectional filtering assertions. |
| TC_REG_048 | Verify referred type options and sub-fields | NOT AUTOMATED / BLOCKED | External-provider link and camp conditional-field workflows are not implemented. |
| TC_REG_049 | Verify lead source capture and narration | NOT AUTOMATED / BLOCKED | Lead-source/narration control mapping and saved-value assertions are not implemented. |
| TC_REG_050 | Verify VIP patient color coding in other modules | NOT AUTOMATED / BLOCKED | Requires department/downstream profiles and cross-module flag or alert assertions. Saving a flag alone does not verify downstream visibility or delivery. |
| TC_REG_051 | Verify confidential patient name and address masking | NOT AUTOMATED / BLOCKED | Requires separately configured authorized/restricted role profiles and cross-role assertions. Only the current login profile is available to this registration adapter. |
| TC_REG_052 | Verify handle with care flag visible across modules | NOT AUTOMATED / BLOCKED | Requires department/downstream profiles and cross-module flag or alert assertions. Saving a flag alone does not verify downstream visibility or delivery. |
| TC_REG_053 | Verify vulnerable patient alert to concerned department | NOT AUTOMATED / BLOCKED | Requires department/downstream profiles and cross-module flag or alert assertions. Saving a flag alone does not verify downstream visibility or delivery. |
| TC_REG_054 | Verify promotional consent checkbox saves preference | NOT AUTOMATED / BLOCKED | Requires synthetic WhatsApp/message recipients and delivery/availability evidence. Message integration assertions are not implemented; local controls or a QR download do not prove delivery. |
| TC_REG_055 | Verify registration card print | Executable; live result must be checked | print-card |
| TC_REG_056 | Verify registration form print | Executable; live result must be checked | print-form-complete |
| TC_REG_057 | Verify outpatient wristband print | NOT AUTOMATED / BLOCKED | Wristband or original/duplicate print authorization workflows are not implemented; card/form identity checks cannot verify them. |
| TC_REG_058 | Verify duplicate printout marked accordingly | NOT AUTOMATED / BLOCKED | Wristband or original/duplicate print authorization workflows are not implemented; card/form identity checks cannot verify them. |
| TC_REG_059 | Verify post-save redirect options | NOT AUTOMATED / BLOCKED | The source requires six post-save popup destinations. Current automation covers three Quick Actions routes only; the complete popup/destination workflow is not implemented. |
| TC_REG_060 | Verify QR code generation on save | NOT AUTOMATED / BLOCKED | Requires synthetic WhatsApp/message recipients and delivery/availability evidence. Message integration assertions are not implemented; local controls or a QR download do not prove delivery. |
| TC_REG_061 | Verify patient record update with mandatory remarks | NOT AUTOMATED / BLOCKED | Requires audit-history access and actor/timestamp/old/new-value assertions. Current update workflows do not verify a complete audit trail. |
| TC_REG_062 | Verify document upload against patient UHID | Executable; live result must be checked | document-upload |
| TC_REG_063 | Verify invalid document format rejected | Executable; live result must be checked | document-format |
| TC_REG_064 | Verify mandatory documents enforced per registration type | NOT AUTOMATED / BLOCKED | Requires a registration type with an agreed mandatory-document policy and save-blocking assertions. |
| TC_REG_065 | Verify duplicate registration detection | Executable; live result must be checked | duplicate-use-existing |
| TC_REG_066 | Verify merging duplicate registrations | NOT AUTOMATED / BLOCKED | Merge workflow is not implemented in the registration adapter; the local product source has a placeholder add-on. Requires two disposable UHIDs, primary/secondary merge assertions and secondary inactivation verification. |
| TC_REG_067 | Verify quick registration with minimal fields | NOT AUTOMATED / BLOCKED | Dedicated Quick Registration navigation, configured minimal fields and save assertions are not implemented. |
| TC_REG_068 | Verify family linking and family ID creation | NOT AUTOMATED / BLOCKED | Family-head/member linking and Family ID assertions are not implemented. |
| TC_REG_069 | Verify ABHA ID creation and linking | NOT AUTOMATED / BLOCKED | Requires an ABHA sandbox, approved OTP/identity fixtures and link/delink/history-access assertions. Opening the ABHA dialog does not verify this procedure. |
| TC_REG_070 | Verify UHID inactivation for deceased patient | NOT AUTOMATED / BLOCKED | Requires inactive/deceased synthetic fixtures, transaction blocking and authorized reactivation checks. Canceling the status dialog is not equivalent. |
| TC_REG_071 | Verify bulk registration via Excel upload | NOT AUTOMATED / BLOCKED | Bulk/group/digital-consent business workflows are not implemented in the adapter; the local product source exposes placeholder add-ons. Requires completed target functionality and full save/reopen assertions. |
| TC_REG_072 | Verify group registration with auto-fill | NOT AUTOMATED / BLOCKED | Bulk/group/digital-consent business workflows are not implemented in the adapter; the local product source exposes placeholder add-ons. Requires completed target functionality and full save/reopen assertions. |
| TC_REG_073 | Verify digital consent form creation and e-signature | NOT AUTOMATED / BLOCKED | Bulk/group/digital-consent business workflows are not implemented in the adapter; the local product source exposes placeholder add-ons. Requires completed target functionality and full save/reopen assertions. |
| TC_REG_074 | Verify token number generation and queue display | NOT AUTOMATED / BLOCKED | Requires token/barcode and OPD display-board integration fixtures and assertions. |
| TC_REG_075 | Verify insurance eligibility integration | NOT AUTOMATED / BLOCKED | Requires insurer/TPA sandbox profiles, policy/plan fixtures and eligibility or billing assertions. This insurance integration workflow is not implemented. |
| TC_REG_076 | Verify audit fields auto-populate on registration | NOT AUTOMATED / BLOCKED | Requires audit-history access and actor/timestamp/old/new-value assertions. Current update workflows do not verify a complete audit trail. |
| TC_REG_077 | Verify complete audit trail of field changes | NOT AUTOMATED / BLOCKED | Requires audit-history access and actor/timestamp/old/new-value assertions. Current update workflows do not verify a complete audit trail. |
| TC_REG_078 | Verify dynamic registration report | NOT AUTOMATED / BLOCKED | Registration report navigation, filter fixtures and output reconciliation are not implemented. |
| TC_REG_079 | Verify ABHA link and delink functionality | NOT AUTOMATED / BLOCKED | Requires an ABHA sandbox, approved OTP/identity fixtures and link/delink/history-access assertions. Opening the ABHA dialog does not verify this procedure. |
| TC_REG_080 | Verify redirect from registration to OPD invoice | NOT AUTOMATED / BLOCKED | Requires OP Bill popup navigation and verification of prefilled billing patient details. The existing redirect URL check alone does not satisfy the source procedure. |

## Resources and implementation still needed

- Resettable UAT master configuration and expected fixture values, with create/verify/restore automation.
- Separate authorized/restricted profiles, synthetic HR/dependant/mother/pre-registration fixtures and their complete workflows.
- Insurance/TPA and ABHA sandbox fixtures, approved identity/OTP handling and integration assertions.
- Department, message delivery, audit/report and downstream billing verification access.
- Completed target functionality and automation for merge, bulk/group/family registration, digital consent, wristband and other currently missing features.

Adding profile credentials or setting a case's execution type does not implement a missing workflow. Ready means that code exists; it does not mean the test passed, and the live run may identify a product or requirements mismatch.
