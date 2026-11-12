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
