# Report pack: different reports for different readers, with filters, delivered as one ZIP

Status: Phase A implemented (see plan); Phases B and C not started.

## Intent and why

When a run finishes, the team today gets one big PDF (every finding in detail, then every case in an appendix, with screenshots) plus a flat Excel sheet, a JSON dump and a JUnit file. That does not match how a real release works:

- A release manager wants one page: can we ship?
- A developer wants only the bugs, with the steps to reproduce them.
- A test lead wants every case and its status, sortable and filterable.
- A business analyst wants to know which requirements were proven, and which were not.
- An auditor wants complete evidence for what was run, unchanged since it was run.

And the problem the request raised: with 1,000 cases run, passes and bugs must not be forced into one document. The reader should choose what kind of report, and filter it.

## What exists today (checked in the code and on real data)

- `portal/quality.mjs` builds one report model per run (`reportModel`, version 2): counts, findings, a row per case, evidence counts, a scope note. Findings are classified as Failed assertion, Business rule review, Execution issue and Blocked, with severity kept separate from priority.
- `portal/report_pdf.py` renders that model as a branded PDF: executive summary, findings with reproduction steps, and an appendix listing every selected case with its screenshots.
- Other exports: Excel (one flat sheet, 14 columns), JSON, JUnit XML.
- Measured scale on this machine's real runs: one run holds 2,208 screenshots = 275 MB, and its PDF is 62 MB. The renderer's own comment records about 290 seconds for 957 screenshots (262 cases).
  - Estimate for 1,000 cases (about 3.6 screenshots per case, so about 3,600 screenshots): roughly 1 GB of screenshots, a PDF of about 100 MB, about 20 minutes to render, in one web request. Nobody can open or share that. This is the core scale problem.
- Gap found while checking: the PDF redacts credential-like text, but the Excel, JSON and JUnit exports use the raw text and skip that redaction. One shared redaction layer is part of this plan.

## Goals

1. One "Export" action offering reports by reader ("For developers", "For the release decision", ...), not by file type.
2. Filters so a 1,000-case run can yield "bugs only", "failures and blocked", "P0 and P1", "this suite", "this requirement", and so on.
3. Everything chosen is delivered in one ZIP, with a README and a manifest saying exactly what is inside and what filters were used.
4. Big runs stay usable: summary first, evidence by reference, and a preview of size and time before generating.
5. Reports never overclaim. A filtered report says it is partial and always shows the whole run's totals.

## Non-goals and anti-goals

- Not a custom report designer. Fixed, well-made reports with choices.
- Not a regulated electronic signature. A sign-off record is fine; calling it compliant with 21 CFR Part 11 is not, and we will not.
- Anti-goal: a pass rate computed only on a filtered subset presented as if it were the run's result.
- Anti-goal: report generation that blocks the portal or times out on a big run.

## What other tools and standards do (research summary)

- ISO/IEC/IEEE 29119-3 calls the end report a "test completion report" (also "test summary report"): what was tested, results against the completion criteria, deviations, residual risks and lessons. The execution log and the incident (defect) report are separate documents. Not every field list was verified against the standard itself.
- Practitioner guidance for the release report converges on: open with the verdict (release / release with known issues / do not release), then scope, pass rate, open defects by severity, top risks, what was NOT tested, comparison with the previous release; one page; everything long (defect exports, logs, screenshots) goes in linked appendices.
- TestRail groups its reports by purpose (summary, defects, results comparison, coverage and traceability by requirement, activity) and tells big projects to build several reports by section, run or plan, not one giant report.
- Allure (static, per-run HTML with history) and ReportPortal (server with defect classification: product bug, automation bug, system issue, to investigate) show two useful ideas: an interactive HTML report people can search and filter offline, and separating product bugs from automation or environment problems.
- Playwright reporting guidance: HTML for people investigating, JUnit XML for CI dashboards, JSON for tooling; search and filtering become essential at hundreds of tests; screenshots on every test turn into gigabytes at scale.
- Jira's CSV import needs only a Summary column; multi-line text must be quoted; labels repeat as columns; attachments are URLs reachable by Jira. So a "defects for Jira" CSV is cheap and useful.
- Medical-software guidance (IEC 62304, FDA validation) centres on requirements-to-test traceability, retained test records and results, deviation records, and approvals. Sources were vendor and consultancy material; clause numbers need checking before anyone relies on them.

## The report catalog (by reader)

| # | Report | For | Contains | Format | Size |
|---|---|---|---|---|---|
| 1 | Release summary | Release manager, management | A suggested verdict banner (release / release with known issues / do not release) that a person confirms; scope; counts; open bugs by severity; top risks; what was not tested; change since the previous run | PDF (1 to 2 pages), Markdown for pasting into chat or email | 1-2 pages |
| 2 | Bug report | Developers, triage | Only findings. Product-behaviour failures first, "business rule needs review" in their own section. Steps to reproduce, inputs, expected vs actual, evidence, severity, owner, ticket link | PDF, Excel defect register, Jira CSV | by number of bugs |
| 3 | Execution log | Test lead, tester | One row per selected case: id, title, suite, priority, requirement, status, attempts and flaky, duration, evidence count. Sheets for Results, Findings, Not executed | Excel, CSV | 1,000 rows is fine |
| 4 | Requirements and coverage | BA, QA lead, audit | Requirement to cases to latest result; requirements with no passing check; assumed rules listed separately | Excel, PDF | small |
| 5 | Automation health | Automation owner | Execution issues and blocked cases (not product bugs), flaky and quarantined cases, failure groups, slowest cases, accessibility findings | Excel, PDF | small |
| 6 | Full evidence report | Tester, auditor | Every executed case with expected, actual and evidence | Interactive HTML (search, filters, thumbnails, works offline) plus an `evidence/` folder; optional capped PDF | large by design, inside the ZIP |
| 7 | Machine data | CI and tools | JSON, JUnit XML | files | small |

## Filters

Dimensions: result class (passed; failed assertion; business-rule review; execution issue; blocked; observed; skipped; not executed; flaky; quarantined), priority, suite, requirement, severity, owner, registration type or variant, manual or automated, assumed rules only, new failures since the previous run, cases with missing screenshots, a case-id list (for example the cases selected in the run page), and free text.

Presets: Bugs only; Failures and blocked; Needs triage (no severity yet); P0 and P1; Everything.

Rule: filters change which cases are listed, never the totals. Every filtered report carries the line "Showing 37 of 1,000 cases. Filter: ..." and the run's real totals.

## Evidence levels

None; Findings only (default); Findings plus each case's final screenshot; Everything. Evidence is stored as files in the ZIP and linked from the reports, not embedded, except in the bug report PDF where it is embedded for bugs only. Before generating, the dialog shows an estimate: "37 cases, 61 screenshots, about 14 MB, about 40 seconds."

## ZIP layout

```
Registration_2026-11-14_run-ab12cd34/
  00-README.txt                  what is inside, which filters were used, how to read it
  01-Release-Summary.pdf
  02-Bug-Report.pdf
  02-Bugs.xlsx   02-Bugs-for-Jira.csv
  03-Execution-Log.xlsx
  04-Requirements-Coverage.xlsx
  05-Automation-Health.xlsx
  06-Evidence/index.html  + evidence/<case>/<stage>.png      (interactive)
  data/results.json   data/junit.xml
  MANIFEST.json                  every file with its SHA-256, run id, filter, model version, who and when
```
Only the reports chosen are included. Numbers are prefixed so the folder reads in order.

## Approaches considered

A. Report builder: audience presets, filters, evidence levels, background job, ZIP. One shared model feeds small renderers (recommended).
B. Fixed bundle: always generate the same files in a ZIP, no choices. Simpler, but wasteful and slow at 1,000 cases, and it does not give the filters that were asked for.
C. Portal-only filtered view with "export what I see". Good for quick, ad-hoc use, but no packaged reports for sharing or audit.

Recommendation: A, and let the run page's existing filters feed into it (the useful part of C).

## Design of the recommended approach

1. Canonical model. Extend `reportModel` to carry run-wide totals, per-case rows, requirement links and a filter description. Redaction happens once, here, so every format is safe.
2. Filter step. `applyFilter(model, filter)` returns the listed cases plus the untouched totals.
3. Renderers, each small and independent: Excel (multi-sheet, using the existing exceljs), CSV (Jira), Markdown, HTML (single self-contained page, filter script included, data embedded), PDF (existing renderer gains a bugs-only mode, a one-page summary mode and an evidence level), JUnit and JSON (now redacted).
4. Bundle composer. Streams the ZIP (the portal already has a zip writer for module packs), adds README and MANIFEST.
5. Background job. A report job with progress, like the agent jobs: the request returns at once, the page shows progress and then a download. Replaces the current single long request that waits up to ten minutes.
6. Cache and retention. Results are cached by a fingerprint of the model and renderer (exists today for PDF). Generated packs are listed on the run's Reports tab; a retention setting can delete old packs.
7. Permissions. Same as the run's report view; sign-off needs the triage permission.

## Phases

- Phase A (the core): filter model, shared redaction, Excel execution log and defect register, Jira CSV, bug-only PDF, one-page release summary, ZIP with README and manifest, the builder dialog with presets and size estimate, background job.
- Phase B: interactive HTML evidence report, evidence levels, requirements and coverage report, automation health report.
- Phase C: release pack across several runs or modules, a simple approval record (who approved, when, decision), report packs built automatically after scheduled runs with a link in the alert, retention clean-up.

## Risks

- PDF rendering depends on Python; Excel, CSV, Markdown and HTML will be pure Node, so only the PDFs need Python.
- Disk: about 558 MB of screenshots across the 38 runs on this machine already. Retention matters before this grows.
- A suggested verdict can be misread as a decision. It will always say "suggested" and require a person to confirm; the exit criteria are the team's, not ours.
- Scope creep. Phase A alone delivers the filters and the different reports; B and C are only worth building after A has been used.

## Decisions needed from the owner (with my default)

1. Which reports matter first? Default: 1, 2, 3 in Phase A, with the interactive evidence report (6) next.
2. Verdict on the release summary: suggest from exit criteria the team sets (for example no open Critical or High bugs) and let a person confirm? Default: yes.
3. Default evidence in the ZIP: findings only? Default: yes.
4. Keep generated packs with the run (listed on a Reports tab) or download only? Default: keep, with optional auto-delete.
5. Do you need an approval record for audit? Default: a simple record, no e-signature claim.
