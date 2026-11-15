# Augastam Test Studio

A local web portal for the BA and QA teams to author cases, execute tests and review evidence across modules. Registration is the first connected automation module. Add any number of other modules under Setup, Patient Care, Finance, Operations or your own business areas.

## Start

Requires **Node.js 24 or later**, with the project's dependencies installed. This workspace was verified with Node.js 26.7.0.

```powershell
npm install
npx playwright install chromium
python -m pip install -r portal/requirements-report.txt
npm run portal
```

Open **http://127.0.0.1:4173**. The first launch imports the existing 132 Registration cases and its valid-data template into `.portal/portal.sqlite`. The original JSON and Excel datasets are preserved. Later changes in the portal belong to its database; they do not silently rewrite the source dataset.

If the portal is already running, `npm run portal` prints its existing URL and exits successfully. Continue using that server. For a server you started in a terminal, press Ctrl+C there before restarting it.

Open **Settings → Add login profile** to enter a profile name, website URL, username, password, tenant, facility and application role. Save, then choose **Refresh application login** on that profile. After the login run succeeds, open **Registration → Run cases**, select **Automated browser run**, the profile and your cases, then **Create run**. Review progress, cancel, rerun and download evidence in **Test runs**. No terminal commands are needed for this workflow after the portal is running. The default profile automatically shows your existing configured username, tenant, facility and role, and marks its password as configured (hidden). Leave the password blank when saving to keep that existing login. Legacy `.env` credentials and `npm run auth` remain available. Portal login and application login are separate.

Profiles are shared within the workspace. Developers, BAs and QA can create separately named profiles for their accounts, but this version does not provide private profiles or individual portal identities. Passwords are write-only: editing shows an empty password field; leave it blank to preserve the saved password on the same website. Changing the website requires a password. Saving resets that profile's session, and edits are blocked while its jobs are queued or running.

Credentials are encrypted with AES-256-GCM in `.portal/environment-settings.json`; the server key is `.portal/environment-settings.key`. Both stay outside reports, run snapshots and source control. Restrict filesystem access to the portal data directory and back up both files together. Encryption does not protect against someone who can read both the server key and settings file. Login recordings and raw worker output are suppressed to prevent password disclosure; login failures give a Settings troubleshooting message. The login adapter supports Augastam's username/password, tenant, facility and role flow. Adding another website URL does not create browser automation for a different product or an SSO/OTP flow.

## Automation health: retries, trends, alerts and schedules

- **Retries and flaky cases.** Automated runs retry a failing case once (`PORTAL_RETRIES`, 0-3, default 1). A case that fails and then passes is recorded as PASS with a **Flaky - passed on attempt 2** badge, and the first attempt's evidence is kept (`attemptHistory`). A case that fails every attempt stays a failure. Retries re-execute the case, so a case that creates data may create it twice; set `PORTAL_RETRIES=0` to switch retries off.
- **Trends.** Overview (whole product) and each module's Test cases tab show pass rate and duration across the last 30 automated runs, flaky and changed cases with their recent results, and the slowest cases. Flaky means passed on retry, or failed again after recovering two or more times. Changed means one new failure in recent runs (a regression, or one that was fixed). Skipped, observed and blocked cases are not counted; manual and cancelled runs are ignored.
- **Run alerts.** Settings > Run alerts posts a summary to a Slack/Teams/JSON webhook when an automated run ends (only on failures, errors or flaky cases; after every run; or never). The address is stored on the server and never returned to the browser. A failed delivery is logged and never affects the run.
- **Scheduled runs.** Settings > Scheduled runs starts a module's approved, executable automated cases at a set time on chosen days, as the person who created the schedule, using a saved login profile. It runs while the portal is running, fires at most once per day and catches up after a restart the same day. The application login session must still be valid; if not, the schedule records "Could not start" with the reason.
- **Quarantine.** Select cases in a module and choose **Quarantine**. They still run and report, but their failures do not fail the run, change the pass rate or trigger alerts; **Release** puts them back. Quarantine is a flag on the case, so it does not need re-approval.
- **Why did it fail?** Finished runs with failures show failures grouped by cause (login/session, application error, test data, element not found, timeout, expected result not met), cases that failed with the same message, and rule-based fix hints with a ready-to-paste prompt for the healer agent. These are hints only: nothing edits a test automatically. An assistant can add a written post-mortem over MCP (`get_run_failures`, `compare_runs`, `save_run_postmortem`). `get_run_failures` and `compare_runs` also carry a `versionDifferences` block (application version, login profile hash, automation version) with a plain-language HINT such as "Automation version differs (v3 vs v5): check the changed files before blaming the app"; it is a hint, never a verdict, and unknown values are shown as unknown. Read-only version tools: `list_automation_versions`, `get_version_matrix` (optionally `onlyDifferences`), `get_tree` (optionally `run` = `latest` or a run id) and `check_change_impact` (changed file paths in, coupled files to also check out, from `qa/impact-map.json`; credential and session paths are dropped, lists are capped). They use the same permissions as the matching portal pages and never return login profile keys.
- **Compare runs.** Each run page shows what changed since the previous finished automated run of the same module and login profile: newly failing, fixed, still failing, newly flaky, much slower, added and removed cases.
- **JUnit and CI.** `GET /api/runs/{id}/export?format=junit` (or the **JUnit** button) exports JUnit XML. `npm run ci:run` starts a run from a pipeline, waits, writes JUnit and exits 0/1/2. See [docs/CI.md](docs/CI.md).
- **Defect tickets.** Settings > Defect tickets connects GitHub Issues or Jira Cloud. **Create ticket** on a finding opens a ticket with expected/actual results (credentials and tokens removed) and stores the link on the finding. One ticket per finding. The access token is stored on the server and never shown again.
- **Accessibility.** Tick **Also check accessibility** when creating an automated run to scan each screen with axe (WCAG 2 A and AA). Findings appear on the run page and never fail a case. Automated checks find only part of the problems. Currently wired into the Registration case runner.

See `docs/competitor-gap-checklist.md` for what was compared and what remains.

## Senior-tester agent: tester knowledge, risk-first drafting and a reviewer pass

When the coding agent analyses a module's files it no longer works from the documents alone. It is briefed as a senior tester and given a **tester knowledge pack**: plain markdown that a person keeps up to date.

| File | What it holds | Who edits it |
|---|---|---|
| `qa/knowledge/mindset.md` | How an experienced tester thinks (risk first, boundaries, state, persistence, pairs, silent failures). Shared by every module. | Administrator |
| `qa/knowledge/domain/<product>.md` | Domain practice for the product (patient identity, minors, billing, consent, audit, roles). **`augastam.md` and `miracle.md` are drafts** for a senior tester to correct (each statement is labelled Confirmed, Observed, Practice or Ask). Falls back to `domain/default.md`. | Administrator |
| `qa/knowledge/modules/<module>.md` | Lessons for one module: defect patterns found, confirmed rules, what is undefined, ranked risks. `registration.md` is built from `rules.md` and the 11 confirmed bug reports; `emr.md` comes from the EMR video analysis and is observation only. See `qa/knowledge/README.md`. | Module lead (Module > **Tester knowledge** tab) |

- **Guidance, not requirements.** A fact that rests only on these notes is marked `basis: experience`, its automated expectation is forced to `assumed: true`, and the draft says a business analyst must confirm it. Uploaded files stay the only source of confirmed rules. If notes and files disagree, the files win and the disagreement goes to open questions.
- **Risk first.** Before writing cases the agent lists 5-12 ranked risks (impact, likelihood, what covers each). Every case says which risk it covers. The Review queue shows the risk, whether it is confirmed by a source file or tester experience, and the reviewer's note; the Intake tab shows the risks table.
- **Reviewer pass.** After the draft, a second agent run reviews it like a senior reviewer (duplicates, vague expected results, missing reopen-and-verify checks, missing valid partner cases, guessed expectations, priorities, gaps). The portal applies the review in code: it can improve cases, drop at most half, and add at most 8; every case still lands as a draft that a person approves. If the reviewer fails or is switched off the first draft is kept. Turn it off per analysis with the checkbox on the Intake tab, or globally with `AGENT_CRITIC=0`. It uses extra AI allowance.
- **Tolerant saving.** Agents write natural variants (a rule as `{"rule": ...}`, a flow as one sentence, a step as a bare string). The portal understands what it can, keeps the rest of the analysis, and lists what it skipped (`ingestNotes` on the insights). An analysis with nothing usable is still an error. A bare action with no expected result is folded into the next step instead of losing the case.
- **Budget.** The pack is capped (mindset 6k, domain 8k, module 8k characters) so the brief stays small.
- The next step that is not built yet is the learning loop: turning rejected cases and real defects from run results into lessons automatically. Today a lead adds lessons by hand.

## BA workflow

1. Open **Module library**. Use **Add module** for Facility Setup, User Setup or another area of the product. Choose an area, a module name and a case prefix.
2. Open a module and choose **Add test case**. Organize cases into suites/features and optionally add a requirement or ticket reference.
3. For a connected module, select an action, starting data template, input overrides and explicit expected checks. For any module, choose manual execution and enter ordered action/expected-result steps.
4. Filter cases by suite, priority or execution type. Select cases and click **Run selected**. One run contains one module, one execution type and one environment.
5. Automated runs enter a persistent FIFO queue. Manual runs let a tester record actual results and pass/fail/blocked/skipped status. Record every manual result, then close the run.
6. Review expected versus actual results and screenshots; download JSON, Excel or trace artifacts. Failed automation and a worker error are reported separately. Observation-only and assumed-rule cases remain visibly distinct.
7. Open **Coverage & gaps** in the module to review missing field assertions, workflow/variant definitions, never-run cases and stale results. Add agreed business requirements and reference their IDs in cases (comma-separated IDs are supported).
8. For a finalized run, use **Report details** to enter the author, release, build and notes. Use **Triage finding** to assign a severity, owner, external reference and impact. Choose **Download bug report (PDF)**.

## Coverage and final PDF reports

The coverage view distinguishes entering an input from asserting its behavior. A field appearing in the valid-data template is counted as exercised; it only has an explicit field check when a case defines a value, error, hint or persisted-value assertion. Manual steps are not automatically interpreted as field assertions. Workflow and variant counts describe defined cases, not verified behavior.

Execution coverage uses finalized runs in the selected environment. Editing a case or its starting-data template marks prior evidence stale. Assumed business rules cannot satisfy a requirement's current-pass count. Disabled, skipped, blocked, observed and unexecuted cases are not treated as verified passes. Business coverage can only be assessed against the requirement checklist the team defines; the portal cannot prove that undocumented requirements do not exist.

The final PDF includes a branded executive summary, scope and outcome counts, a classified findings register, reproduction procedures, captured inputs, explicit checks, expected/actual behavior, mismatches, triage, screenshot evidence and an appendix listing **every selected case**. The classes are:

| Classification | Meaning |
|---|---|
| Failed assertion | Observed behavior did not meet the stated expectation; a candidate defect requiring triage. |
| Business rule review | Failure against an expectation explicitly marked as an assumption. |
| Execution issue | Runner, session, environment or application access prevented verification; an application defect is not established. |
| Blocked test | A manual precondition/dependency prevented the test. |

Severity is separate from test priority and defaults to **Not assessed** for failed assertions. Other finding classes do not imply an application-defect severity. Report details and triage add context without rewriting execution results. Reports are generated locally on demand after the run finishes, with cached versions invalidated when the report model or renderer changes. A report-generation problem does not change the test outcome; Excel and JSON exports remain available.

Manual testers can attach PNG screenshots up to 4 MB when saving a case result, before closing the run. Updating that result retains its evidence. Automated runs capture full-page screenshots across execution stages (module/record open, inputs applied, save/update/search result and final case outcome) for every executed case—passed, failed, observed or errored. Non-fatal screenshot failures are recorded as explicit `evidenceWarnings` so a transient screenshot error does not mask or falsify the business assertion. The PDF embeds screenshots for both findings and passed/observed cases, and explicitly flags any executed case where a screenshot could not be captured, is unavailable, or contains no visible UI. Runtime inputs are captured for newly executed automated cases; historical runs label template inputs when resolved values were not captured.

The renderer excludes raw server responses and saved login/session files. Credential-like input fields, bearer strings and JWTs are redacted from report text. Screenshots reflect the application as captured and must be reviewed before external sharing. The original run evidence remains available in the portal.

PDF export needs **Python with ReportLab and Pillow**:

```powershell
python -m pip install -r portal/requirements-report.txt
```

Set `PORTAL_PYTHON` to an absolute interpreter path if `python` is not on PATH. The report renderer uses Segoe UI on Windows, DejaVu Sans on Linux when available, and available fallback glyphs for Unicode; unsupported glyphs are represented explicitly by code point rather than as black squares.

## Report packs

A report pack is one ZIP with the reports a given reader needs, built in the background from a finished run. Open a finished run and choose **Report pack**.

**The three reports**

| Report | For | Files |
|---|---|---|
| Release summary | Managers and release owners | `01-Release-Summary.pdf` (one page) and `.md` (for chat or email), with the suggested verdict |
| Bug report | Developers and the people triaging | `02-Bug-Report.pdf` (findings grouped: failed assertions, business-rule reviews, execution issues, then blocked cases), `02-Bugs.xlsx` (defect register with the captured inputs and evidence links), `02-Bugs-for-Jira.csv` (failed assertions and business-rule reviews only, with steps and captured inputs; quarantined findings left out) |
| Execution log | QA leads and auditors of the test record | `03-Execution-Log.xlsx`, one row per listed case with evidence links |

**Choosing the cases.** In the dialog, pick a card (For developers, For the release decision, For the test lead, Standard pack or Custom), then optionally open **Which cases**. Its **Quick filters** buttons (Bugs only, Failures and blocked, Needs triage, P0 and P1, Everything) fill the filter controls below them: result class, priority, suite, requirement, severity and contains-text. Owner, a list of case ids, manual or automated (a single choice), variant, and the switches assumed rules only, new failures only and missing evidence only are available through the API (`filter` in `POST /api/runs/<id>/report-pack`); the dialog does not show them yet.

Text filters ignore upper and lower case. A requirement filter matches any one of a case's requirement ids (ids separated by commas, semicolons or new lines). **New failures only** keeps open failed assertions and assumed-rule failures (not quarantined) that were not failing in the previous finished run of the same mode, module and environment, which is the same rule the summary uses for "newly failing"; when there is no previous run the estimate and the pack README say so, and every failure counts as new.

A filter only changes which cases are listed. The totals, pass rate and suggested verdict always cover the whole run and are labelled as unfiltered, so a narrow pack cannot make a run look healthier than it is.

**Evidence levels.** `none` (no screenshots), `findings` (all screenshots of the listed findings), `final` (those, plus the final screenshot of every other listed case) and `all` (every screenshot of every listed case). Use the estimate shown in the dialog (cases, screenshots, size, time) before building. A pack must fit one ZIP; if not, choose fewer cases or a lower level.

**ZIP layout.** Everything sits in one root folder named `<module>_<date>_run-<id>`:

```text
00-README.txt        what is inside, the filter used, whole-run totals, how to read it
01-/02-/03- files    the selected reports
evidence/<case>/     screenshots, when an evidence level above none is chosen
data/results.json    the whole run's results, with secrets removed
data/junit.xml       the whole run as JUnit XML
MANIFEST.json        every other file with its size and SHA-256, written last
```

**Reading `MANIFEST.json`.** It records the run, who generated the pack and when, the reports, the filter (and a plain-language description), the evidence level, `listed` of `total` cases, and `files`: each file's path, byte size and SHA-256. To check that a file is unchanged, hash it (for example `certutil -hashfile <file> SHA256` on Windows) and compare. `missingEvidence` lists screenshots that were selected but could not be included, and why.

**Background job.** Building does not block the page. At most two packs build at the same time; a further one waits as queued ("Waiting for another report to finish") and starts by itself. Each person can have one pack waiting or building per run: asking for a different one meanwhile is refused until it finishes, while asking for the same pack again returns the one already under way. The dialog shows progress and a download link when it is done; you can close it and come back, and **Earlier packs for this run** lists waiting, building and failed packs as well as finished ones. An identical request (same run results, choices, pack format and PDF renderer) reuses the finished ZIP. Packs and their job records are kept in the run folder at `<run>/packs/` and can be downloaded again from the run page (the run's general file route does not serve that folder). Nothing is deleted automatically yet.

When the portal stops it waits up to 10 seconds for packs still building; press Ctrl+C a second time to stop at once. A pack that was waiting or building when the portal stopped is shown as failed after the next start (build it again), and its partial files are removed then.

**The verdict is a suggestion.** The summary shows a suggested verdict (Release, Release with known issues, Needs triage, or Do not release) worked out only from the recorded results and the exit criteria. A person must confirm it before any release decision. The pack is a test record, not an approval or an electronic signature, and nothing here claims regulatory compliance.

Default exit criteria, applied in this order: **Do not release** when any open failed assertion has Critical or High severity; otherwise **Needs triage** when the run ended as cancelled, interrupted or error (not every case was verified), when no case was executed and verified (no pass, failure, assumed-rule failure or execution issue), when any open failed assertion has no severity assessed, any case had an execution issue (runner or environment problems mean the product was not verified), or any case was blocked; otherwise **Release with known issues** when other open findings remain; otherwise **Release**, whose reasons say how many cases were not executed or not verified (see Not tested in the summary). Quarantined findings are not counted as open.

**Security fix included.** The JSON, JUnit and Excel exports of a run now redact credential-like fields, bearer strings and JWTs in the same way as the PDF.

**Planned.** Phase B: an interactive HTML evidence report, plus requirements coverage and automation-health reports. Phase C: a release pack across several runs, a recorded approval and retention rules for old packs.

## Change-impact check

`npm run impact` reads your changed files (working tree by default; `-- --staged` or `-- --range A..B` to choose) and, using `qa/impact-map.json`, prints "You changed X -> also check Y (why)", marks each target "changed too" or "NOT in this change", and lists commands to verify. `--strict` exits 1 when a target is missing, `--json` gives machine output, and `--validate` fails when a map path no longer matches anything. Rules marked `severity: "advisory"` (for example audit-actions, which fires on any route change) are shown but never counted by `--strict`. The map is a safety net for known couplings, not a replacement for tests. Credential and saved-session files are never read and never listed. See `.claude/skills/checking-change-impact/SKILL.md`.

## Versions

The portal records which application version and which automation version each run used, so results can be compared across versions. This is a spike: it records and displays, it does not change how tests run.

**Application version (typed).** Type the version on the login profile (environment settings). A run uses the profile's value unless the run dialog supplies an override. The run stores the label and where it came from (profile or override). The **Re-run failures** and **Rerun all cases** buttons open the run dialog with the original run's version label already filled in, so the re-run keeps it unless you change or clear the box (if the original run had no version, the box is blank and the profile's current value applies). The API route `POST /api/runs/<id>/rerun-failures` keeps the original version exactly (label and source) and records `rerunOf`.

**Detected profile (automatic).** While a run executes, the reporter notes which configuration-service endpoints the application answered and builds a fingerprint from those responses. Each key is made of the endpoint path and a short hash of its non-cache-buster query parameters, so keys never contain query text. The portal derives the parts and an overall hash from the keys, shown as a short code (6 characters). A key is marked unstable only when the same key returned different content within one run. Runs of different case subsets touch different endpoints, so a partial-subset run gives a different overall hash than a full run; this is a known limitation, and comparing on common keys is not built. The detected profile helps spot that two runs saw different application configuration; it does not state a version number.

**Automation versions (automatic).** At run start the portal fingerprints the automation files (a content hash of the test code and module files; line endings are normalised, run results and evidence are not hashed) and looks up the hash. A new hash becomes the next number (v1, v2, ...); numbers are per portal database, so another portal install numbers the same files differently and the hash (shown in the API, not as a table column) is the only portable identity; an unchanged hash reuses its number, so reverting a change returns to the earlier number. The run stores the number and hash. The version record keeps who or what registered it, any note, the git commit (when available) and an **uncommitted** badge when files differ from that commit; an uncommitted version shows its git commit together with the badge. Git details are added in the background after registration. If the files cannot be read, the run starts without a version rather than creating a spurious one.

**Versions tab (module page).** Lists each automation version with its number, date, who or what created it, run count, pass rate, changed files since the previous version and the current marker (the version whose hash matches the files now, which after a revert is not always the highest number). You can edit a version's note and press **Register current automation now** to record the current files as a version without running. Below the list is the **matrix**: rows are cases, columns are version combinations (typed application version, detected profile, automation version; at most 8, newest first), cells are the case's newest result across the finished automated runs of that combination (runs with no results are ignored, so a partial re-run only replaces the cases it ran). Tick **Only differences** to hide rows whose result is the same in every column. A blank cell means no run of that combination has a result for the case.

**Tree tab (read-only).** Shows how a module's cases group under steps, variants and groups, with the latest run's results rolled up per node. Developers edit the tree in the file `qa/modules/<module>/tree.json`; the portal never writes it. Format:

```json
{ "module": "registration", "note": "optional text",
  "nodes": [
    { "id": "root", "name": "Registration", "kind": "root" },
    { "id": "walkin", "name": "Walk-in", "kind": "variant", "parent": "root",
      "match": { "registrationType": ["Walk-in"] } } ] }
```

Validation rules: module and node ids match `/^[A-Za-z0-9_-]+$/`; exactly one root, without `match`; every other node has an existing `parent`; node names are unique; `kind` is `root`, `step`, `variant` or `group`; `match` keys are `registrationType`, `category` or `action`, each a non-empty array of strings; no cycles; at most 6 levels. A case goes to the node with the most matching keys (ties go to the first in file order). Cases that match no node appear in the **unassigned** list. An invalid file is reported with its first errors (HTTP 422) and the tab shows the message. When a module has a valid tree, the AI drafting agent's brief lists the node ids and names, and a proposed case may carry an optional `node`; a valid id is kept only as a `suggestedNode` flag on the draft (a person still places the case), and an unknown id is ignored without failing the job.

**API.** All under `/api/modules/<id>/`: `GET automation-versions` (versions, current hash and number), `POST automation-versions` (register now, body `{ "note": "..." }`; returns the existing record with `existing: true` if the files are unchanged), `PUT automation-versions/<number>` (body `{ "note": "..." }`), `GET version-matrix?onlyDifferences=1`, `GET tree` (optional `?run=latest` or `?run=<runId>` for the rollup). Reading needs module view access; registering and editing notes need module settings access, and both are audited.

**Report packs.** The pack `00-README.txt` ("Version:" line), the PDF run details and the workbook Summary sheet carry the run's version text, for example `1.58 (typed) · profile a1b2c3 (detected) · automation v2`, or "version unknown" for older runs. In `MANIFEST.json`, `run.version` is that text as a string; in the internal report model, `run.version` is an object (typed, profile, automation and `text`). The bug register workbook, Jira CSV and HTML report do not carry a version yet.

**Limitations.**
- Re-run buttons prefill the original run's version (editable); older automation versions cannot be run again (the portal stores fingerprints, not copies of the code).
- Versions are never retired or deleted.
- The tree is edited by developers in files; there is no tree editor.
- The Tree tab checks for a tree file only on modules with an automation adapter.
- The detected profile is read only from configuration responses seen during the run; it is not a complete description of the application.
- This branch builds on the report-pack branch, which must merge first.
- Verdicts stay "Suggested" and need a person to confirm them; version data is context for that decision, not an approval.

## Multiple modules

The hierarchy is **workspace → business area → module → suite → test case**, with executions stored separately. Business areas and suites are labels in this version; they are not nested folders. Module cards show whether automation is connected. Creating a module never claims that its browser automation already exists.

The interface is driven by [portal/registry.mjs](portal/registry.mjs), which combines module plugins (`portal/modules/`) with `qa/modules/<id>/adapter.json` files; see [Adding a module](#adding-a-module). A development team adds a module's automation adapter, page objects and case spec, then associates the module with that adapter. Registration's schema illustrates the contract: available actions, fields, outcomes and variants. The execution supervisor obtains the trusted spec path from the registry, never from a user-supplied command.

For the next automation module:

1. Implement its page objects and a data-driven Playwright spec under `tests/modules/<module>/`.
2. Read the run snapshot from `CASES_FILE`, including shared starting data. Emit a `<case-id>-result.json` attachment using the existing result shape (`id`, `title`, `status`, `expected`, `actual`, `mismatches`, `durationMs`).
3. Add the adapter definition (a plugin's `adapter.mjs`, or an `adapter.json`) and its field/action validation (a plugin's `validate.mjs` hooks). If the module needs a new assertion type, extend the structured editor and validation together.
4. Associate the module with the adapter through a reviewed database migration or seed. This is intentionally a developer-managed connection, not an editable shell command in the UI.
5. Verify that all output honors `PORTAL_RUN_DIR` / `PORTAL_REPORT_DIR` and that authentication uses `AUTH_DIR`. Run a small, controlled case before enabling wider suites.

The initial adapter covers Registration's existing actions and checks. A general recorder, arbitrary natural-language execution and cross-module workflow orchestration are future work.

## Adding a module

There are two ways to add a module, depending on whether it needs custom logic.

**(a) No custom code.** Add `qa/modules/<id>/adapter.json` and a data-driven spec at `tests/modules/<id>/*.spec.ts`, exactly as before. The registry picks the adapter up automatically. See the `onboarding-portal-modules` skill ([.claude/skills/onboarding-portal-modules/SKILL.md](.claude/skills/onboarding-portal-modules/SKILL.md)) for the full procedure.

**(b) Module with custom logic.** Create a plugin under `portal/modules/<id>/`: `adapter.mjs` (required), plus optional `validate.mjs`, `seed.mjs`, `ai.mjs` and `agent.mjs`. An `index.mjs` builds the plugin object, checks it with `assertPlugin` and calls `registerPlugin` (see [portal/modules/registration/index.mjs](portal/modules/registration/index.mjs)). Add ONE import line for that `index.mjs` in `portal/registry.mjs`, the way `modules/registration/index.mjs` is imported; the store and `portal/ai-generator.mjs` reach it through their imports. Plugins are repo code and are never loaded from user-supplied paths. Hooks are documented in [portal/modules/contract.mjs](portal/modules/contract.mjs):

- `id` (required) - unique module id.
- `adapter` (required) - fields, actions, outcomes, variants and spec path, same shape as an `adapter.json`.
- `builtIn: true` (required) - reserves the id so an `adapter.json` cannot override it.
- `validate.afterOutcome(c, ctx)` (optional) - extra checks after the generic action/outcome checks.
- `validate.blockedSource(c, ctx)` (optional) - returns the reviewed source case used for blocker checks of `unavailable` cases.
- `validate.checkInput(key, value, ctx)` (optional) - per-input-field checks after the generic ones.
- `validate.workflow(c, ctx)` (optional) - validates workflow cases; return true when handled.
- `validate.afterWorkflow(c, ctx)` (optional) - checks for cases the workflow hook did not handle.
- `updateTargetLabel` (optional) - label for the Update action's target text check.
- `seed(store)` (optional) - seeds the module on a fresh data directory (runs under the global empty-database guard).
- `ai` (optional) - AI-generation data: presets, curated case pool, requirement map.
- `agent` (optional) - reference files directory/label and cross-field example text for the coding agent.
- `discovery: true` (optional) - live discovery output counts as existing when its folder is non-empty.

`registrationType` is the generic variant key stored on every module's cases; the name is kept for compatibility. `tests/modules/registration` and `qa/modules/registration` stay where they are. Test-side paths go through `tests/shared/module-paths.ts`. Run `npm run portal:check` and `npm run portal:test` after any change.

## Shared data and imports

Run `npm run reg:pipeline` to execute **current enabled automated Registration cases from the portal database**, including portal-only additions and edits. Use `npm run reg:pipeline -- --list` to inspect discovery without application access. This command snapshots current cases and shared templates, includes prerequisites, validates definitions, and checks the application session before executing cases. Manual and disabled cases are excluded. `PORTAL_DATA_DIR` selects a different local portal database; `BASE_URL` and `AUTH_DIR` must match the intended application environment. Each execution writes a `*-pipeline-status.json` beside its input snapshot under `qa/modules/registration/results/automation-inputs`, including manual exclusions and preflight-blocked status. See [current pipeline review and limitations](docs/registration-pipeline-review.md).

The latest additions and live outcomes are listed in [registration workflow extension](docs/registration-workflow-extension.md).

Registration workflow automation is documented in [implementation progress and required resources](docs/registration-e2e-progress.md). Run `npm run reg:e2e` for the 46-case workflow suite (with a session preflight), `npm run reg:inventory` for a read-only control inventory, and `npm run reg:automation:install` to add missing new automation IDs to a local portal database. These definitions await live verification after application login refresh; their presence does not establish a passing test result.

The original 80 workbook IDs now use automatic execution in this local portal. **21 have executable browser mappings; 59 remain not automated and return BLOCKED with a specific reason.** They do not open manual result-entry forms, execute application assertions, count as passes, or count as executable automation. See the [complete current case matrix](docs/registration-workbook-current-coverage.md). Ready cases can pass or fail against the original workbook expectations. Old manual runs and source procedures remain preserved as history.

For a new local database, the server administrator can run `npm run reg:automation:install`, `node qa/tools/import-registration-workbook.mjs --import`, then `npm run reg:workbook:connect`. The connection command preserves edited procedures, backs up existing definitions under `.portal/migrations`, converts matching original IDs and refuses to run during queued/active jobs. It can upgrade previously connected mappings as new workflows become available. The original workbook and audit source JSON are preserved. Normal team operation uses the UI after setup.

Workbook source contracts and procedures are locked together; their title, suite, priority, requirement, preconditions, notes and enabled state remain editable. A changed procedure or automation contract needs a reviewed code mapping update. JSON and Excel exports retain source provenance and blocker reasons. Missing workflows are visibly marked Not automated in the case list, run dialog and coverage view.

**Shared data** manages named starting templates such as `valid`. A case overrides only the fields it needs. A run captures the entire template and case set at creation time. Edits cannot change old runs.

Tokens include `{{phone}}`, `{{phone2}}`, `{{today}}`, `{{seqWord}}` and references such as `{{regId@REG-001}}`. Required prerequisite cases are included and ordered before dependent cases; missing, disabled or cyclic prerequisites are rejected before queuing.

JSON export preserves all fields. Excel exports retain the case fields, manual steps, boolean inputs and expected checks. In Excel, a blank input cell means no override; **`<EMPTY>` explicitly clears a template value**. Manual steps are stored as JSON in the `steps` cell. Imports add **new case IDs only** and validate the entire batch before saving. Existing cases are edited in the portal with version-conflict protection. Full JSON exports include templates for reference; importing cases does not overwrite shared templates.

## Sharing the portal database through git

The live database (`.portal/`) is never committed. Instead `portal-data/snapshot.json` carries the shared team data: users (password hashes), products, modules, cases, insights, teams, access memberships, the AI quality settings, and the **login profiles for Miracle and Augastam including their passwords**.

> **The repository must stay private.** The login passwords are encrypted, but the key that decrypts them is stored in the same file (a team decision, so a fresh clone can log in at once). Anyone who can read the repo can read those passwords. Do not make the repo public or add outside collaborators without removing `credentials` from the snapshot first.

- **New machine:** `git pull`, put `PORTAL_ADMIN_USER` and `PORTAL_ADMIN_PASSWORD` in your local environment file (the same values everywhere give the same admin login; the environment file is never committed), then start the portal. A brand-new data folder loads the snapshot, profiles included, on first start. Press "Refresh application login" once per profile: browser sessions are per machine and are not shared.
- **Share your changes:** run `node qa/tools/portal-snapshot.mjs export`, review the diff and commit `portal-data/snapshot.json`.
- **Pick up a teammate's changes later:** stop the portal, `git pull`, run `node qa/tools/portal-snapshot.mjs import --force` (it replaces the local users, modules, cases, teams, settings and login profiles), start the portal.
- **Not shared (per machine):** runs and reports, the audit log, AI usage history, saved login sessions and uploaded files (videos are too large for git).
- The snapshot is one JSON file, so two people editing cases at once can still conflict in git. Export, commit and push often, and pull before you export.

## AI cost and quality settings

Administrators choose **Economy**, **Balanced** (default) or **Best quality** in Settings > AI usage, and an optional daily job limit. The portal then picks the lightest capable model for each job, caps how much it reads, limits the number of steps, and records the tokens used. Routing rules and numbers: `portal/ai-policy.mjs` and `.claude/skills/routing-work-to-models/SKILL.md`.

## Team access

Local mode binds to `127.0.0.1`. For a trusted internal server, configure an access key and network binding before starting:

```powershell
$env:PORTAL_HOST = '0.0.0.0'
$env:PORTAL_ACCESS_TOKEN = '<a-long-random-access-key-at-least-16-characters>'
npm run portal
```

Team members visit `http://<server-ip>:4173` and enter the shared workspace key. Set `PORTAL_PUBLIC_HOST` to your hostname if using a DNS name or reverse proxy. Use HTTPS at the proxy when access crosses a trusted local network. This version provides a shared workspace key, **not individual accounts, role-based permissions or an audit identity for each person**. Do not expose it as a public service.

Other settings:

| Variable | Default / purpose |
|---|---|
| `PORTAL_PORT` | `4173` |
| `PORTAL_DATA_DIR` | `.portal` in this repository |
| `PORTAL_PYTHON` | `python`; interpreter used for local PDF generation |
| `PORTAL_HOST` | `127.0.0.1` |
| `PORTAL_ACCESS_TOKEN` | Optional locally; at least 16 characters for a network binding |
| `PORTAL_PUBLIC_HOST` | Optional accepted hostname for a reverse proxy |
| `PORTAL_ENVIRONMENTS` | JSON array of `{id,name,url,authDir}` configured by the server administrator |

Example environment configuration:

```json
[
  {"id":"demo","name":"Demo","url":"https://demo.augastam.com","authDir":".auth"},
  {"id":"uat","name":"UAT","url":"https://your-uat-host.example","authDir":".portal/auth/uat"}
]
```

Settings profiles override server-configured profiles with the same ID and persist across restarts. Each settings profile uses its own versioned session directory. Legacy profiles continue to use `AUGASTAM_*` until saved through Settings. Ordinary run requests select a configured profile ID; they do not supply website URLs or credentials. Settings writes use the existing workspace authentication and same-origin protection. Use HTTPS for shared deployments when entering credentials over a network.

Exactly one server owns each data directory. Queued runs survive restarts; a run active during a shutdown becomes `interrupted` rather than being reported as successful. Runs execute sequentially to protect sessions and the existing browser workflow. This is a single-server implementation, not a distributed worker service. Scheduling, cross-module test plans, SSO and user permissions can be added later.

## Access control

Once user accounts exist, access is scoped. An administrator creates users and products; people see only the products and modules they have been given. A **membership** gives a person or a **team** a preset role (Viewer, Business analyst, Tester, Module lead, or Product owner at product scope) on a module or a whole product, with optional per-permission tick-boxes and an expiry date. Modules and products you cannot see do not exist for you (404), permissions are recalculated on every request, and nobody can approve a case they created or last changed (switchable per module by its lead). Module leads and product owners manage their own people from the module and product pages; every access change is written to an audit log. Existing `tester`, `ba` and `viewer` accounts keep their day-one access through a product-level membership on Augastam. Details for administrators and leads: [docs/ACCESS_CONTROL.md](docs/ACCESS_CONTROL.md).

## Data and evidence

- `.portal/portal.sqlite`: modules, case versions, run snapshots and results.
- `.portal/runs/<run-id>/`: input snapshot, isolated runner output, screenshots, traces, reports and log.
- `.auth/`: existing application session, excluded from source control.

Back up the whole `.portal` directory while the server is stopped, including any SQLite WAL/SHM files if present. Back up session files separately only if your team's policy allows it. Test runs can create/update records in the selected environment. Use a test environment and synthetic data.

Legacy commands such as `npm run reg:cases` still use the original case dataset. Portal runs now honor JSON `CASES_FILE` overrides and keep reports in their own folders instead of overwriting legacy latest reports.

## Portal code layout

- `portal/server.mjs` - composes the pieces, listens, and holds the CLI entry. `createPortal(options)` is its public API.
- `portal/app/` - config, `createContext(options)` (the shared `ctx`) and the worker lock.
- `portal/http/` - request helpers: body reading, `json()`/security headers, the router, static file serving, brand name.
- `portal/routes/` - one file per route group; each exports `async (ctx, rc) => boolean`.
- `portal/services/` - business logic (sessions, access control, membership and so on) used by routes.
- `portal/data/` - persistence helpers behind the store.
- `portal/public/` - the browser UI (ES modules served as static files).

To add a route: create a file in `portal/routes/` that exports `async (ctx, rc) => boolean` (return true when handled), import it in `portal/server.mjs` and add it to the router array. Order matters because the first handler that matches wins, and the `auth` and `gate` routes come first, and `gate` runs before every other `/api` route (principal and access checks happen there).

## Verification and API

```powershell
npm run portal:check
npm run portal:test
npx tsc --noEmit
```

The API tests exercise a real local HTTP server and temporary SQLite databases, including PDF downloads and missing-renderer handling. Worker supervision tests inject a controlled child process; those checks do not validate the EMR. The browser test exercises the portal itself, including adding multiple modules, requirement coverage, manual screenshot evidence, report metadata/PDF download, automated-case editing, shared data and mobile layout. Four executor regression checks exercise assertion behavior against controlled page-object methods; these are local logic checks, not a live EMR test. Screenshots are written to ignored `portal/test-output/`.

Unsupported assertion/action combinations are rejected before portal execution. ID-proof upload automation remains explicitly pending; its inherited case is disabled, and an enabled upload placeholder is rejected rather than silently ignored. A requested persisted-value check fails if no successfully saved record is available.

The local interface is documented in [portal/openapi.json](portal/openapi.json). [The research report](docs/testing-portal-research.md) explains the source patterns, design decisions, boundaries and next steps.

## Deploying and team use

For a shared server, run Test Studio in Docker behind an HTTPS reverse proxy: copy `.env.example` to `.env`, set `PORTAL_ADMIN_PASSWORD` and the other values, then run `docker compose up -d --build`.

The compose file stores `.portal` in a persistent volume, publishes the port on `127.0.0.1` only, checks `GET /api/health`, and gives Chromium enough shared memory. Target URLs and credentials are configured per project in Settings login profiles, not in the image. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Caddy/HTTPS, first admin setup, backup/restore, upgrades, sizing and the security checklist.
