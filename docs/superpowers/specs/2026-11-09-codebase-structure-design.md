# Codebase structure redesign (portal + module plugins)

Date: 2026-11-09. Status: direction approved in chat by the user ("yeah let's fix our code then"). Written design for planning.

Progress: Plan 1 (structure) done; Plan 2 (module plugins) done; Plan 3 (delete rule; team sharing already existed) done.

## Intent
Test Studio is becoming a large multi-module testing platform. Today code is stacked in a few giant files and "registration" is hard-coded in many places, so each new module (Billing, EMR...) means copy-pasting ~10 files. Goal: a structure that scales to many modules and many contributors, and gives the upcoming team-sharing/permissions feature a clean home.

## Current state (verified by reading code)
- `portal/server.mjs` (1460 lines): `createPortal()` (line 46 to end) holds env setup, worker lock, sessions, access checks, all routes, jobs.
- `portal/public/app.js` (1839 lines) is one file; `portal/ai-generator.mjs` 729 lines; `portal/agent.mjs` 467.
- Store is SQLite (`node:sqlite`, `portal/store.mjs`), raw `node:http`, no Express.
- Portal is `.mjs`, tests are `.ts`; `portal/registry.mjs:9-11` loads TS via `createRequire`.
- Registration-only code duplicated per module: `tests/modules/registration/` (fields.ts, registration.page.ts, case-runner.ts, cases.spec.ts, workflow-runner.ts, report.ts, ...).
- Hard-coded `registration`: `portal/registry.mjs:47,168-226`, `portal/store.mjs:5`, `portal/ai-generator.mjs:41,69,98,194`, `portal/agent.mjs:59,62`, `playwright.config.ts:23`, `tests/discovery/module-discovery.spec.ts:30`, `tests/modules/registration/{cases.spec.ts:12, case-runner.ts:61,63,235, registration.page.ts:4,23}`.
- `qa/modules/<id>/adapter.json` loading exists (`registry.mjs:102-131`) but no non-registration module exists yet.

## Goals
- Split server into router / routes / services / data layers; server.mjs only wires and listens.
- Split store by table and `app.js` by page/component.
- Module plugin shape: a module declares fields, page, rules, cases through a standard manifest; shared base (page object, case runner, reporter, auth fixtures) is written once under `modules/_shared`.
- Remove every hard-coded `registration` reference from shared code.
- Behavior unchanged at every step; existing tests pass after each step.

## Non-goals
- No new framework (stay on node:http, SQLite, Playwright) and no TS migration of the portal (my call; revisit later).
- No change to the database schema or stored data in this work.
- Team-sharing/permissions feature is built AFTER the restructure, as a separate spec.

## Anti-goals
- Any step that breaks login, uploads, runs, or Registration test results.
- Big-bang rewrite that cannot be verified step by step.

## Target layout (my proposal, user approved the direction not every folder name)
```
portal/ server.mjs, http/, routes/, services/, data/, public/{app.js,pages/,components/,api.js}
modules/ _shared/, registration/, <future modules>/
```
Existing `tests/modules/registration`, `qa/modules/registration` move under `modules/registration` only in the plugin step; paths in package.json scripts, playwright.config.ts and `.claude/skills` must be updated with them.

## Order of work
1. Lock behavior with existing tests; split server.mjs into routes + services.
2. Split store.mjs and app.js.
3. Introduce module plugin manifest; move Registration into it, no behavior change.
4. Remove hard-coded `registration` references.
5. (Separate spec) team sharing + role-based deletion.

## Left to the builder
Exact file names inside each layer, router implementation, manifest format details, how to carry `.ts` module code into the `.mjs` portal (keep current loading until a decision is needed).

## Open items
- Not yet checked: which roles hold `case.delete` (relevant to step 5).
- Not a git repo, so there is no commit/branch safety net; take a backup copy before step 1 (my call).
