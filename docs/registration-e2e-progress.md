# Registration automation implementation and remaining resources

The latest [workflow extension and live outcomes](registration-workflow-extension.md) adds four workflows, bringing the generated suite to 37 definitions. Insurance-to-Self-Paid, New/address reset and duplicate Use Existing passed live. PIN clearing failed its explicit address-reset expectation. These results do not establish that the remaining workbook scenarios are automated.

## Login fix and latest live verification (2026-11-04)

The current login page uses a two-step Continue flow, `.lg-field` containers and the label `Tenant (hospital group)`. The login adapter now supports that layout alongside the original login. The prior refresh failure occurred after password verification because the old tenant locator no longer matched. Login was successfully refreshed using the configured account, and portal run `8ba5f6ec-d780-40bd-95eb-72acaa9b1abd` passed both read-only registration checks REG-266 and REG-267. This verifies the refreshed session and those two tab checks; it does not establish that the entire automation suite passes. Settings and Environments retain login refresh in the UI, and failed login jobs now report a safe stage-specific reason without raw credential output.

Status: implementation in progress. The 80 supplied workbook procedures remain intact as manual cases. No workbook case has been declared passed or replaced with a reduced expectation.

## Added automation

The new suite contains 33 definitions: one synthetic patient prerequisite, five converted workbook cases and 27 named workflows. They are installed in the local Registration portal under `REG-WB-*`, `REG-FLOW-*` and `REG-E2E-BASE`. Existing cases and historical results are preserved. The adapter uses the same Playwright executor, screenshots, traces and result attachments as the existing tests.

Implemented checks include New/reset, Tab and dropdown keyboard interaction, ordered title/gender changes, DOB/age checks, Current/Permanent address copying and independence, payer defaults, newborn delivery fields, staff/dependant controls, seven add-on drawer shells, document/notes gating, UHID search with patient identity assertions, mandatory update remarks and canceled updates, saved email updates, canceled active-status changes, card/form print identity and native print invocation, QR PNG download, document PDF upload and reopen verification, document format validation, Clear, ABHA dialog and Quick Action navigation.

The full workbook outcomes for staff HR integration, newborn mother linking, audit history, ABHA linking, WhatsApp delivery and downstream billing are not established by the corresponding partial checks. The add-on drawer test verifies drawer controls only; it does not prove bulk registration, merging, insurance or digital consent functionality.

New field mappings support delivery type/date, weight, height, staff lookup and dependants. `reg:inventory` captures visible buttons, inputs, tabs and disabled states across all six configured registration variants without saving; its inventory is observational evidence, not functional coverage of every discovered control.

## Commands

```powershell
# Human-owned application login refresh
npm run auth

# Read-only configured-control inventory
npm run reg:inventory

# New suite: checks the session first, then executes the 33 definitions
npm run reg:e2e

# Visible execution
npm run reg:e2e -- --headed

# Selecting a dependent flow includes its synthetic patient prerequisite
$env:CASES = 'REG-FLOW-UPDATE-REMARKS'
npm run reg:e2e
Remove-Item Env:CASES

# Install missing IDs into another local portal database, without overwrites
npm run reg:automation:install
```

Use `PORTAL_DATA_DIR` for a custom portal database. A portal process already running before this adapter change needs a normal restart when no run is active so it loads the new workflow action. This work did not stop or restart a running server or interrupt queued work.

The new CLI includes dependency ordering and immutable input snapshots under the existing ignored results directory. Session failure stops the suite before creating test patients. The existing `reg:cases` command continues to use the original dataset. The new suite has not been merged into that dataset because its live verification is pending.

## Verification so far

- TypeScript compilation and portal JavaScript syntax checks pass.
- Final local regression run: 30 portal/API/quality/browser tests and 9 executor/workflow checks passed. These are local checks, not 39 live registration scenarios.
- Local registry/API tests validate workflow contracts, reject unsupported keys/check combinations and preserve prerequisites in queued run snapshots.
- Local browser/executor tests check reset assertions, whitespace remarks validation, cancel/reopen sequencing, ownership checks and unsupported-flow rejection. These tests use controlled fixtures and do not establish application behavior.
- Playwright discovers all 33 new cases.
- Postman CLI 1.85.0 was installed globally through npm. `postman status` reports that this repository has no initialized Postman resources and the CLI has no signed-in account. No Postman workspace push or cloud publication was performed; API verification above uses the repository's local HTTP regression harness.
- Live smoke test on 2026-11-04 failed because the application displayed: “Your session has expired Please Log in again.” No new live workflow run has been claimed successful. The smoke failure screenshot and trace are available through the existing Playwright report.

## Resources needed for full workbook coverage

| Resource / decision | Work it unlocks |
|---|---|
| Refresh the existing session with `npm run auth` | Live discovery, locator verification, controlled runs and failure triage for the newly added workflows |
| Dedicated UAT URL and test tenant/facility with resettable configuration | Registration type/workflow masters, document categories, lookup masters, duplicate rules, charges, defaults, UHID format and reversible master setup |
| Authorized and restricted role sessions configured locally | Facility-change permissions, confidential-name masking, privileged original reprints and reactivation authorization |
| Synthetic staff/HR records, mothers and pre-registration fixtures | HR autofetch, staff dependants, maternal relationship checks, preregistration consumption |
| Insurer/TPA sandbox, plans, policy fixtures and eligibility responses | Corporate/insurance capture, expiry blocking during OPD billing and eligibility integration |
| ABHA sandbox and approved OTP/identity test procedure | ABHA creation, linking, delinking and historical-record authorization |
| Test WhatsApp/SMS/email recipient and delivery evidence mechanism | WhatsApp availability, QR delivery, promotional consent enforcement and delivery confirmation |
| Implemented add-on workflows in the target build | Bulk/group/family registration, merge, wristband/duplicate prints, consent signature, token/display-board integration |
| Department users and downstream verification routes | VIP/handle-with-care/vulnerable flags, department alerts, billing/admission/appointment patient prefill and actual business outcomes |
| Audit/report access and agreed expected formats | Author/timestamp accuracy, old/new field change audit and filtered registration reports |
| Confirm workbook as requirements or provide updated acceptance rules | Expected behavior where workbook and configured application differ |

Passwords, tokens, connection strings and real patient identity data should stay in the existing local credential setup, not in this document or chat.

## Source limitations observed

In the local frontend source, `RegistrationPreview.jsx` implements Patient Document and Notes drawer content, but other add-ons fall through to a “Coming soon” placeholder. These business workflows cannot be asserted as complete based on opening their buttons. Target UAT may differ and needs live discovery after login refresh.

The source also exposes configured identity options Localite/Foreigner rather than the workbook's Aadhaar/Emirates expectations. These require target configuration confirmation. The Patient Documents panel's file handler accepts selected files without a content/format guard; the new negative-format assertion preserves the workbook requirement and may identify a product failure after live verification.
