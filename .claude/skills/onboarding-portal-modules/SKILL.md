---
name: onboarding-portal-modules
description: Use when adding, scaffolding, or connecting browser automation for a new Augastam EMR module in Test Studio (such as Billing, Appointment, Facility Setup, User Setup, Admission, or OPD), creating a module adapter (adapter.json or a portal/modules plugin), or turning a manual portal module into an automated Playwright module.
---

# Onboarding portal modules

**Core principle:** every automated module in Test Studio is driven by a declarative adapter (`qa/modules/<module>/adapter.json` or a plugin in `portal/modules/<module>/`, loaded by `portal/registry.mjs`) paired with a read-only discovery spec, a Page Object, and a data-driven Playwright runner under `tests/modules/<module>/`. Creating a module in the UI never claims automation exists until its adapter is registered and verified.

## Quick reference

| Artifact | Repo path | Purpose |
|---|---|---|
| Adapter registry | `portal/registry.mjs`, `portal/modules/` | Loads plugin adapters and `adapter.json` files; declares `fields`, `actions`, `outcomes`, `variants`, `spec`, and validation rules |
| Coding agent runner | `portal/agent.mjs` | Generates draft cases (`<job>/output/insights.json`) and proposals (`<job>/output/automation/`) |
| Reference discovery | `tests/modules/registration/discovery.spec.ts` | Read-only walk capturing `.registration-card` / `.form-group` fields and `configuration-service` responses |
| Reference field map | `tests/modules/registration/fields.ts` | Maps field keys to `{ card, label, kind, column }` and `FILL_ORDER` |
| Reference page object | `tests/modules/registration/registration.page.ts` | Encapsulates locators, React-Select menus, network waits, and `assertAgentRecord()` |
| Reference runners | `tests/modules/registration/cases.spec.ts`, `tests/modules/registration/case-runner.ts` | Reads `CASES_FILE`, runs actions, captures stage screenshots, attaches `<id>-result.json` |
| Generic discovery (read-only) | `tests/discovery/module-discovery.spec.ts`, `npm run module:discover` | Needs `MODULE_ID`, `MODULE_URL` (optional `MODULE_VARIANTS`); writes `qa/modules/<module>/discovery/`; aborts mutating requests |
| Field scaffold | `npm run module:scaffold -- <module>` (`qa/tools/scaffold-module-fields.mjs`) | Builds `tests/modules/<module>/fields.ts` from `discovery/fields-*.json`; won't overwrite without `--force` |
| Proposal installer | `node qa/tools/install-module-adapter.mjs --module <module> --job <jobId> --dry-run` (or `--from <dir>`) | Copies a reviewed coding-agent proposal to `tests/modules/<module>/` + `qa/modules/<module>/adapter.json`, scans for secrets/imports, runs `tsc` + `portal:check`; refuses `registration` |
| Portal checks | `npm run portal:check`, `npm run portal:test` | Verifies syntax, SQLite migrations, registry validation, and runner contracts |
| Separation check | `node .claude/skills/checking-module-isolation/check-module-isolation.mjs` | Fails if the module refers to another module or shared code gains a module reference |

See [module-adapter-template.md](module-adapter-template.md) for boilerplate code templates.

## Procedure

1. **Create and inspect module intake.** Add the module in Test Studio (`npm run portal`) or inspect its uploaded requirements/workbooks via `analyzing-module-intake`. Place module metadata and rules in `qa/modules/<module>/rules.md` and `qa/modules/<module>/cases/<module>-cases.json`.
2. **Run read-only live discovery** with the generic spec. Don't copy Registration's. The session must be valid first (the user runs `npm run auth`). In PowerShell: `$env:MODULE_ID='<module>'; $env:MODULE_URL='/<path>'; npm run module:discover`. It writes `fields-*.json`, `layout-*.json`, `config/` and `discovery.md` to `qa/modules/<module>/discovery/` and never saves.
3. **Define fields and Page Object.** Run `npm run module:scaffold -- <module>` to generate `tests/modules/<module>/fields.ts`, then review it (`card`, `label` without `*`, `kind`, `column`, and `FILL_ORDER` for cascading dropdowns). Implement `tests/modules/<module>/<module>.page.ts` using `tests/fixtures/auth.ts` for `sessionStorage` auth and `tests/fixtures/evidence.ts` for screenshots. Copy patterns from `tests/modules/registration/`, but never import from it.
4. **Implement the data-driven spec.** Create `tests/modules/<module>/case-runner.ts` and `tests/modules/<module>/cases.spec.ts`, or install a reviewed coding-agent proposal with `install-module-adapter.mjs` (`--dry-run` first). Honor `CASES_FILE`, `CASES`, `PORTAL_RUN_DIR`, and `AUTH_DIR`. Use `moduleDir('qa', '<module>')` (the id is required, `tests/shared/module-paths.ts:3`). For a command-line preflight, add `tests/modules/<module>/session.spec.ts` that opens the module page, like Registration's. Keep `tests/smoke/session.spec.ts` module-neutral. Emit `<case-id>-result.json` with `{ id, title, status, expected, actual, mismatches, durationMs }`. Cases with no implementation use action `unavailable` / outcome `automation-blocked`, so runs report BLOCKED and never PASS.
5. **Connect the adapter.** No custom logic: write `qa/modules/<module>/adapter.json` (loaded by `portal/registry.mjs`) and associate the module record with `adapter: '<module>'`. Its `spec` must be `tests/modules/<module>/<file>.spec.ts` (`portal/registry.mjs:35`). The portal runs that spec directly (`portal/queue.mjs:147`), so no `run-<module>-e2e.mjs` is needed. Custom logic (own validation, seed, AI data): add a plugin under `portal/modules/<module>/` registered via `registerPlugin` (see `portal/modules/contract.mjs` and `portal/modules/registration/index.mjs`). Add one import line for `portal/modules/<module>/index.mjs` in `portal/registry.mjs` (`README.md`, "Adding a module"), plus one in `portal/store.mjs` if it has a `seed` hook (comment at `portal/store.mjs:6`).
6. **Verify end-to-end.** Run `npx tsc --noEmit`, `npm run portal:check`, `npm run portal:test`, and one controlled smoke case before enabling full suites.
7. **Check separation.** Run `node .claude/skills/checking-module-isolation/check-module-isolation.mjs` and fix every ERROR/NEW (see the `checking-module-isolation` skill).

## Common mistakes

| Mistake | Fix |
|---|---|
| Locating inputs by `#id` or `name="sabyaDate"` | Locate by card title + visible label (`filter({ visible: true })`); IDs repeat across webparts |
| Using `page.waitForTimeout()` for cascades | Wait on `waitForResponse` or `expect.poll()` for derived values |
| Judging Save by toast text alone | Inspect the backend POST response body (`statusCode: 409\|500` can return inside HTTP 200) |
| Allowing user-editable shell commands | Keep spec paths locked in the adapter (`adapters[module.adapter].spec`, served by `portal/registry.mjs`) |
| Creating unprefixed test records on shared environments | Always prefix synthetic records with `Agent Testing` and guard updates with `assertAgentRecord()` |
| Importing Registration helpers into the new module, or adding `if (id === '<module>')` to shared `portal/*.mjs` | Copy the pattern; put module behavior in the adapter or plugin hooks; run the separation check |
| Renaming `registrationType` to a module-specific key | It is the generic variant key for every module (`README.md:104`) |
