---
name: triaging-registration-failures
description: Use when an Augastam or Miracle run (Registration REG-xxx, EMR, Miracle modules, npm run reg:cases, or any Test Studio portal run) has FAIL, ERROR or "FAIL (assumed requirement)" results, someone asks why a case failed, wants a bug report or post-mortem, or needs a run reviewed before sharing.
---

# Triaging registration failures

**Core principle:** every non-PASS row gets one classification backed by inspected evidence. Only a reproduced failure against a *confirmed* rule is a product defect. Never turn a run green by editing expected results.

## Where the evidence is

| Run type | Results | Evidence |
|---|---|---|
| `npm run reg:cases` | `qa/augastam/registration/results/latest-results.json` (`status`, `expected`, `actual`, `mismatches`, `registrationId`, `serverResponse`, `toasts`, `fieldErrors`, `values`, `resolvedInput`), `qa/augastam/registration/results/latest-summary.md` | `test-results/<case-dir>/error-context.md`, `test-results/<case-dir>/REG-xxx-*.png`, `trace.zip`, `npm run report` |
| Interrupted run | `qa/augastam/registration/results/runs/<run-id>/results.jsonl` (`npm run reg:report` rebuilds latest) | same |
| Portal run | `.portal/runs/<run-id>/report/results.json`, `runner.log` | `.portal/runs/<run-id>/artifacts/` |

Open the failure screenshot and `<case-dir>/error-context.md` for every non-PASS row. Use `npx playwright show-trace <trace.zip>` when screenshots don't explain it.

## Process

0. **Versions first (portal runs).** `get_run_failures` / `compare_runs` return `versionDifferences` (`appVersion`, login-profile hash, automation version `v1, v2...`) plus a `HINT`. New automation version -> check changed files first (`list_automation_versions` / Versions tab); new app/profile -> environment may have changed. Treat these as triage hints, not verdicts (`working-with-versions-and-tree` skill).
1. **Whole-run check first.** Same ERROR across most rows -> one environment blocker; stop, classify once, report.
2. **Per row:** read `mismatches`, `actual`, `serverResponse`, then evidence. Classify from the table below.
3. **Rerun once** with prerequisites: `$env:CASES='REG-001,REG-111'; npm run reg:cases` (or `npm run reg:failures`). Different result -> **intermittent**.
4. **Act** per class below.
5. **Report** table: `ID | status | class | evidence (path) | action taken / proposed`, plus items needing BA/human approval.

## Classify

| Signal | Class | Action |
|---|---|---|
| `net::ERR_CONNECTION_TIMED_OUT`, `ERR_NAME_NOT_RESOLVED`, 502/503/504, very slow `<id>/details/` or `autogenerate` | **Environment** | Verify reachability (`npx playwright test tests/smoke`), report, rerun later. |
| `Application session expired`, redirected to login, 401 | **Environment (session)** | Ask user to run `npm run auth`. Never log in yourself. |
| `npm run auth` fails with `Missing AUGASTAM_<X> in .env` (`tests/auth.setup.ts:16`) | **Environment (config)** | User populates `.env` (keys in `.env.example`). Never read/edit `.env`. |
| `npm run auth` times out at `loginStage` (`tests/auth.setup.ts`) | **Environment or test defect** | Check `test-results/<setup-dir>/error-context.md` and `test-failed-1.png`. Logged-in screen -> fix stale locator; stopped at `verify-password`/Tenant -> credentials/site issue. |
| `BLOCKED` with `NOT AUTOMATED - <reason>` (`tests/augastam/registration/case-runner.ts:239`) | **Not automated** | Action `unavailable` (`qa/tools/connect-registration-workbook.mjs:69`); automating it is new work (`automating-registration-workflows`). |
| `needs {{regId@REG-001}} but REG-001 did not produce it` | **Dependency** | Triage prerequisite case first; inherits its class. |
| Element not found / timeout / strict violation while screenshot shows control in place | **Test defect** | Fix locator/wait in `tests/augastam/registration/registration.page.ts` or `tests/augastam/registration/workflow-runner.ts` (max 2 attempts). Never weaken assertions. |
| Control missing/renamed in UI or `qa/augastam/registration/discovery/discovery.md` differs from `tests/augastam/registration/fields.ts` | **App change** | Run `npm run reg:discover`, compare, update `tests/augastam/registration/fields.ts`, report UI change. |
| `FAIL (assumed requirement)` | **Business rule review** | Not a bug; formulate question for BA referencing requirement id. |
| `FAIL` against confirmed rule in `qa/augastam/registration/rules.md` or config, reproduced | **Product defect** | Write or append to bug draft (below). |
| `outcome: ... actual "rejected-but-shown-as-success"`, toast `[object Object]` | **Product defect (known)** | Known FE 409 bug (`qa/augastam/registration/rules.md`, Save); append to existing bug draft. |
| Case input/data/expectation defect (typo, duplicate phone, wrong key) | **Case defect** | Fix valid data/input issues (`designing-registration-cases`); propose expectation changes to user. |
| PASS on rerun after FAIL | **Intermittent** | Record both runs; look for missing wait; file bug only if reproduced twice. |

## Bug drafts & multi-module portal triage

- **Other modules (`tests/<product>/<module>/`):** Use MCP tools `get_run_failures`, `compare_runs`, and `save_run_postmortem` to inspect failure clusters, version differences, and write post-mortems. Check `tests/<product>/<module>/<id>.page.ts` for dialog-first selector issues or missing `waitForResponse` signals while keeping `tests/<product>/<module>/case-runner.ts` mismatch assertions strict.
- **Check `qa/augastam/registration/bugs/` first** for an existing draft sharing root cause (e.g. `qa/augastam/registration/bugs/REG-040.md`); append evidence instead of duplicating.
- New draft: `qa/augastam/registration/bugs/<first-case-id>.md` using [bug-template.md](bug-template.md). Include: `run.appVersion` (source), profile hash, automation version (or UI version read by hand), environment URL, case id(s), numbered steps, expected (with rule/config source), actual, server response, created UHIDs, screenshot paths, hypothesized EMR `file:line` root cause, and proposed severity.
- Verify stored record read-only when helpful (`node qa/tools/mongo-read.js schema PATIENT_REGISTRATION_DB '{"properties.first_name":"Agent"}'`, then `find` with PII masked).

## Never

- Skip/disable/delete failing cases, weaken `expected`, switch to `observe`, or add `assumed: true` without user approval.
- File bugs from one un-reproduced run, environment outage, or assumed-rule failure.
- Retry a failing locator fix a third time.
