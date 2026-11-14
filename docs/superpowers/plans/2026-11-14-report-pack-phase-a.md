# Report Pack, Phase A: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a finished run, build a ZIP of audience-specific reports (release summary, bug report, execution log) with filters, evidence levels and a manifest, generated as a background job.

**Architecture:** `reportModel` (portal/quality.mjs) stays the single source; a filter step narrows the listed cases while totals stay whole; small renderers (Excel, CSV, Markdown, PDF modes) each take `(model, listing)`; a pack builder streams them into a ZIP with README and SHA-256 manifest; a job runner exposes it through new routes and a dialog on the run page.

**Tech Stack:** Node 24 ESM (`.mjs`), `exceljs` (already installed), `portal/zip.mjs` (existing writer), Python ReportLab only for the PDFs, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-14-report-pack-design.md` (approved with its defaults). Phases B (interactive HTML evidence report, requirements and automation-health reports) and C (release pack across runs, approval record, retention, auto-packs) get separate plans.

## Global Constraints

- No new npm or Python dependencies. Excel, CSV, Markdown and the pack are pure Node; only PDFs use Python.
- Every text that reaches any output goes through `safeReportText` / `safeMap` from `portal/quality.mjs` (one redaction path for PDF, Excel, CSV, Markdown, JSON, JUnit).
- A filtered report lists fewer cases but always shows the run's real totals, and says `Showing N of M cases. Filter: ...`. A pass rate is never computed from the filtered subset.
- The release verdict is always worded "Suggested" and needs a person to confirm; never claim 21 CFR Part 11 or other regulatory compliance anywhere.
- Defaults from the spec: reports `summary`, `bugs`, `log`; evidence level `findings`; packs are kept with the run in `<runDir>/packs/`.
- Default exit criteria: block on any open Critical or High failed assertion; any execution issue or blocked case means "needs triage" (not verified); untriaged failed assertions mean "needs triage".
- Tests live in `portal/test/*.test.mjs`; `npm run portal:check` and `node --test portal/test/*.test.mjs` must pass before every commit. Never stage `akhil_test_studio.pen`.

## Review Focus

- Filter matches zero cases: pack still builds with a "No cases match this filter" note and real totals; the estimate reports `cases: 0` so the dialog can block Create.
- Filtered report quoting a pass rate from the subset (misleading): the summary pass rate must use run totals while a filter is active.
- Spreadsheet formula injection: titles and results starting with `=`, `+`, `-` or `@` must be neutralized in Excel and CSV cells.
- Case ids or suite names used in ZIP paths (`../x`, `a:b`, duplicates, very long): sanitized and unique.
- Screenshot missing on disk (cleaned up) or pack requested for a run with no results, a manual run, or an unfinished run: clear error or a manifest note, never a crash.
- 1,000-case run: build time and memory stay bounded (files are streamed, not buffered), no PDF contains more than the chosen scope.
- Two identical requests at once: one job, not two.

## File Structure

| File | Responsibility |
|---|---|
| `portal/quality.mjs` (modify) | `reportModel` rows gain `flaky`, `attempts`, `quarantined`, `severity`, `owner`, `ticketUrl`, `findingKind`, plus `totalsByClass` |
| `portal/reports/redact.mjs` (create) | `redactRun`, one deep-redaction helper for raw run exports |
| `portal/reports/filter.mjs` (create) | filter shape, presets, `applyFilter` |
| `portal/reports/summary.mjs` (create) | `DEFAULT_CRITERIA`, `suggestVerdict`, `buildSummary` |
| `portal/reports/csv.mjs` (create) | `toCsv`, `safeCell`, `jiraCsv` |
| `portal/reports/xlsx.mjs` (create) | `executionLogWorkbook`, `defectWorkbook` |
| `portal/reports/markdown.mjs` (create) | `summaryMarkdown` |
| `portal/report_pdf.py`, `portal/pdf-report.mjs` (modify) | `mode`: `full`, `bugs`, `summary`; options in `generatePdf` |
| `portal/reports/pack.mjs` (create) | `REPORTS`, `estimatePack`, `buildPack` |
| `portal/reports/jobs.mjs` (create) | `createReportJobs` |
| `portal/routes/report-packs.mjs` (create), `portal/server.mjs`, `portal/app/context.mjs` (modify) | routes and wiring |
| `portal/public/pages/report-pack.js`, `portal/public/handlers/report-pack.js` (create), `runs.js`, `app.js`, `styles.css` (modify) | dialog and pack list |
| `portal/test/report-pack.test.mjs` (create) | tests for all of the above |

### Task 1: Shared model fields and one redaction path

**Files:** Modify `portal/quality.mjs`, `portal/compare.mjs`, `portal/routes/runs.mjs`; Create `portal/reports/redact.mjs`; Test `portal/test/report-pack.test.mjs`.

**Interfaces:**
- Produces: `redactRun(run: object): object` (deep copy; every string through `safeReportText`; values under keys matching the existing secret-key pattern become `[REDACTED]`); `reportModel(run)` rows `cases[i]` gain `flaky: boolean`, `attempts: number`, `quarantined: boolean`, `severity: string`, `owner: string`, `ticketUrl: string`, `findingKind: 'failure'|'assumption'|'execution'|'blocked'|null`; model gains `totalsByClass: Record<'passed'|'failed'|'review'|'execution'|'blocked'|'observed'|'skipped'|'not-executed'|'flaky'|'quarantined', number>`.

- [ ] **Step 1: Failing tests.** `redactRun removes bearer tokens, JWTs and secret-keyed values from nested results` (input `actual: 'Authorization: Bearer abc.def'`, `resolvedInput: { password: 'x' }`, assert neither appears and the original object is untouched). `reportModel rows carry flaky, attempts, quarantined, severity, owner, ticketUrl and totalsByClass` (a run with one PASS flaky result `attempts: 2`, one quarantined FAIL, one triaged FAIL with `triage.severity: 'High'`, `ticketUrl`; assert row fields and `totalsByClass` counts). `JSON, JUnit and Excel exports of a run containing a bearer token never contain it` (through `boot` + `/api/runs/:id/export?format=json|junit|xlsx`; read the xlsx with `exceljs`).
- [ ] **Step 2:** Run `node --test portal/test/report-pack.test.mjs`; expect FAIL (module and fields missing).
- [ ] **Step 3: Implement** `redactRun` in `portal/reports/redact.mjs` importing `safeReportText` and exporting the secret-key regex from `quality.mjs` (export it as `secretKey`); extend `reportModel` rows and add `totalsByClass`; in `portal/compare.mjs` `toJunit` wrap expected/actual/mismatch text with `safeReportText`; in `portal/routes/runs.mjs` JSON export sends `redactRun(run)` and the xlsx export builds its sheet from `reportModel(run).cases` (strings already safe).
- [ ] **Step 4:** Run `node --test portal/test/*.test.mjs`; expect all pass (existing report-pdf and quality tests unchanged).
- [ ] **Step 5: Commit** `fix: one redaction path for every report export; add flaky/quarantine/ticket fields to the report model`.

### Task 2: Filter

**Files:** Create `portal/reports/filter.mjs`; Test `portal/test/report-pack.test.mjs`.

**Interfaces:**
- Produces:
  - `type ReportFilter = { classes?: string[]; priorities?: string[]; suites?: string[]; requirements?: string[]; severities?: string[]; owners?: string[]; caseIds?: string[]; mode?: 'manual'|'automated'; assumedOnly?: boolean; newFailuresOnly?: boolean; missingEvidenceOnly?: boolean; text?: string }`
  - `PRESETS: Record<string, { label: string; filter: ReportFilter }>` with keys `bugs` (classes `failed`,`review`), `failures` (`failed`,`review`,`execution`,`blocked`), `needs-triage` (classes `failed`, severities `['Not assessed']`), `p0p1` (priorities `P0`,`P1`), `everything` (`{}`).
  - `normalizeFilter(raw: unknown): ReportFilter` (drops unknown keys and non-string entries, trims, caps lists at 200 and `text` at 200 chars; unknown class names are dropped).
  - `applyFilter(model, filter: ReportFilter, ctx?: { previousFailedIds?: Set<string> }): { cases: Row[]; findings: Finding[]; shown: number; total: number; active: boolean; description: string }`. Within a dimension values are OR, across dimensions AND. `description` reads e.g. `Result: failed, review; Priority: P0` or `All cases` when inactive.

- [ ] **Step 1: Failing tests** with a 6-row model: `bugs preset keeps only failed and review rows`; `dimensions combine with AND and values with OR`; `text matches id, title and requirement case-insensitively`; `newFailuresOnly uses previousFailedIds`; `caseIds restricts to the list`; `empty filter is inactive and returns every row with shown === total`; `normalizeFilter drops unknown keys, unknown classes and non-strings`; `totals are never filtered` (assert `model.counts` untouched and `total` equals all rows).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement** in `filter.mjs`; a row's classes come from `findingKind` (`failure`→`failed`, `assumption`→`review`, `execution`, `blocked`), `rawStatus` (`PASS`→`passed`, `OBSERVED`, `SKIPPED`, `NOT EXECUTED`→`not-executed`) plus overlays `flaky` and `quarantined`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5: Commit** `feat: report filters with presets`.

### Task 3: Summary and suggested verdict

**Files:** Create `portal/reports/summary.mjs`; Test `portal/test/report-pack.test.mjs`.

**Interfaces:**
- Consumes: `reportModel` output, `applyFilter` result.
- Produces: `DEFAULT_CRITERIA = { blockSeverities: ['Critical','High'], maxExecutionIssues: 0, requireTriage: true }`; `suggestVerdict(model, criteria = DEFAULT_CRITERIA): { value: 'release'|'release-with-known-issues'|'do-not-release'|'needs-triage'; reasons: string[] }`; `buildSummary(model, listing, opts?: { previous?: Model; criteria?: object }): { verdict; scope: string; counts: model.counts; passRate: number|null; openBugsBySeverity: Record<string, number>; risks: string[]; notTested: string[]; comparison: null | { passRate: number|null; newlyFailing: number; fixed: number }; filterNote: string|null }`. `filterNote` is `Showing N of M cases. Filter: ...` only when the filter is active.
  Verdict rules: any open failed assertion (not quarantined) at a blocking severity → `do-not-release`; else any untriaged failed assertion, execution issue or blocked case → `needs-triage`; else any other open finding → `release-with-known-issues`; else `release`. Quarantined failures are listed in `risks`, never counted as open bugs. `notTested` lists counts of not-executed, blocked, skipped, observed and assumed-rule cases.

- [ ] **Step 1: Failing tests:** one per verdict value with a built model; `quarantined failure does not block but appears in risks`; `pass rate uses run totals when a filter is active` (Review Focus); `filterNote is null when inactive`; `comparison counts newly failing and fixed versus previous`; `a 100% pass run with 3 not-executed cases lists them in notTested`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement** the three functions; pass rate = passed / (passed + failed + errors) from `model.counts`, `null` when the denominator is 0.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5: Commit** `feat: report summary with suggested verdict`.

### Task 4: Excel, CSV and Markdown renderers

**Files:** Create `portal/reports/csv.mjs`, `portal/reports/xlsx.mjs`, `portal/reports/markdown.mjs`; Test `portal/test/report-pack.test.mjs`.

**Interfaces:**
- Produces:
  - `safeCell(value: unknown): string` (string; prefix `'` when it starts with `=`, `+`, `-`, `@`, tab or CR; cap 32,000 chars).
  - `toCsv(rows: string[][]): string` (RFC 4180: quotes fields containing `,` `"` CR LF, doubles quotes, CRLF line ends).
  - `jiraCsv(model, listing): string` header `Summary,Description,Priority,Labels,Labels,Issue Type`; one row per listed finding (not quarantined); Summary `[CASE-ID] title`; Priority from severity else test priority (`P0`→`Highest`, `P1`→`High`, `P2`→`Medium`, `P3`→`Low`); labels `test-studio` and the suite slug; Issue Type `Bug` for failed assertions, `Task` for rule reviews.
  - `executionLogWorkbook(model, listing, ctx?: { evidenceLinks?: Record<string, string> }): Promise<Buffer>` sheets `Summary` (totals, filter note, verdict suggestion), `Results` (one row per listed case: id, title, suite, priority, requirement, status, class, severity, owner, ticket, attempts, flaky, quarantined, duration s, evidence count, evidence link), `Findings`, `Not executed`; autofilter and frozen header on each.
  - `defectWorkbook(model, listing): Promise<Buffer>` sheets `Bugs` (failed assertions) and `Needs review` (rule reviews), columns including steps joined by newlines, expected, actual, mismatches, severity, owner, ticket.
  - `summaryMarkdown(summary): string` (verdict line first, then counts, open bugs by severity, not tested, risks).

- [ ] **Step 1: Failing tests:** `safeCell neutralizes formula starters` (`=1+1`, `+cmd`, `-2`, `@SUM`); `toCsv quotes commas, quotes and newlines`; `jiraCsv maps priority, excludes quarantined, escapes quotes`; `execution log workbook has the four sheets, an autofilter, one row per listed case and a hyperlink cell when evidenceLinks has the case` (read back with `exceljs`); `a title like =HYPERLINK(...) is stored as text`; `defect workbook splits bugs and needs-review`; `summaryMarkdown starts with the suggested verdict`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement** with `exceljs` (set `cell.value` to the `safeCell` string; hyperlink cells use `{ text, hyperlink }` with a relative path).
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5: Commit** `feat: execution log, defect register, Jira CSV and Markdown summary renderers`.

### Task 5: PDF modes

**Files:** Modify `portal/report_pdf.py` (`build_story`, `render`), `portal/pdf-report.mjs`; Test `portal/test/report-pack.test.mjs` (skip when ReportLab is missing, same guard as `report-pdf.test.mjs`).

**Interfaces:**
- Consumes: model JSON gains optional `report: { mode: 'full'|'bugs'|'summary', filterNote: string|null }`, `summary` (from `buildSummary`), and `findings` / `cases` already narrowed by `applyFilter`.
- Produces: `generatePdf(run, runDir, options?: { mode?: 'full'|'bugs'|'summary'; model?: object; name?: string }): Promise<string>` (default behavior unchanged; output file name prefix is the mode; fingerprint includes mode and options).
  - `summary`: page 1 only (hero, suggested verdict banner with "Suggested" wording, counts, open bugs by severity, risks, not-tested, comparison, filter note). No findings or case pages, no screenshots.
  - `bugs`: summary strip, findings register, finding detail pages with screenshots; no appendix of passed cases.
  - `full`: current output.
  - `pdfTimeoutMs` keeps the screenshots-based formula; `summary` mode passes `0`.

- [ ] **Step 1: Failing tests:** `summary mode renders exactly one page` (use `pypdf` when present); `bugs mode contains finding titles and no passed-case appendix heading`; `full mode output is unchanged for a run without options` (existing test keeps passing); `filter note appears on the first page when set`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement** the branches in `build_story` keyed on `model.get('report', {}).get('mode', 'full')`; reuse existing `Hero`, `metric_grid`, `StackedBar` and `case_detail` helpers.
- [ ] **Step 4:** Run `node --test portal/test/report-pdf.test.mjs portal/test/report-pack.test.mjs`; expect PASS.
- [ ] **Step 5: Commit** `feat: bugs-only and one-page summary PDF modes`.

### Task 6: Pack builder and estimate

**Files:** Create `portal/reports/pack.mjs`; Test `portal/test/report-pack.test.mjs`.

**Interfaces:**
- Consumes: `applyFilter`, `buildSummary`, renderers, `generatePdf`, `zipStream`/`crc32File` from `portal/zip.mjs`, `reportModel`.
- Produces:
  - `REPORTS: Record<'summary'|'bugs'|'log', { label: string; files: string[] }>` (`summary` → `01-Release-Summary.pdf`, `01-Release-Summary.md`; `bugs` → `02-Bug-Report.pdf`, `02-Bugs.xlsx`, `02-Bugs-for-Jira.csv`; `log` → `03-Execution-Log.xlsx`).
  - `type PackRequest = { reports: ('summary'|'bugs'|'log')[]; filter: ReportFilter; evidence: 'none'|'findings'|'final'|'all' }`.
  - `estimatePack(run, req: PackRequest): { cases: number; findings: number; screenshots: number; bytes: number; seconds: number }` (screenshots counted by evidence level over listed cases; bytes from real file sizes via `fs.statSync`, 0 when missing; seconds = 5 + 0.5 per screenshot embedded in a PDF + 0.01 per case).
  - `buildPack(opts: { run; runDir: string; req: PackRequest; who: string; previous?: object; now?: () => Date; onProgress?: (text: string) => void }): Promise<{ file: string; size: number; manifest: Manifest }>` writing `<runDir>/packs/<module>_<yyyy-mm-dd>_run-<id8>_<fingerprint8>.zip`.
  - `Manifest = { run: { id; name; module; environment; status }, generatedAt: string, generatedBy: string, reports: string[], filter: ReportFilter, filterDescription: string, evidence: string, listed: number, total: number, files: { path: string; bytes: number; sha256: string }[], missingEvidence: string[], modelVersion: number }`.
  - Folder `00-README.txt` (what is inside, filter used, how to read, the "Suggested verdict needs a person" line), selected report files, `evidence/<safe case id>/<n>-<stage>.png` per evidence level (`final` = attachment named like `Final result`, else the last image), `data/results.json` (redacted), `data/junit.xml`, `MANIFEST.json` last.
  - `safeSegment(text: string): string` (letters, digits, `-`, `_`, `.`; no leading dots; max 60 chars; duplicates get `-2`, `-3`).
  - Rejects with `HttpError(409)` for authentication runs, unfinished runs, and runs with no results.

- [ ] **Step 1: Failing tests** (fixture run directory with generated PNG files; read the ZIP with `jszip`, which ships with `exceljs`): `default pack contains README, selected reports and a manifest whose sha256 values match the files`; `evidence level findings only includes screenshots of listed findings`; `evidence level none includes no evidence folder`; `final level picks the Final result screenshot`; `case ids with ../ and : become safe unique folder names` (Review Focus); `a missing screenshot file is listed in manifest.missingEvidence and the pack still builds`; `zero matching cases builds a pack whose README says No cases match this filter and whose totals are intact`; `estimatePack counts screenshots by level and returns 0 cases for an empty match`; `unfinished and authentication runs are rejected`; `a 1000-case synthetic run builds with bounded memory` (heap growth under 200 MB, using file entries not buffers; skip PDFs by `reports: ['log']`).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement.** Render each selected report into a temp directory, then stream a single `zipStream` with `{name, file, size}` entries; hash files with `crypto.createHash('sha256')` over streams; write the ZIP to a temp name and rename.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5: Commit** `feat: report pack builder with manifest and evidence levels`.

### Task 7: Background jobs, routes, wiring

**Files:** Create `portal/reports/jobs.mjs`, `portal/routes/report-packs.mjs`; Modify `portal/server.mjs`, `portal/app/context.mjs`; Test `portal/test/report-pack.test.mjs`.

**Interfaces:**
- Consumes: `buildPack`, `estimatePack`, `previousRun` from `portal/compare.mjs`, `queue.dirFor(runId)`.
- Produces: `createReportJobs({ store, dirFor, logger }): { estimate(run, req); start(run, req, who): Job; list(runId): Job[]; get(runId, jobId): Job; filePath(runId, jobId): string }` with `Job = { id; runId; status: 'running'|'done'|'error'; startedAt; finishedAt; progress: string[]; request: PackRequest; result?: { file; size; manifest }; error?: string }`. Jobs persist as `<runDir>/packs/<jobId>.json` so the list survives a restart; a job found `running` at startup becomes `error: 'The portal restarted while this was building.'`. `start` with an identical fingerprint (run id, request, report-model fingerprint) while one is running returns the running job; when a finished pack with that fingerprint exists it returns a `done` job pointing at it.
- Routes (all use the existing run permission path, `report.view`): `POST /api/runs/:id/report-pack/estimate` → `{cases, findings, screenshots, bytes, seconds}`; `POST /api/runs/:id/report-pack` → 202 `{id}`; `GET /api/runs/:id/report-packs` → `Job[]`; `GET /api/runs/:id/report-packs/:jobId` → `Job`; `GET /api/runs/:id/report-packs/:jobId/download` → the ZIP as an attachment. Body is validated with `normalizeFilter`; `reports` must be a non-empty subset of `REPORTS` keys, `evidence` one of four values (400 otherwise). Audit event `run.report-pack` with the report list and filter description (never the file contents).

- [ ] **Step 1: Failing tests** (through `boot`, a seeded finished run): `estimate returns counts and 400 for unknown report or evidence level`; `start returns 202, the job finishes done and download returns a ZIP containing MANIFEST.json`; `identical concurrent requests return the same job id` (Review Focus); `a viewer can build but a user without access to the module gets 404`; `a stuck running job file becomes an error after restart`; `download of an unfinished job is 409`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement** jobs (in-memory map plus JSON files), routes (register in `server.mjs` after `health`), and expose `reportJobs` on the context.
- [ ] **Step 4:** Run `node --test portal/test/*.test.mjs`; expect PASS (route snapshot golden may need `UPDATE_GOLDEN=1` only if it lists routes; check the diff shows only additions).
- [ ] **Step 5: Commit** `feat: report pack jobs and routes`.

### Task 8: Report pack dialog and list

**Files:** Create `portal/public/pages/report-pack.js`, `portal/public/handlers/report-pack.js`; Modify `portal/public/pages/runs.js` (button beside the existing export buttons), `portal/public/app.js`, `portal/public/styles.css`; Test: browser check (Playwright script in the scratchpad, as in earlier phases) plus a `portal/test/report-pack.test.mjs` case asserting the dialog's request body builder.

**Interfaces:**
- Produces: `PACK_PRESETS` in `report-pack.js`: `developers` (`bugs`, filter preset `bugs`, evidence `findings`), `release` (`summary`, `{}`, `none`), `testlead` (`log`, `{}`, `none`), `default` (`summary`,`bugs`,`log`, `{}`, `findings`), `custom`; `buildPackRequest(formState): PackRequest` (pure, exported for the test); `showReportPackDialog(run)`.
- Dialog: "What do you need?" preset cards; a checkbox per report; filter section (result classes, priorities, suites, requirement, severity, free text, "only cases I ticked" when the run page has a selection); evidence level select; live estimate line (`37 of 1,000 cases, 61 screenshots, about 14 MB, about 40 seconds`) refreshed on change with a debounce; Create disabled and explained when the estimate says 0 cases; progress and Download link; list of earlier packs for the run with date, filter description and size.

- [ ] **Step 1: Failing test:** `buildPackRequest maps preset, ticked reports, filter fields and evidence level to the API body` and `custom preset with nothing ticked is rejected client-side`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement** the page module, handler (click, change, input with debounce, poll the job every 2 s until done), button in `runs.js` shown for finished non-authentication runs, and styles reusing existing panel and badge classes.
- [ ] **Step 4:** Run tests, then the browser check: seeded run with failures, open the dialog, choose "For developers", confirm the estimate, create, download, unzip, open `02-Bugs.xlsx`; expect no console errors.
- [ ] **Step 5: Commit** `feat: report pack dialog on the run page`.

### Task 9: Scale check, docs and final verification

**Files:** Modify `README.md`, `docs/superpowers/specs/2026-11-14-report-pack-design.md` (status line); Test `portal/test/report-pack.test.mjs`.

- [ ] **Step 1: Failing test:** `a 1000-case run with 3,600 screenshot entries estimates, builds the default log pack under 60 seconds and keeps the ZIP under 25 MB when evidence is none` (synthetic files, `reports: ['log','bugs']` with the PDF skipped when ReportLab is missing).
- [ ] **Step 2:** Run; expect FAIL or slow; fix any hot spots (avoid per-row `find` over results; index results by id once in `reportModel`).
- [ ] **Step 3: Document** in the README: the three reports, presets, filters, evidence levels, ZIP layout, background job, what the suggested verdict means and does not mean, how to read `MANIFEST.json`.
- [ ] **Step 4: Verify:** `npm run portal:check`, `npx tsc --noEmit -p tsconfig.json`, `node --test portal/test/*.test.mjs` (all pass), and one real-browser pass with the Chrome tools.
- [ ] **Step 5: Commit** `docs: report pack`.
