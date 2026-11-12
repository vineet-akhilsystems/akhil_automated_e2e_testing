---
name: triaging-registration-failures
description: Use when an Augastam Registration run has FAIL, ERROR or "FAIL (assumed requirement)" results, someone asks why REG-xxx failed, wants a bug report or bug draft, or a run (npm run reg:cases or a Test Studio portal run) needs reviewing before results are shared.
---

# Triaging registration failures

**Core principle:** every non-PASS row gets exactly one classification, backed by evidence you looked at. Only a reproduced failure against a *confirmed* rule is a product defect. Never make a run green by editing the test's expectation.

## Where the evidence is

| Run type | Results | Evidence |
|---|---|---|
| `npm run reg:cases` | `qa/modules/registration/results/latest-results.json` (`results[]`: `status`, `expected`, `actual`, `mismatches`, `registrationId`, `serverResponse`, `toasts`, `fieldErrors`, `values`, `resolvedInput`), `latest-summary.md` | `test-results/<case-dir>/` (`error-context.md`, `REG-xxx-*.png`, `trace.zip`), `npm run report` |
| Interrupted run | `results/runs/<run-id>/results.jsonl` (`npm run reg:report` rebuilds latest) | same |
| Portal run | `.portal/runs/<run-id>/report/results.json`, `runner.log` | `.portal/runs/<run-id>/artifacts/` |

Open the screenshot and `error-context.md` (page snapshot at failure) for every row you classify. Open the trace (`npx playwright show-trace <trace.zip>`) when the screenshot doesn't explain it.

## Process

1. **Whole-run check first.** Same ERROR on most rows -> one environment cause; classify once, stop, tell the user. Don't rerun everything.
2. **Per row:** read `mismatches` + `actual` + `serverResponse`, then the evidence. Classify with the table below.
3. **Rerun once** each candidate defect or test defect, **with its prerequisites**: `$env:CASES='REG-001,REG-111'; npm run reg:cases` (or `npm run reg:failures` to pause headed on the failing screen). A different result -> **intermittent**: record both outcomes, no bug yet.
4. **Act** per class (below).
5. **Report** to the user as a table: `ID | status | class | evidence (path) | action taken / proposed`. Then list what needs their decision (expectation changes, assumed rules to confirm with BA).

## Classify

| Signal | Class | Action |
|---|---|---|
| `net::ERR_CONNECTION_TIMED_OUT`, `ERR_NAME_NOT_RESOLVED`, 502/503/504, very slow `details/` or `autogenerate` | **Environment** | Check the site is reachable (`npx playwright test tests/smoke`). Report; rerun later. No bug. |
| `Application session expired`, redirected to login, 401 | **Environment (session)** | Ask the user to run `npm run auth`. Never log in yourself. |
| `npm run auth` fails with `Missing AUGASTAM_<X> in .env` (`tests/auth.setup.ts:16`) | **Environment (config)** | The user fills that key in `.env` (key names are in `.env.example`). Never read or edit `.env` yourself (denied in `.claude/settings.json`). |
| `npm run auth` times out at a step (`loginStage` in `tests/auth.setup.ts`) | **Environment or test defect** | Open the setup's `error-context.md` and `test-failed-1.png` under `test-results/`. They exist only after a failed `npm run auth`. If the screenshot shows the logged-in workspace, the login worked and the step's locator is stale, so fix the step, not the credentials. A wrong password stops at `verify-password`/`Tenant dropdown`. |
| `BLOCKED` with `NOT AUTOMATED - <reason>` (`tests/modules/registration/case-runner.ts:239`) | **Not automated** | Not a failure, and no app check ran. The case has action `unavailable` (set by `qa/tools/connect-registration-workbook.mjs:69`). Automating it is new work (`automating-registration-workflows`), never a triage fix. |
| `needs {{regId@REG-001}} but REG-001 did not produce it` / `needs the registration id from` | **Dependency** | Triage the prerequisite case; this row inherits its class. |
| `expect(locator).toBeVisible() failed`, strict-mode violation, element not found, timeout on a click, but the screenshot shows the control in place | **Test defect** | Fix locator/wait in `registration.page.ts` / `workflow-runner.ts` (rules in `automating-registration-workflows`). Max **two** repair attempts, then report. Never weaken the assertion. |
| Control genuinely missing/renamed in the screenshot, or `discovery.md` differs from `fields.ts` | **App change** | `npm run reg:discover`, compare, update `fields.ts`; report the UI change to the user (may also be a bug). |
| `FAIL (assumed requirement)` | **Business rule review** | Not a bug. Write it as a question for BA: "Should X be rejected? Today it is saved (UHID ...)." Link the requirement id. |
| `FAIL` against a rule in `rules.md` or config, reproduced on rerun | **Product defect** | Bug draft (below). |
| `outcome: ... got "rejected-but-shown-as-success"`, toast `[object Object]` | **Product defect (known)** | Known FE 409 handling bug (rules.md, Save). Add the case to the existing draft, don't open a new one. |
| Case input/expectation is wrong (typo, fixed phone now duplicate, wrong field key, stale `{{first}}` option) | **Case defect** | Propose the fix to the user. Expectation changes need approval; input/data fixes can be made and validated (`designing-registration-cases`). |
| PASS on rerun, FAIL before | **Intermittent** | Record both; look for a missing wait. Bug only if it reproduces twice. |

## Bug drafts

- **First check `qa/modules/registration/bugs/`** for an existing draft with the same root cause (e.g. `REG-040.md` groups 5 date cases). Append the case and evidence there instead of opening a duplicate.
- New draft: `qa/modules/registration/bugs/<first-case-id>.md` from [bug-template.md](bug-template.md). Required: build (top-right version), environment URL, case id(s), numbered steps a human can follow, expected (with source: rules.md line / config / requirement), actual, server response, created UHIDs, screenshot paths.
- Root cause is a **hypothesis** with EMR file:line from `rules.md`. Label it that way. If no code reference is known, say "not investigated".
- Severity is a proposal for the user, not a fact. Patient-safety / data-integrity issues (wrong patient, lost data, impossible DOB saved) rank above cosmetic ones.
- Confirm stored data read-only when it matters (check field paths first with `node qa/tools/mongo-read.js schema PATIENT_REGISTRATION_DB '{"properties.first_name":"Agent"}'`; needs `AUGASTAM_MONGO_URL` set by the user): `node qa/tools/mongo-read.js find PATIENT_REGISTRATION_DB '{"properties.first_name":"Agent","properties.last_name":"UserOneHundredFortyFive"}' --limit 1`. PII stays masked; never paste unmasked real patient data into a draft.

## Never

- Skip, disable or delete a failing case; loosen `expected`; switch it to `observe`; or add `assumed: true` after the fact. Each needs the user's approval.
- File a bug from a single unreproduced run, an environment error, or an assumed-rule failure.
- Call a test defect fixed without rerunning it and seeing PASS for the right reason (assert still meaningful).
- Retry the same broken locator a third time. Report what you tried.
