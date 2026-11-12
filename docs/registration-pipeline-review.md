# Registration pipeline review — 2026-11-04

The portal database currently contains 250 Registration cases: 170 automated definitions (169 enabled) and 80 manual workbook procedures. The file-based `reg:e2e` command selects the separate 33-case workflow suite. Five portal-only cases, REG-266 through REG-270, were absent from both file datasets.

`npm run reg:pipeline` now reads the current portal definitions and shared templates through a read-only database transaction, validates automated definitions, resolves prerequisites, and saves an immutable execution snapshot. It includes portal-only additions and edits without rewriting source datasets or the database. Disabled cases stay excluded. Manual procedures are listed separately in the pipeline status file; they are not interpreted as executable instructions.

```powershell
# Discover all enabled automated portal cases, without application access
npm run reg:pipeline -- --list

# Refresh application login, then execute
npm run auth
npm run reg:pipeline

# Select newer cases; prerequisite REG-001 is included for REG-269
$env:CASES = 'REG-266,REG-267,REG-268,REG-269,REG-270'
npm run reg:pipeline
Remove-Item Env:CASES
```

Execution uses BASE_URL and AUTH_DIR from the existing Playwright configuration. Set both for the intended test environment; selecting PORTAL_DATA_DIR alone does not select a portal environment. The command may create or update synthetic patients. Run it sequentially with portal jobs using the same application session.

## New-case review

| Case | Executable check | Limitation |
|---|---|---|
| REG-266 | Diagnostic variant opens without field errors | Live verification blocked by session |
| REG-267 | Outside variant opens without field errors | Live verification blocked by session |
| REG-268 | Selecting Ms. yields Female | Expected behavior is explicitly an assumed business rule; needs confirmation |
| REG-269 | Clear PIN on prerequisite patient and expect blocked update | Does not assert clearing State, District and City as its title states; expected blocking is assumed |
| REG-270 | Select Self-Paid and assert payer/sponsor Cash | Does not first select Insurance, so cannot establish the transition described in its title |

Definitions were preserved for review. Discovering or executing these checks does not establish their complete titled requirements.

## What cannot currently be verified

The live session preflight returned “Application session expired. Run npm run auth in this project, then retry.” Registration cases did not execute. The pipeline records `blocked-before-execution` with all selected IDs, manual exclusions and the input snapshot path; the Playwright report retains the preflight screenshot and trace. A preflight failure is an execution blocker, not 169 application defects or passes.

The 80 manual workbook scenarios remain manual. Existing workflow automation covers portions of them; full master configuration, role permissions, HR/maternal integration, insurance eligibility and expiry enforcement, ABHA/OTP, delivery confirmation, audit history and downstream outcomes need the test fixtures, permissions and sandbox access listed in [required resources](registration-e2e-progress.md). Opening a drawer or redirect does not prove its business workflow. Source implementations marked Coming soon need completed product functionality before full automation can pass.

## Verification

- Existing local regression suite: 30 portal/API/browser/quality tests and 9 executor/workflow checks passed.
- New pipeline source regression passed: current shared templates, portal-only cases, dependency ordering, manual exclusion and disabled-case rejection.
- Portal-backed discovery found 169 tests and validated all selected definitions.
- TypeScript compilation and portal JavaScript syntax checks passed.
- Live preflight failed due to expired session; no live case results claimed.

These local checks establish pipeline selection and executor logic, not live EMR behavior. Per-case evidence remains in existing Registration reports; pipeline status records orchestration only. The CLI does not schedule unattended runs or refresh credentials automatically.
