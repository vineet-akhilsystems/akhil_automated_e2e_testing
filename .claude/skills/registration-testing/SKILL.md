---
name: registration-testing
description: Use for any work on the Augastam EMR Registration page tests in this repo (demo.augastam.com/registration) - running discovery or cases, reading results, asking what the page, config or MongoDB contains, or as the entry point before writing cases, automating a workflow, onboarding a module, or triaging failures.
---

# Registration testing (hub)

Module data: `qa/modules/registration/` (cases, rules, discovery, results, bugs). Playwright code: `tests/modules/registration/`.
**What a field should do comes from `qa/modules/registration/rules.md`** (cites EMR file:line). Anything not there is *not defined*: a case for it is `assumed`.

## Pick the focused skill

| Situation | Use |
|---|---|
| Write / add / review test cases, convert a BA `TC_REG_*` row, "edge cases for X" | `designing-registration-cases` |
| Scenario needs ordered steps the JSON actions cannot express, a new field, print/QR/drawer/modal checks | `automating-registration-workflows` |
| A run has FAIL / ERROR / FAIL (assumed) rows, "why did REG-xxx fail", bug drafts | `triaging-registration-failures` |
| Extract requirements, rules, flows and draft cases from BA intake uploads or workbooks | `analyzing-module-intake` |
| Add a new EMR module (Billing, Appointments, Setup) and connect its Playwright adapter | `onboarding-portal-modules` |
| Check module code isn't mixed (one module referring to another, shared code referring to a module) | `checking-module-isolation` |
| Exploring the live page interactively | `playwright-cli` |

## Commands

| Goal | Command |
|---|---|
| Log in / session expired (**user runs it**: it types the password) | `npm run auth` |
| Check the session works | `npx playwright test tests/smoke` |
| Record fields, options, backend config (never saves) | `npm run reg:discover` |
| Inventory controls across all 6 registration variants | `npm run reg:inventory` |
| Run all enabled file-based cases / 37-case workflow suite | `npm run reg:cases` / `npm run reg:e2e` |
| Run enabled automated cases from the portal SQLite DB | `npm run reg:pipeline` (`-- --list` for dry run) |
| Run a subset (include prerequisites, e.g. REG-001 for `{{regId@REG-001}}`) | PowerShell `$env:CASES='REG-001,REG-111'; npm run reg:cases` |
| Watch slowly / pause on each failure | `npm run reg:watch` / `npm run reg:failures` |
| Install workflow IDs / connect BA workbook in portal DB | `npm run reg:automation:install` / `npm run reg:workbook:connect` |
| Rebuild report / export JSON to Excel | `npm run reg:report` / `npm run reg:excel` |
| Validate case file(s) against portal rules | `node .claude/skills/designing-registration-cases/validate-cases.mjs` |
| Read-only DB lookup (PII masked) | `node qa/tools/mongo-read.js find PATIENT_REGISTRATION_DB '{"properties.first_name":"Agent"}' --limit 5` |
| Start Test Studio portal / verify portal | `npm run portal` / `npm run portal:check` / `npm run portal:test` |

Outputs: `qa/modules/registration/results/latest-summary.md`, HTML report (`npm run report`), and `.portal/runs/<run-id>/` for portal runs. Discovery writes `qa/modules/registration/discovery/discovery.md`.

## Facts every registration task needs

- Case file `qa/modules/registration/cases/registration-cases.json` is the file source of truth; `.portal/portal.sqlite` stores portal state.
- Actions: `fill` `save` `saveTwice` `saveDoubleClick` `search` `update` `workflow` `unavailable`. Outcomes: `created` `blocked` `field-state` `observe` `no-errors` `duplicate-warning` `found` `not-found` `no-error` `updated` `created-once` `verified` `automation-blocked`.
- Workflow keys live in `qa/modules/registration/workflows.json`; implementations in `tests/modules/registration/workflow-runner.ts`.
- Saves are judged by the `POST .../autogenerate` response, not the toast (409/500 arrive inside HTTP 200).
- Test patients are always `Agent Testing User<NumberInWords>` with unique phones.

## Guardrails

- MongoDB is **read-only**: only `qa/tools/mongo-read.js` (`.claude/hooks/db-readonly-guard.js` blocks writes/shells).
- Never read or print `.env`, `login.txt`, `.auth/`. Never type the app password; the user runs `npm run auth`.
- Never skip a case, loosen `expected`, or change an expected business result to make a run green without approval.
