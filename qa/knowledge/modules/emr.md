# EMR (setup): what the material shows and where to look for defects

Source: the Test Studio analysis of four BA walkthrough videos (version 2 of the EMR insights). The videos have no transcript, so everything here is **Observed**: seen on screen, and nothing is a confirmed rule or a confirmed defect. Treat each point as a place to look, write the expected result as assumed, and ask the business analyst before filing a bug.

## What was seen
- Sign-in with User Name / Email ID and Password (both marked mandatory), a Forgot Password link, and a logout confirmation ("Sure to Logout?" with Yes and Cancel).
- Tenant onboarding prerequisites and a cross-tenant export screen (tabs Lookup, Module, Workflow, Webparts, Forms, Search Builder, Report Builder, Data Attributes) with Import source and destination, Transfer mode, Select Template, and an Export confirmation (Yes/Cancel).
- A workflow list with Search, filters (Provider, Category, Group, Type), Rows per page, Status and Add Work Flow.
- A workflow stage builder: Stage > Process (for example SOAP) > Task; Select Role at each level; Create Task dialog with New Task Name, a Multiple Tab toggle (off by default), Select Role, Close, Submit; page actions Save Stage, Publish, Preview. The preview shows a General Examination grid (Skin colour, State of alertness, Activity, Range of spontaneous movements, Posture, Muscle tone, Actions).
- The patient screen template bar with tabs All, Assessment, Scoring, Shift handover, Checklist, Monitoring and a Search Templates box.
- A search builder: pick a database object, tick fields, group them under an alias, rename through an Edit Target Name dialog (Cancel / OK).
- Visit lists with a status legend (Waiting, Active, Closed) and count chips (Total, Checked In, Regular, Walk In, Assigned To, Assigned By, Open, Seen, Closed). Admin and Doctor see different columns.

## Places to look first (ranked by risk)
1. **Configuration transfer can damage a tenant.** Wrong destination, overwriting or duplicating existing items, partial transfer, and no clear result after Export. Pair every export case with a check of what actually arrived.
2. **Workflow publish and roles.** What a user sees before and after Publish, who can publish, role gating at stage, process and task level, and Preview versus the published result.
3. **Counts that disagree with lists.** Chip counts versus rows under the same filters; the range text "1 - 10 Of 8" and the empty-list footer "Showing 1 - 0 records" (then "Showing 1 - records", count missing) were visible. Decide the intended range rule with the analyst before asserting it.
4. **Role-specific screens.** Admin and Doctor lists show different columns and actions; check that the wrong role cannot reach the other's actions, and that a hidden column is not still exported or printed.
5. **Duplicate and near-duplicate names.** Template names such as "Pain Assesment Neonatal" and "Pain Assessment Neonatal", or names that differ only by case, appeared side by side. Test whether duplicates are accepted, merged or flagged, and how search treats them.
6. **Special characters in names and search.** Real template names contain brackets and hyphens ("Initial Admission Assessment (Paediatric)", "Ventilator protocol - COPD"): use them as inputs for template search, workflow name and rename dialogs.
7. **Dialog behaviour.** Cancel must leave state unchanged in every dialog (Export, Logout, Edit Target Name, Create Task); OK must save exactly what was typed.

## Not established (do not write confirmed expectations)
- What Export, Import and Template transfer actually do on success; what happens after OK in the rename dialog; what a Multiple Tab toggle changes; which fields are mandatory on creation screens; what the visit-list chips count. Ask for transcripts, notes or screens that show the result.

## Carry over from Registration (same platform)
A success message proves nothing: reopen and verify what was stored. A rule enforced only on leaving a field is skipped by pressing Save. A server error can sit inside a successful response. Search should be tried with brackets, quotes and very long text. See modules/registration.md.
