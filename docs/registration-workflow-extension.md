# Registration workflow extension — 2026-11-04

Four new named workflows are installed in the local Registration portal and included in the generated 37-case workflow suite. Refresh the portal, open Registration, choose Automated execution and select the IDs below. The runner includes saved-patient prerequisites automatically and captures screenshots and result details. Existing manual workbook procedures remain intact.

| Case ID | Executed behavior |
|---|---|
| REG-FLOW-INSURANCE-PAYER-RESET | Select Insurance, verify that selection, switch to Self-Paid, then verify payer/sponsor are Cash and disabled. |
| REG-FLOW-PIN-CLEAR | Populate PIN 110001, verify its State/District/City, clear PIN, and assert all three derived fields clear. |
| REG-FLOW-NEW-RESET-ADDRESS | Enter unsaved patient/address data, copy Current to Permanent, click New, and verify both address tabs and validation reset. |
| REG-FLOW-DUPLICATE-USE-EXISTING | Create a synthetic prerequisite, enter matching identity details on a new form, submit Save, verify the duplicate prompt identifies that patient, select Use Existing and check the correct patient reopens without another create request. |

REG-270 now executes the full Insurance-to-Self-Paid workflow rather than checking only its final defaults. REG-269 was renamed to describe its existing blocked-update assertion accurately; address clearing has its own explicit test instead of being implied by that title. Historical run snapshots and results are preserved.

The duplicate test checks the Save-triggered prompt. The current visible registration screen did not expose a Check Duplicate button; this is not a complete conversion of TC_REG_065's specified button sequence. Merging/deactivating duplicate records (TC_REG_066) remains unsupported and is not represented by a passing duplicate-selection test.

Live portal run [5033bc43-eba7-4180-8ca1-00e32e947812](http://127.0.0.1:4173/#/runs/5033bc43-eba7-4180-8ca1-00e32e947812) verified:

- REG-270: PASS, including Insurance before Self-Paid.
- REG-FLOW-NEW-RESET-ADDRESS: PASS, including Current and Permanent reset.
- REG-FLOW-PIN-CLEAR: FAIL against the stated clearing expectation. After PIN was cleared, State remained DELHI and District/City remained NEW DELHI. This is observed behavior requiring requirement/defect triage; the automation preserves the failure.

Live portal run [84714fc4-c686-4819-9aa8-3b7c3aa98a36](http://127.0.0.1:4173/#/runs/84714fc4-c686-4819-9aa8-3b7c3aa98a36) passed its synthetic prerequisite and REG-FLOW-DUPLICATE-USE-EXISTING. The actual dialog uses a patient-row radio followed by the shared footer button Use Existing Patient; the runner selects the matching row explicitly and checks the reopened UHID/name/mobile and zero extra create requests. Earlier attempts exposed runner locator problems; those error runs remain preserved separately.

A separate explicit scroll was removed from field filling: Playwright's input actions already scroll and retry, while a separate scroll could capture a control detached by asynchronous PIN/address rendering.

Local verification: 34 portal/API/browser/quality checks and 11 executor/workflow checks passed across the regression runs. The new PIN regression detects a stale City even when State and District clear, guarding against a partial assertion. A duplicate regression starts with a different row selected and verifies that the matching UHID is chosen before the shared footer action. Local tests establish runner logic, not full live workbook coverage.
