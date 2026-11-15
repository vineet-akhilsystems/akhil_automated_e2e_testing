> **Path layout changed on 2026-11-15** (qa/modules/<id> is now qa/<product>/<module>, and likewise for tests and portal/modules); see docs/superpowers/plans/2026-11-15-product-scoped-layout.md. The paths below are historical.

# Version-Aware Automation, Spike: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record which application version, configuration profile and automation version every run used, and show them (plus Registration as a read-only tree and a results matrix) in the portal, without changing how tests execute.

**Architecture:** A typed application version lives on the login profile with a per-run override; a read-only Playwright fixture fingerprints the configuration responses the pages already load; a content hash of the automation files gives automatic numbered automation versions (v1, v2, ...) stored in SQLite and stamped on each run; a hand-written `tree.json` is loaded, validated and rolled up against run results; a matrix view lines results up by (app version, profile, automation version).

**Tech Stack:** Node 24 ESM (`.mjs`), SQLite via `node:sqlite` (existing store), Playwright fixture (TypeScript), vanilla JS portal UI, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-15-version-aware-automation-design.md` (owner's decisions are recorded in it; "do what best" = defaults for the three open questions: new automation versions are created automatically when a run starts with changed content; the typed version lives on the login profile with a per-run override; the fingerprint is taken read-only from configuration responses the pages already load).

## Global Constraints

- The spike must not change how tests execute or what they assert. The capture fixture only listens to responses and can never fail, slow or alter a test (everything inside try/catch).
- Never read, print or store credentials; the fingerprint stores hashes only, never response bodies.
- A version label is never guessed: unknown shows as "unknown". Typed versions are trimmed, at most 40 characters, letters, digits, space and `. _ + / -` only, and always HTML-escaped in the UI.
- No new dependencies. Never stage `akhil_test_studio.pen`. `npm run portal:check`, `npx tsc --noEmit -p tsconfig.json` and `node --test portal/test/*.test.mjs` pass before every commit.
- Cases are not part of the automation version (they keep their own per-run snapshots).
- Seeing and comparing automation versions is read-only; re-running an old version is out of scope.

## Review Focus

- Profile fingerprint unstable between two runs of the same build (timestamps, ids, key or list order): a stability test with shuffled keys and volatile fields must give the same hash; a real change must change it.
- Automation hash noise: CRLF versus LF checkout (this repo shows LF/CRLF warnings), trailing whitespace, file order: same content must give the same number.
- Reverting a change returns to an earlier hash: it must reuse that earlier version, not create a new number.
- Two runs created at once with new content must not create duplicate or skipped numbers.
- Uncommitted working-tree changes: the version is labelled as uncommitted rather than pretending to match a commit.
- A run with no profile captured, no typed version, or an old run without these fields: shown as unknown, never blank or an error.
- Matrix and tree with 132 cases and many runs stay fast; a tree with a cycle, duplicate id or missing parent is rejected with a clear message.

## File Structure

| File | Responsibility |
|---|---|
| `portal/versioning.mjs` (create) | `normalizeAppVersion`, `describeVersion(run)` |
| `portal/profile.mjs` (create) | configuration normalization and `profileFingerprint` |
| `tests/fixtures/profile.ts` (create), `tests/fixtures/auth.ts`, `portal/reporter.cjs`, `portal/queue.mjs` (modify) | capture, attach, ingest the profile |
| `portal/automation-versions.mjs`, `portal/data/automation-versions.mjs` (create), `portal/store.mjs`, `portal/app/context.mjs` (modify) | fingerprint, numbering, storage, run stamping |
| `portal/routes/versions.mjs` (create), `portal/server.mjs` (modify) | automation-versions, tree and version-matrix routes |
| `portal/tree.mjs` (create), `qa/modules/registration/tree.json` (create) | tree load, validate, assign, roll up |
| `portal/version-matrix.mjs` (create) | matrix builder |
| `portal/public/pages/versions.js`, `pages/tree.js` (create), `router.js`, `pages/modules.js`, `pages/settings.js`, `components/dialogs.js`, `pages/runs.js`, `styles.css` (modify) | UI |
| `portal/quality.mjs`, `portal/reports/pack.mjs`, `portal/report_pdf.py` (modify) | version info in reports |
| `portal/test/versions.test.mjs` (create) | tests |

### Task 1: Typed application version on the profile and the run

**Files:** Create `portal/versioning.mjs`; modify `portal/environment-settings.mjs`, `portal/app/context.mjs` (`publicEnvironment`, `createRun`), `portal/public/pages/settings.js`, `portal/public/components/dialogs.js`, `portal/public/pages/runs.js`, `portal/public/handlers/main.js` (form fields); Test `portal/test/versions.test.mjs`.

**Interfaces:**
- Produces: `normalizeAppVersion(v: unknown): string` (trim; `''` if empty; throws `HttpError(400)` if longer than 40 or containing characters outside letters, digits, space, `. _ + / -`); an optional `appVersion` field on a login profile (saved, returned by `publicEnvironment`); `run.appVersion?: { label: string; source: 'run' | 'profile' }` set in `createRun` (body `appVersion` overrides the profile's); `describeVersion(run): string` = `"<label> (typed)"` and/or `"profile <6 chars> (detected)"` and/or `"automation v<N>"` joined by ` · `, or `"version unknown"` (later tasks add profile and automation fields to runs; this function reads them when present).

- [ ] **Step 1: Failing tests:** `normalizeAppVersion trims, accepts 1.58 and 2.0.66+hotfix, rejects <script> and 41 characters`; `a login profile saves and returns its appVersion`; `createRun stores the profile version and a per-run override wins`; `describeVersion handles none, typed only, typed plus profile plus automation`.
- [ ] **Step 2:** Run `node --test portal/test/versions.test.mjs`; expect FAIL.
- [ ] **Step 3: Implement** as described; the settings dialog gets an "Application version (optional)" input, the run dialog a same-named override input (blank = use the profile's), the run page header shows `describeVersion(run)` with escaped text.
- [ ] **Step 4:** Run focused test then full suite; expect PASS.
- [ ] **Step 5: Commit** `feat: typed application version on login profile and run`.

### Task 2: Configuration profile fingerprint

**Files:** Create `portal/profile.mjs`, `tests/fixtures/profile.ts`, `portal/test/profile-capture.spec.ts`; modify `tests/fixtures/auth.ts`, `portal/reporter.cjs`, `portal/queue.mjs`; Test `portal/test/versions.test.mjs`.

**Interfaces:**
- Produces: `VOLATILE_KEYS` (case-insensitive: `createdAt, updatedAt, modifiedAt, lastModified, timestamp, requestId, traceId, etag, token`); `normalizeConfig(value: unknown): unknown` (recursively drops volatile keys and sorts object keys; keeps array order); `profileFingerprint(parts: Record<string, unknown>): { hash: string; parts: Record<string, string> }` (sha256 hex of each normalized part; overall hash over the sorted part names and hashes; parts `webpart`, `formSchema`, `workflow`, `lookups`); `PROFILE_URL = /configuration-service\/(workflow\/get-workflow|webpart\/latest-version|form-schema\/latest-version|reference-lookup\/latest-version)/` mapped to part names; `profile.ts` auto fixture exported from `auth.ts`'s `test`: listens to `page.on('response')`, keeps JSON bodies of matching URLs, and on teardown attaches `profile.json` (`{ parts }` of hashes only, never bodies) when `PORTAL_RUN_DIR` is set; `reporter.cjs` copies the first `profile.json` attachment of a shard to `<shardDir>/profile.json`; `queue.mjs` reads `profile.json` from the run directory and each shard directory when syncing and sets `run.profile = { hash, parts, stable, shards }` (`stable: false` and `hashes` listed when shards disagree).

- [ ] **Step 1: Failing tests:** `normalizeConfig is independent of key order and ignores volatile keys`; `profileFingerprint is equal for shuffled and re-stamped input and different when a field's required flag changes` (Review Focus: stability); `lookups part changes when an option is added`; `queue run gets profile from events and marks stable:false when shards disagree` (fake launch pattern from `portal/test/queue.test.mjs`); a Playwright spec in `portal/test/profile-capture.spec.ts` (run by `portal/test/runner.config.ts`) using `page.route` to fulfil two configuration URLs and asserting the fixture attached hashes only and no body text.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement.** The fixture must swallow every error and must not call `page.route` (listening only).
- [ ] **Step 4:** Run `node --test portal/test/*.test.mjs` and `npx playwright test --config portal/test/runner.config.ts`; expect PASS; existing Registration specs still import `test` from `auth.ts` unchanged.
- [ ] **Step 5: Commit** `feat: read-only configuration profile fingerprint on runs`.

### Task 3: Automation versions

**Files:** Create `portal/automation-versions.mjs`, `portal/data/automation-versions.mjs`; modify `portal/store.mjs`, `portal/app/context.mjs` (`createRun`), `portal/services/access.mjs` (only if the default permission does not fit); Test `portal/test/versions.test.mjs`.

**Interfaces:**
- Produces: `automationFiles(root: string, moduleId: string): string[]` (repo-relative, sorted: `tests/modules/<id>/**` excluding result and generated folders, `qa/modules/<id>/{adapter.json,workflows.json,tree.json,rules.md}` and `qa/modules/<id>/versions/**`, `portal/modules/<id>/**`, `tests/fixtures/**`, `tests/shared/**`, `playwright.config.ts`; never `node_modules`, `results`, `discovery`, `cases`, `bugs`; at most 500 files); `fingerprintAutomation(root, moduleId): { hash: string; files: { path: string; sha256: string }[] }` (each file hashed after converting CRLF to LF; overall hash over sorted paths and hashes); `diffFiles(prev, next): { added: string[]; changed: string[]; removed: string[] }`; table `automation_versions(module_id, number, hash, created_at, document)` with `UNIQUE(module_id, hash)` and `UNIQUE(module_id, number)`; repo methods `automationVersions(moduleId)`, `automationVersionByHash(moduleId, hash)`, `saveAutomationVersion(record)`; `registerAutomationVersion({ store, root, moduleId, by, trigger, note, git }): Version` returning an existing record when the hash was seen before (a revert reuses the old number), otherwise number = highest + 1 assigned inside `store.transaction`, with `changedFiles` against the previous highest version, `gitCommit` and `uncommitted` from `git` (an injectable `async (paths) => { commit, dirty }`, default uses `git rev-parse HEAD` and `git status --porcelain` and swallows errors), `trigger: 'run' | 'manual'`; `Version = { number, hash, createdAt, createdBy, trigger, note, changedFiles, gitCommit?, uncommitted? }`. `createRun` for `mode: 'automated'` calls it (trigger `run`) and sets `run.automationVersion = { number, hash, uncommitted }`.

- [ ] **Step 1: Failing tests:** `same content gives the same number; CRLF and LF checkouts hash equal`; `changing one file creates v2 with that file listed under changed`; `reverting to the first content returns v1 again` (Review Focus); `two simultaneous registrations of new content create exactly one new number`; `uncommitted is true when git reports dirty`; `an automated run is stamped with automationVersion and a manual run is not`; `an unknown git failure leaves gitCommit undefined and still registers`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement** using a temp repo-like folder in tests (pass `root`); keep hashing synchronous and cheap (no content over 1 MB per file is hashed fully: hash the first 1 MB plus the size).
- [ ] **Step 4:** Run; expect PASS (the route snapshot golden may gain run fields: regenerate with `UPDATE_GOLDEN=1` only if the diff shows additions).
- [ ] **Step 5: Commit** `feat: automatic automation versions stamped on runs`.

### Task 4: Registration tree (read-only model)

**Files:** Create `portal/tree.mjs`, `qa/modules/registration/tree.json`; Test `portal/test/versions.test.mjs`.

**Interfaces:**
- Produces: `type TreeNode = { id: string; name: string; parent?: string; kind: 'root'|'step'|'variant'|'group'; match?: { registrationType?: string[]; category?: string[]; action?: string[] }; needs?: { versions?: string; capabilities?: string[] }; note?: string }` and `type Tree = { module: string; version: number; nodes: TreeNode[] }`; `validateTree(tree): string[]` (empty = valid; reports exactly one root, duplicate ids, missing parents, cycles, more than 6 levels, unknown kinds); `loadTree(root, moduleId): Tree | null` (reads `qa/modules/<id>/tree.json`; throws a clear `Error` listing validation problems); `assignCases(tree, cases): { byNode: Record<string, string[]>; unassigned: string[] }` (a case goes to the matching node with the most satisfied `match` keys; all keys a node declares must match; ties go to the first node in file order; nodes without `match` get no cases directly); `rollupTree(tree, byNode, results): Record<string, { total, passed, failed, blocked, other, subtree: {total, passed, failed, blocked, other} }>` (`failed` = FAIL, FAIL (assumed requirement), ERROR; `blocked` = BLOCKED; `other` = everything else including not executed). `tree.json` for Registration: root "Login and facility" (login is shared), then "Open Registration", then one variant node per registration type (New, New Born, International, Outside, Staff, Diagnostic), and under New groups by existing case suites (`phone, dob-age, search, mandatory, update, registration-type, name, address, ui, payer, real-names, identity, happy, email, duplicate, data-integrity`), with `match` rules built from the dataset's `category` and `registrationType` values.

- [ ] **Step 1: Failing tests:** `validateTree rejects a cycle, a duplicate id, a missing parent, two roots and a seventh level`; `assignCases prefers the more specific node and sends unmatched cases to unassigned`; `rollupTree sums children into subtree totals and counts FAIL, ERROR and assumed failures as failed`; `the shipped Registration tree is valid and attaches at least 95% of the 132 cases` (Review Focus; load the real dataset `qa/modules/registration/cases/registration-cases.json`).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement** and author `tree.json`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5: Commit** `feat: read-only Registration tree model`.

### Task 5: Version matrix and routes

**Files:** Create `portal/version-matrix.mjs`, `portal/routes/versions.mjs`; modify `portal/server.mjs`; Test `portal/test/versions.test.mjs`.

**Interfaces:**
- Produces: `buildMatrix(runs, { maxColumns = 8, onlyDifferences = false }): { columns: { key; label; appVersion; profile; automationVersion; runId; at }[]; rows: { caseId; title; cells: Record<string, string | null>; differs: boolean }[] }` (finished automated runs of one module; a column is the distinct combination of typed version label, profile hash and automation number; its cell is the case's result in the latest run of that combination; newest columns first; `differs` = more than one distinct non-null status across columns); routes under the module permission path: `GET /api/modules/:id/automation-versions` → each version plus `{ runs, passRate }` computed from finished automated runs stamped with that number; `POST /api/modules/:id/automation-versions` `{ note? }` → registers now (trigger `manual`), 201 when new, 200 with the existing version when unchanged; `PUT /api/modules/:id/automation-versions/:number` `{ note }` → 200; `GET /api/modules/:id/version-matrix?onlyDifferences=1`; `GET /api/modules/:id/tree?run=latest|<runId>` → `{ tree, assigned: byNode, unassigned, rollup, run: { id, name, at } | null }` (404 `No tree defined for this module.` when none).

- [ ] **Step 1: Failing tests:** `matrix groups runs by version combination and marks cases that differ`; `onlyDifferences hides cases with one status`; `old runs without version fields form an "unknown" column`; API tests through `boot`: list/create/idempotent create/note edit, tree route 404 for a module without a tree and 200 with rollup for Registration, matrix route; viewer can read, only module settings holders can POST/PUT (check against `modulePermission`).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement** (register the route file in `server.mjs` after the report-pack routes).
- [ ] **Step 4:** Run focused tests and the full suite; expect PASS.
- [ ] **Step 5: Commit** `feat: automation version, tree and version matrix routes`.

### Task 6: Versions and Tree tabs

**Files:** Create `portal/public/pages/versions.js`, `portal/public/pages/tree.js`; modify `portal/public/router.js`, `portal/public/pages/modules.js` (`moduleTabs`), `portal/public/styles.css`, `portal/public/app.js` if a handler file is added; Test: browser check plus a pure-helper test if you add one.

**Interfaces:**
- Consumes: the Task 5 routes. Produces: a **Versions** tab (`#/modules/<id>/versions`): table of automation versions (v number, date, who or trigger, changed files count with a details list, uncommitted badge, runs, pass rate, note with edit for people allowed to), a "Register current automation now" button, then the matrix with an "Only differences" toggle and column headings showing typed version, profile (6 chars) and automation vN; a **Tree** tab (`#/modules/<id>/tree`): indented read-only tree with per-node counts coloured by outcome, node note, click to show the node's cases, a header saying which run it reflects and an explanation that it is read-only and in the file `qa/modules/<id>/tree.json`. Everything escaped; unknown shown as "unknown".

- [ ] **Step 1:** Write the pure helpers first (label formatting, node colour class) with tests.
- [ ] **Step 2:** Run; expect FAIL; implement the helpers.
- [ ] **Step 3: Implement** the two pages, tab links (hide the Tree tab when the route returns 404), router loading, styles reusing existing classes.
- [ ] **Step 4: Browser check** (Playwright script in the scratchpad as in earlier phases, real Chromium): seed runs with two automation versions, two typed versions and different profiles; open both tabs; confirm counts, the "Only differences" toggle, the register button, no console errors; view screenshots and fix layout problems at desktop and phone width.
- [ ] **Step 5: Commit** `feat: Versions and Tree tabs`.

### Task 7: Version info in reports

**Files:** Modify `portal/quality.mjs` (`reportModel.run`), `portal/reports/pack.mjs` (manifest `run`, README.txt), `portal/report_pdf.py` (run details block), `portal/reports/xlsx.mjs` (Summary sheet); Test `portal/test/versions.test.mjs`.

**Interfaces:** `reportModel(run).run.version = { typed?: string; profile?: string; automation?: number; text: string }` where `text = describeVersion(run)` (profile shown as the first 6 characters of the hash); the pack manifest `run` and `00-README.txt` carry the same text; the PDF run details show "Version" and the Summary sheet shows a "Version" row; all text goes through the existing redaction. A run without version data shows "version unknown".

- [ ] **Step 1: Failing tests:** report model, manifest, README text, workbook cell and (when ReportLab is present) PDF text contain `1.58 (typed) · profile 3f9a1c (detected) · automation v4` for a stamped run and `version unknown` for an old run.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the full suite; expect PASS (existing report tests unchanged).
- [ ] **Step 5: Commit** `feat: version information in report packs`.

### Task 8: Documentation and verification

**Files:** Modify `README.md`, `docs/superpowers/specs/2026-11-15-version-aware-automation-design.md` (status line), `qa/knowledge/README.md` (one paragraph on versions); Test `portal/test/versions.test.mjs`.

- [ ] **Step 1:** Add a README section "Versions" covering: typed application version (profile and per-run), the detected profile and what it means, automatic automation versions (what is hashed, what is not, revert reuses the number, uncommitted badge), the Versions and Tree tabs, how to read the matrix, the read-only limits (no re-run of old versions, tree edited in the file), and what the spike deliberately does not do.
- [ ] **Step 2:** Update the design doc status line to "Spike implemented (see plan); later phases not started".
- [ ] **Step 3: Verify:** `npm run portal:check`; `npx tsc --noEmit -p tsconfig.json`; `node --test portal/test/*.test.mjs`; `npx playwright test --config portal/test/runner.config.ts`; confirm `git status` shows only `akhil_test_studio.pen` as unrelated.
- [ ] **Step 4: Commit** `docs: versions`.
